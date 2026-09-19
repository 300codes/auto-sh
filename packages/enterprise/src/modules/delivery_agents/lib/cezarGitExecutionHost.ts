import { createHash } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { DELIVERY_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { ResultManifestV1, TaskPackageV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { runCezarInWorkspace } from './cezarWorkspaceRun'
import type { DeliveryAgentsExecutionHost, ExecutionHostInput } from './executionHost'
import { runProcess } from './wordpressExecutionHost'

const logger = createLogger('delivery_agents').child({ executor: 'cezar-git' })

const OPEN_MERCATO_MODULE_PROFILE_ID = 'open-mercato-module'
const OPEN_MERCATO_MODULE_PROFILE_VERSION = 1
const CEZAR_SERVER_PORT = 4392

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

type CheckResult = { exitCode: number | null; durationMs: number; status: 'passed' | 'failed' | 'not_run' }

function buildCezarPrompt(taskPackage: TaskPackageV1): string {
  const requirements = taskPackage.requirements
    .map((r) => `- ${r.id}: ${r.title}${r.description ? ` — ${r.description}` : ''}`)
    .join('\n')
  const criteria = taskPackage.acceptanceCriteria.map((c) => `- ${c.id}: ${c.description}`).join('\n')
  const tests = Object.entries(taskPackage.validationProfile.requiredTests)
    .map(([acId, testIds]) => `- ${acId}: ${testIds.join('; ')}`)
    .join('\n')

  return [
    `Task: ${taskPackage.title}`,
    taskPackage.description ? `Details: ${taskPackage.description}` : '',
    `Requirements:\n${requirements || '(none)'}`,
    `Acceptance criteria:\n${criteria || '(none)'}`,
    `Tests that must pass (use these EXACT names):\n${tests || '(none)'}`,
    `Allowed file paths: ${taskPackage.allowedPaths.join(', ')}`,
    'After implementing, run the tests to confirm they pass. Work autonomously.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildCheck(
  checkId: string,
  testId: string,
  acIds: string[],
  commandProfileId: string,
  result: CheckResult,
  validationProfileVersion: number,
  resultRevision: { kind: 'git'; commitSha: string },
): ResultManifestV1['checks'][number] {
  const def = JSON.stringify({ commandProfile: commandProfileId, checkId })
  const report = JSON.stringify({ exitCode: result.exitCode, durationMs: result.durationMs, status: result.status })
  return {
    checkId,
    testId,
    acIds,
    commandProfileId,
    validationProfileVersion,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    sourceRevision: resultRevision,
    testDefinitionHash: sha256(def),
    rawReportHash: sha256(report),
  }
}

async function copyFile(src: string, dst: string): Promise<void> {
  const { copyFile: fsCopyFile } = await import('node:fs/promises')
  await fsCopyFile(src, dst)
}

async function runChecksWithChanges(
  repoDir: string,
  worktreePath: string,
  changedPaths: string[],
): Promise<{ jest: CheckResult; typecheck: CheckResult; audit: CheckResult }> {
  // Apply worktree changes to main repo temporarily, run checks, then restore.
  const backups: Array<{ src: string; backup: string }> = []
  const notExisted: string[] = []

  try {
    // Backup current files and apply worktree version
    for (const relPath of changedPaths) {
      const mainFile = path.join(repoDir, relPath)
      const worktreeFile = path.join(worktreePath, relPath)
      const backupFile = `${mainFile}.cezar.bak`
      try {
        await copyFile(mainFile, backupFile)
        backups.push({ src: mainFile, backup: backupFile })
      } catch {
        notExisted.push(mainFile)
      }
      await copyFile(worktreeFile, mainFile)
    }

    const corePkgDir = path.join(repoDir, 'packages', 'core')
    const coreSrcPrefix = path.join('packages', 'core', 'src') + path.sep
    const testPatterns = changedPaths
      .filter((p) => p.includes('__tests__') || p.endsWith('.test.ts') || p.endsWith('.test.tsx'))
      .map((p) => {
        const rel = p.startsWith(coreSrcPrefix) ? p.slice(coreSrcPrefix.length) : p
        return rel.replace(/\.(test\.tsx?|spec\.tsx?)$/, '')
      })
    const jestArgs = ['jest', '--config', 'jest.config.cjs', '--maxWorkers=2', '--passWithNoTests', ...testPatterns]
    const start = Date.now()
    const [jestRaw, tcRaw, auditRaw] = await Promise.all([
      runProcess('yarn', jestArgs, corePkgDir, { PATH: process.env.PATH ?? '' }),
      runProcess('yarn', ['typecheck'], repoDir, { PATH: process.env.PATH ?? '' }),
      runProcess('yarn', ['npm', 'audit', '--severity', 'high'], repoDir, { PATH: process.env.PATH ?? '' }),
    ])

    return {
      jest: { exitCode: jestRaw.exitCode, durationMs: jestRaw.durationMs, status: jestRaw.exitCode === 0 ? 'passed' : 'failed' },
      typecheck: { exitCode: tcRaw.exitCode, durationMs: tcRaw.durationMs, status: tcRaw.exitCode === 0 ? 'passed' : 'failed' },
      audit: { exitCode: auditRaw.exitCode, durationMs: auditRaw.durationMs, status: auditRaw.exitCode === 0 ? 'passed' : 'failed' },
    }
  } finally {
    // Restore original files
    for (const { src, backup } of backups) {
      await copyFile(backup, src)
      await unlink(backup).catch(() => undefined)
    }
    for (const mainFile of notExisted) {
      await unlink(mainFile).catch(() => undefined)
    }
  }
}

async function getWorktreePath(repoDir: string, branch: string): Promise<string | null> {
  try {
    const listing = await runProcess('git', ['worktree', 'list', '--porcelain'], repoDir, {})
    for (const block of listing.stdout.split('\n\n')) {
      const lines = block.split('\n')
      const worktreeLine = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length)
      if (lines.some((l) => l === `branch refs/heads/${branch}`) && worktreeLine) return worktreeLine
    }
    return null
  } catch {
    return null
  }
}

async function getHeadCommit(dir: string): Promise<string | null> {
  try {
    const result = await runProcess('git', ['rev-parse', 'HEAD'], dir, {})
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

export function createCezarGitExecutionHost(baseDir: string): DeliveryAgentsExecutionHost {
  return {
    supports(targetProfileId: string, targetProfileVersion: number): boolean {
      return targetProfileId === OPEN_MERCATO_MODULE_PROFILE_ID && targetProfileVersion === OPEN_MERCATO_MODULE_PROFILE_VERSION
    },

    async execute(input: ExecutionHostInput): Promise<ResultManifestV1> {
      const { taskPackage, baseDir: inputBaseDir } = input
      const repoDir = inputBaseDir || baseDir

      if (taskPackage.baseRevision.kind !== 'git') {
        throw new Error('[internal] cezar_git_host_requires_git_revision')
      }

      const baseCommit = taskPackage.baseRevision.commitSha
      const prompt = buildCezarPrompt(taskPackage)
      const timeoutMs = taskPackage.limits.attemptTimeoutMinutes * 60 * 1000

      logger.info('running cezar task', { taskId: taskPackage.taskId, attemptId: taskPackage.attemptId })

      // Use server-based runner that properly polls for completion via API.
      const cezarResult = await runCezarInWorkspace(repoDir, baseCommit, prompt, {
        command: 'npx',
        args: ['-y', 'cezar-cli'],
        port: CEZAR_SERVER_PORT,
        workflow: 'quick-task',
        timeoutMs,
      })

      const changedPaths = cezarResult.changes.map((c) => c.path)
      const externalRunId = `cezar:${cezarResult.runId ?? taskPackage.attemptId}`

      // Construct worktree path from the run UUID (Cezar stores worktrees at .ai/cezar/worktrees/<uuid>)
      // Branch name uses only the first 8 chars: cez/<8chars>, but worktree dir uses full UUID.
      const worktreePath = cezarResult.runId
        ? path.join(repoDir, '.ai', 'cezar', 'worktrees', cezarResult.runId)
        : null
      const resultCommit = worktreePath ? ((await getHeadCommit(worktreePath)) ?? baseCommit) : baseCommit

      logger.info('cezar finished, running checks', {
        taskId: taskPackage.taskId,
        runId: cezarResult.runId,
        status: cezarResult.status,
        worktreePath: worktreePath ? '✓' : '—',
        resultCommit: resultCommit.slice(0, 12),
        changedPaths: changedPaths.length,
      })

      const resultRevision = { kind: 'git' as const, commitSha: resultCommit }
      const vp = taskPackage.validationProfile

      let jestResult: CheckResult = { exitCode: null, durationMs: 0, status: 'not_run' }
      let typecheckResult: CheckResult = { exitCode: null, durationMs: 0, status: 'not_run' }
      let auditResult: CheckResult = { exitCode: null, durationMs: 0, status: 'not_run' }

      if (worktreePath && changedPaths.length > 0) {
        const checkResults = await runChecksWithChanges(repoDir, worktreePath, changedPaths)
        jestResult = checkResults.jest
        typecheckResult = checkResults.typecheck
        auditResult = checkResults.audit
        logger.info('checks complete', {
          taskId: taskPackage.taskId,
          jest: jestResult.exitCode,
          typecheck: typecheckResult.exitCode,
          audit: auditResult.exitCode,
        })
      } else {
        logger.warn('skipping checks', {
          taskId: taskPackage.taskId,
          hasWorktree: !!worktreePath,
          changedPaths: changedPaths.length,
        })
      }

      const acIdsByTest = new Map<string, string[]>()
      for (const [acId, testIds] of Object.entries(vp.requiredTests)) {
        for (const testId of testIds) {
          acIdsByTest.set(testId, [...(acIdsByTest.get(testId) ?? []), acId])
        }
      }

      const checks: ResultManifestV1['checks'] = [
        ...[...acIdsByTest.entries()].map(([testId, acIds], index) =>
          buildCheck(`unit-tests-${index + 1}`, testId, acIds, 'jest-module', jestResult, vp.version, resultRevision),
        ),
        buildCheck('typecheck', 'typecheck', [], 'typecheck', typecheckResult, vp.version, resultRevision),
        buildCheck('dependency-audit', 'dependency-audit', [], 'yarn-audit', auditResult, vp.version, resultRevision),
      ]

      return {
        schemaVersion: DELIVERY_SCHEMA_VERSIONS.resultManifest,
        projectId: taskPackage.projectId,
        taskId: taskPackage.taskId,
        attemptId: taskPackage.attemptId,
        baselineId: taskPackage.baselineId,
        baselineHash: taskPackage.baselineHash,
        targetProfileVersion: taskPackage.targetProfileVersion,
        externalRunId,
        baseRevision: { kind: 'git', commitSha: baseCommit },
        resultRevision,
        baseCommit,
        resultCommit,
        changedPaths,
        artifacts: [],
        checks,
        findings: [],
        usage: { source: 'runner', values: 'unknown' },
      }
    },
  }
}
