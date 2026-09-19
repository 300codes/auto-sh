import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import type { ResultManifestV1, TaskPackageV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { mapWordpressResult, type WordpressResultMappingInput } from '@open-mercato/core/modules/delivery_os/lib/wordpressResultMapper'
import { isPathAllowed } from '@open-mercato/core/modules/delivery_os/lib/allowedPaths'
import type { DeliveryAgentsExecutionHost, ExecutionHostInput } from './executionHost'
import { createThemeRepository, runCezarInWorkspace, type CezarWorkspaceConfig, type CezarWorkspaceResult } from './cezarWorkspaceRun'

const WORDPRESS_PROFILE_ID = 'wordpress-theme'
const WORDPRESS_PROFILE_VERSION = 1
const SMOKE_CHECK_ID = 'smoke-tests'
const LINT_CHECK_ID = 'lint'
const COMMAND_TIMEOUT_MS = 180_000
const EDITABLE_THEME_PATH = /^(?:(?:templates|parts)\/(?:[a-z][a-z0-9-]*\/){0,3}[a-z][a-z0-9-]*\.html|assets\/(?:css\/(?:[a-z][a-z0-9-]*\/){0,3}[a-z][a-z0-9-]*\.css|js\/(?:[a-z][a-z0-9-]*\/){0,3}[a-z][a-z0-9-]*\.js))$/
const UPDATE_TIMEOUT_MS = 120_000

const absolute = z.string().refine(path.isAbsolute)
export const wordpressHostConfigSchema = z.strictObject({
  operatorRoot: absolute,
  sitesRoot: absolute,
  stateRoot: absolute,
  toolchainRoot: absolute,
  checkToolchainRoot: absolute,
  workRoot: absolute,
  cezar: z.strictObject({
    command: z.string().min(1).default('npx'),
    args: z.array(z.string()).default(['-y', 'cezar-cli@0.11.0']),
    port: z.number().int().min(1024).max(65535).default(4391),
    workflow: z.string().min(1).default('quick-task'),
    timeoutMs: z.number().int().positive().max(2 * 60 * 60 * 1000).default(45 * 60 * 1000),
  }),
})
export type WordpressHostConfig = z.infer<typeof wordpressHostConfigSchema>

type Frozen = WordpressResultMappingInput['base']
type Scope = { tenantId: string; organizationId: string; projectId: string }
type Handle = { siteId: string }
type Receipt = { receiptId: string; receiptHash: string }

export type WordpressOperator = {
  captureOwnedSnapshot(input: unknown): Promise<Receipt>
  readCapturedOwnedSnapshot(input: unknown): Promise<{ artifacts: Frozen }>
  updateOwnedTheme(input: unknown): Promise<unknown>
}

export type CommandResult = { exitCode: number; durationMs: number; stdout: string; stderr: string }

export type WordpressHostDependencies = {
  loadOperator(config: WordpressHostConfig): Promise<WordpressOperator>
  runCezar(repository: string, baseCommit: string, prompt: string, config: CezarWorkspaceConfig): Promise<CezarWorkspaceResult>
  runCommand(command: string, args: readonly string[], cwd: string, env: Record<string, string>): Promise<CommandResult>
}

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

function refuse(code: string): never {
  throw new Error(`[internal] wordpress_host_${code}`)
}

async function assertPrivateDirectory(directory: string, requirePrivate: boolean): Promise<void> {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || (await fs.realpath(directory)) !== directory) refuse('directory_invalid')
  if (requirePrivate && stat.mode & 0o077) refuse('directory_not_private')
}

export async function readWordpressHostConfig(filename: string): Promise<WordpressHostConfig> {
  if (!path.isAbsolute(filename) || (await fs.realpath(filename)) !== filename) refuse('config_invalid')
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > 65536) refuse('config_not_private')
    const config = wordpressHostConfigSchema.parse(JSON.parse(await file.readFile('utf8')))
    for (const root of [config.operatorRoot, config.toolchainRoot, config.checkToolchainRoot]) await assertPrivateDirectory(root, false)
    for (const root of [config.sitesRoot, config.stateRoot, config.workRoot]) await assertPrivateDirectory(root, true)
    return config
  } finally {
    await file.close()
  }
}

export async function loadWordpressOperator(config: WordpressHostConfig): Promise<WordpressOperator> {
  const metadata = JSON.parse(await fs.readFile(path.join(config.operatorRoot, 'package.json'), 'utf8')) as { name?: unknown }
  if (metadata.name !== '@open-mercato/delivery-wordpress') refuse('operator_invalid')
  const load = async (name: string) => {
    const target = path.join(config.operatorRoot, 'dist', `${name}.js`)
    if ((await fs.realpath(target)) !== target || !(await fs.lstat(target)).isFile()) refuse('operator_invalid')
    return (await import(pathToFileURL(target).href)) as Record<string, unknown>
  }
  const capture = await load('capture-owned-snapshot')
  const update = await load('theme-update')
  if (typeof capture.captureOwnedSnapshot !== 'function' || typeof capture.readCapturedOwnedSnapshot !== 'function' || typeof update.updateOwnedTheme !== 'function') refuse('operator_invalid')
  return {
    captureOwnedSnapshot: capture.captureOwnedSnapshot as WordpressOperator['captureOwnedSnapshot'],
    readCapturedOwnedSnapshot: capture.readCapturedOwnedSnapshot as WordpressOperator['readCapturedOwnedSnapshot'],
    updateOwnedTheme: update.updateOwnedTheme as WordpressOperator['updateOwnedTheme'],
  }
}

export function runProcess(command: string, args: readonly string[], cwd: string, env: Record<string, string>): Promise<CommandResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    execFile(command, [...args], { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === 'number' && !error.killed ? error.code : -1) : 0
      resolve({ exitCode, durationMs: Date.now() - started, stdout, stderr })
    })
  })
}

const receiptFileSchema = z.object({
  receiptId: z.uuid(),
  receiptHash: z.string(),
  scope: z.object({ tenantId: z.string(), organizationId: z.string(), projectId: z.string() }),
  snapshot: z.object({ sourceRevision: z.object({ contentHash: z.string() }), capturedAt: z.string() }),
})

export async function findBaseReceipt(config: WordpressHostConfig, scope: Scope, handle: Handle, contentHash: string): Promise<Receipt> {
  const directory = path.join(config.stateRoot, handle.siteId, 'snapshot-receipts')
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith('.json'))
  const matches: Array<Receipt & { capturedAt: string }> = []
  for (const name of names) {
    const parsed = receiptFileSchema.safeParse(JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')))
    if (!parsed.success) continue
    const receipt = parsed.data
    const sameScope = receipt.scope.tenantId === scope.tenantId && receipt.scope.organizationId === scope.organizationId && receipt.scope.projectId === scope.projectId
    if (sameScope && receipt.snapshot.sourceRevision.contentHash === contentHash) {
      matches.push({ receiptId: receipt.receiptId, receiptHash: receipt.receiptHash, capturedAt: receipt.snapshot.capturedAt })
    }
  }
  if (matches.length === 0) refuse('base_receipt_missing')
  const latest = matches.sort((left, right) => (left.capturedAt < right.capturedAt ? 1 : left.capturedAt > right.capturedAt ? -1 : 0))[0]
  return { receiptId: latest.receiptId, receiptHash: latest.receiptHash }
}

export function buildCezarPrompt(taskPackage: TaskPackageV1): string {
  const requiredTests = Object.entries(taskPackage.validationProfile.requiredTests)
    .map(([acId, testIds]) => `- ${acId}: ${testIds.join('; ')}`)
    .join('\n')
  const criteria = taskPackage.acceptanceCriteria.map((criterion) => `- ${criterion.id}: ${criterion.description}`).join('\n')
  const requirements = taskPackage.requirements.map((requirement) => `- ${requirement.id}: ${requirement.title}${requirement.description ? ` — ${requirement.description}` : ''}`).join('\n')
  return [
    `You are changing a WordPress block theme. Task: ${taskPackage.title}`,
    taskPackage.description ? `Details: ${taskPackage.description}` : '',
    `Requirements:\n${requirements || '- (none listed)'}`,
    `Acceptance criteria:\n${criteria}`,
    `These existing tests must pass after your change (do not edit them):\n${requiredTests || '- (none)'}`,
    `Only create or edit files under templates/, parts/ (.html) and assets/css or assets/js. Allowed paths: ${taskPackage.allowedPaths.join(', ') || '(profile default)'}.`,
    'Do not edit PHP, theme.json, composer.json, tests/ or any configuration. Do not delete files.',
    'Work autonomously: make reasonable assumptions, do not ask questions, and finish when every acceptance criterion is implemented.',
  ].filter(Boolean).join('\n\n')
}

async function writeFrozenTheme(directory: string, frozen: Frozen): Promise<void> {
  for (const [name, artifact] of Object.entries(frozen.theme)) {
    if (sha256(artifact.bytes) !== frozen.snapshot.themeFiles[name]) refuse('frozen_hash_mismatch')
    const target = path.resolve(directory, name)
    if (!target.startsWith(`${directory}${path.sep}`)) refuse('frozen_path_invalid')
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await fs.writeFile(target, artifact.bytes, { mode: 0o400, flag: 'wx' })
  }
}

const playwrightReportSchema = z.object({
  suites: z.array(z.unknown()),
  stats: z.object({ expected: z.number(), unexpected: z.number(), skipped: z.number(), flaky: z.number() }),
})
const reportSuiteSchema = z.object({
  suites: z.array(z.unknown()).default([]),
  specs: z.array(z.object({ title: z.string(), tests: z.array(z.object({ status: z.string() })) })).default([]),
})

function collectTestStatuses(suites: readonly unknown[], statuses: Map<string, 'passed' | 'failed'>): void {
  for (const raw of suites) {
    const suite = reportSuiteSchema.parse(raw)
    for (const spec of suite.specs) {
      const ok = spec.tests.length > 0 && spec.tests.every((test) => test.status === 'expected')
      statuses.set(spec.title, ok ? 'passed' : 'failed')
    }
    collectTestStatuses(suite.suites, statuses)
  }
}

async function readDefinitionBytes(theme: string, frozen: Frozen, prefix: string): Promise<Buffer> {
  const files = Object.keys(frozen.theme).filter((name) => name.startsWith(prefix)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const entries: Record<string, string> = {}
  for (const name of files) entries[name] = (await fs.readFile(path.join(theme, name))).toString('utf8')
  return Buffer.from(JSON.stringify(entries))
}

export async function runProfileChecks(
  deps: Pick<WordpressHostDependencies, 'runCommand'>,
  config: WordpressHostConfig,
  workDirectory: string,
  taskPackage: TaskPackageV1,
  frozen: Frozen,
): Promise<WordpressResultMappingInput['checks']> {
  const checksRoot = await fs.mkdtemp(path.join(workDirectory, 'checks-'))
  const theme = path.join(checksRoot, 'theme')
  await fs.mkdir(theme, { mode: 0o700 })
  await writeFrozenTheme(theme, frozen)
  await fs.symlink(path.join(config.checkToolchainRoot, 'node_modules'), path.join(theme, 'node_modules'))
  const smokeProcess = await deps.runCommand('npx', ['playwright', 'test', '--reporter=json', '--workers=1', '--retries=0'], theme, { PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(checksRoot, 'smoke-report.json'), npm_config_offline: 'true' })
  const lintProcess = await deps.runCommand('composer', ['run', 'lint'], theme, {})
  for (const [name, artifact] of Object.entries(frozen.theme)) {
    if (sha256(await fs.readFile(path.join(theme, name))) !== sha256(artifact.bytes)) refuse('check_mutated_input')
  }
  const reportBytes = await fs.readFile(path.join(checksRoot, 'smoke-report.json')).catch(() => Buffer.from('{"suites":[],"stats":{"expected":0,"unexpected":0,"skipped":0,"flaky":0}}'))
  const statuses = new Map<string, 'passed' | 'failed'>()
  collectTestStatuses(playwrightReportSchema.parse(JSON.parse(reportBytes.toString('utf8'))).suites, statuses)

  const prefix = `checks/${taskPackage.attemptId}`
  const smokeDefinition = await readDefinitionBytes(theme, frozen, 'tests/')
  const lintDefinition = Buffer.from(JSON.stringify({ composer: frozen.theme['composer.json'] ? Buffer.from(frozen.theme['composer.json'].bytes).toString('utf8') : null }))
  const smokeReport = Buffer.from(JSON.stringify({ exitCode: smokeProcess.exitCode, durationMs: smokeProcess.durationMs, playwright: JSON.parse(reportBytes.toString('utf8')) }))
  const lintReport = Buffer.from(JSON.stringify(lintProcess))
  const common = { validationProfileVersion: taskPackage.validationProfile.version, sourceRevision: frozen.snapshot.sourceRevision }

  const acIdsByTest = new Map<string, string[]>()
  for (const [acId, testIds] of Object.entries(taskPackage.validationProfile.requiredTests)) {
    for (const testId of testIds) acIdsByTest.set(testId, [...(acIdsByTest.get(testId) ?? []), acId])
  }
  const checks: WordpressResultMappingInput['checks'] = [...acIdsByTest.entries()].map(([testId, acIds], index) => {
    const status = statuses.get(testId) === 'passed' && smokeProcess.exitCode === 0 ? 'passed' : statuses.has(testId) ? 'failed' : 'not_run'
    return {
      check: {
        ...common, checkId: `${SMOKE_CHECK_ID}-${index + 1}`, testId, acIds, commandProfileId: 'playwright-smoke',
        status, exitCode: status === 'not_run' ? null : smokeProcess.exitCode, durationMs: smokeProcess.durationMs,
        testDefinitionHash: sha256(smokeDefinition), rawReportHash: sha256(smokeReport),
      },
      definition: { path: `${prefix}/smoke-definition.json`, bytes: smokeDefinition },
      report: { path: `${prefix}/smoke-report.json`, bytes: smokeReport },
    }
  })
  checks.push({
    check: {
      ...common, checkId: LINT_CHECK_ID, testId: LINT_CHECK_ID, acIds: [], commandProfileId: 'php-lint',
      status: lintProcess.exitCode === 0 ? 'passed' : 'failed', exitCode: lintProcess.exitCode, durationMs: lintProcess.durationMs,
      testDefinitionHash: sha256(lintDefinition), rawReportHash: sha256(lintReport),
    },
    definition: { path: `${prefix}/lint-definition.json`, bytes: lintDefinition },
    report: { path: `${prefix}/lint-report.json`, bytes: lintReport },
  })
  return checks
}

export function createWordpressExecutionHost(config: WordpressHostConfig, deps: WordpressHostDependencies): DeliveryAgentsExecutionHost {
  const operatorConfig = { sitesRoot: config.sitesRoot, stateRoot: config.stateRoot, timeoutMs: COMMAND_TIMEOUT_MS }
  return {
    supports(targetProfileId, targetProfileVersion) {
      return targetProfileId === WORDPRESS_PROFILE_ID && targetProfileVersion === WORDPRESS_PROFILE_VERSION
    },
    async execute(input: ExecutionHostInput): Promise<ResultManifestV1> {
      const { taskPackage } = input
      if (taskPackage.baseRevision.kind !== 'snapshot') refuse('snapshot_revision_required')
      const scope: Scope = { tenantId: input.scope.tenantId, organizationId: input.scope.organizationId, projectId: taskPackage.projectId }
      const handle: Handle = { siteId: taskPackage.baseRevision.externalWorkspaceId }
      const operator = await deps.loadOperator(config)

      const baseReceipt = await findBaseReceipt(config, scope, handle, taskPackage.baseRevision.contentHash)
      const base = (await operator.readCapturedOwnedSnapshot({ scope, handle, receiptId: baseReceipt.receiptId, expectedReceiptHash: baseReceipt.receiptHash, config: { stateRoot: config.stateRoot } })).artifacts
      if (base.snapshot.sourceRevision.kind !== 'snapshot' || base.snapshot.sourceRevision.contentHash !== taskPackage.baseRevision.contentHash) refuse('base_revision_mismatch')

      const workDirectory = await fs.mkdtemp(path.join(config.workRoot, `${taskPackage.attemptId}-`))
      const repository = path.join(workDirectory, 'repo')
      const baseCommit = await createThemeRepository(repository, Object.entries(base.theme).map(([name, artifact]) => ({ path: name, bytes: artifact.bytes })))
      const cezar = await deps.runCezar(repository, baseCommit, buildCezarPrompt(taskPackage), config.cezar)
      if (cezar.deletedPaths.length > 0) refuse('deletion_unsupported')
      if (cezar.changes.length === 0) refuse('no_changes')
      const notEditable = cezar.changes.map((change) => change.path).filter((changePath) => !EDITABLE_THEME_PATH.test(changePath) || !isPathAllowed(changePath, taskPackage.allowedPaths))
      if (notEditable.length > 0) refuse(`path_not_editable:${notEditable.slice(0, 5).join(',')}`)

      await operator.updateOwnedTheme({
        scope, handle, updateId: randomUUID(),
        changes: cezar.changes.map((change) => ({ path: change.path, expectedHash: base.snapshot.themeFiles[change.path] ?? null, content: change.content })),
        config: { sitesRoot: config.sitesRoot, stateRoot: config.stateRoot, toolchainRoot: config.toolchainRoot, timeoutMs: UPDATE_TIMEOUT_MS },
      })
      const resultReceipt = await operator.captureOwnedSnapshot({ scope, handle, config: operatorConfig })
      const result = (await operator.readCapturedOwnedSnapshot({ scope, handle, receiptId: resultReceipt.receiptId, expectedReceiptHash: resultReceipt.receiptHash, config: { stateRoot: config.stateRoot } })).artifacts
      const checks = await runProfileChecks(deps, config, workDirectory, taskPackage, result)

      const execution = {
        projectId: taskPackage.projectId, taskId: taskPackage.taskId, attemptId: taskPackage.attemptId,
        baselineId: taskPackage.baselineId, baselineHash: taskPackage.baselineHash,
        targetProfileId: taskPackage.targetProfileId, targetProfileVersion: taskPackage.targetProfileVersion,
        packageSchemaVersion: taskPackage.schemaVersion, externalRunId: `cezar:${cezar.runId}`,
      }
      return mapWordpressResult({
        taskPackage, base, result, checks, execution,
        trusted: {
          scope, siteId: handle.siteId, creationAttemptId: base.snapshot.creationAttemptId,
          baseToolExecutionId: base.snapshot.toolExecutionId, resultToolExecutionId: result.snapshot.toolExecutionId, execution,
        },
        usage: { source: 'runner', values: 'unknown' },
      })
    },
  }
}

export const defaultWordpressHostDependencies: WordpressHostDependencies = {
  loadOperator: loadWordpressOperator,
  runCezar: runCezarInWorkspace,
  runCommand: runProcess,
}

export function createConfiguredWordpressExecutionHost(configPath: string, deps: WordpressHostDependencies = defaultWordpressHostDependencies): DeliveryAgentsExecutionHost {
  let host: Promise<DeliveryAgentsExecutionHost> | null = null
  const resolveHost = () => {
    host ??= readWordpressHostConfig(configPath).then((config) => createWordpressExecutionHost(config, deps))
    return host
  }
  return {
    supports(targetProfileId, targetProfileVersion) {
      return targetProfileId === WORDPRESS_PROFILE_ID && targetProfileVersion === WORDPRESS_PROFILE_VERSION
    },
    async execute(input) {
      return (await resolveHost()).execute(input)
    },
  }
}
