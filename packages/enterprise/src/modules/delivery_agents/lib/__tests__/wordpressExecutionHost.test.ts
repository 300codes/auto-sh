import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadTaskPackageFixture } from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import { resultManifestV1Schema, type TaskPackageV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { wordpressSnapshotContentHash, type WordpressResultMappingInput } from '@open-mercato/core/modules/delivery_os/lib/wordpressResultMapper'
import {
  buildCezarPrompt,
  createWordpressExecutionHost,
  sha256,
  type CommandResult,
  type WordpressHostConfig,
  type WordpressHostDependencies,
} from '../wordpressExecutionHost'

type Frozen = WordpressResultMappingInput['base']

const TEST_ID = 'front page AC-101: services section lists three services'
const SITE_ID = 'c'.repeat(64)
const BASE_RECEIPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CREATION_ATTEMPT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const RESULT_RECEIPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const hostScope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const BASE_THEME: Record<string, string> = {
  'templates/front-page.html': '<!-- wp:paragraph --><p>Services</p><!-- /wp:paragraph -->\n',
  'functions.php': '<?php\n',
  'composer.json': '{"scripts":{"lint":"php -l functions.php"}}\n',
  'tests/smoke.spec.cjs': `test('${TEST_ID}', () => {})\n`,
}

let root: string
let config: WordpressHostConfig
let taskPackage: TaskPackageV1
let base: Frozen
let result: Frozen | null
let updates: unknown[]
let smokeStatus: 'expected' | 'unexpected'

function frozen(files: Record<string, string>, projectId: string): Frozen {
  const themeFiles = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, sha256(content)]))
  const databaseHash = sha256('database')
  const contentHash = wordpressSnapshotContentHash({ databaseHash, themeFiles })
  const prefix = `snapshots/snapshot-${contentHash.slice(0, 6)}`
  return {
    scope: { ...hostScope, projectId },
    snapshot: {
      schemaVersion: 1, provenance: 'live', siteId: SITE_ID, creationAttemptId: CREATION_ATTEMPT_ID, toolExecutionId: randomUUID(),
      capturedAt: new Date().toISOString(), sourceRevision: { kind: 'snapshot', contentHash, externalWorkspaceId: SITE_ID },
      themeFiles, databaseHash,
    },
    database: { path: `${prefix}/database.sqlite`, bytes: Buffer.from('database') },
    theme: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { path: `${prefix}/theme/${name}`, bytes: Buffer.from(content) }])),
  }
}

async function writeReceipt(snapshot: Frozen, receiptId: string): Promise<void> {
  const directory = path.join(config.stateRoot, SITE_ID, 'snapshot-receipts')
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const receipt = { receiptId, receiptHash: `hash-${receiptId}`, scope: snapshot.scope, snapshot: { sourceRevision: snapshot.snapshot.sourceRevision, capturedAt: snapshot.snapshot.capturedAt } }
  await fs.writeFile(path.join(directory, `${receiptId}.json`), JSON.stringify(receipt), { mode: 0o600 })
}

function dependencies(overrides: Partial<WordpressHostDependencies> = {}): WordpressHostDependencies {
  const receipts = new Map<string, Frozen>()
  return {
    async loadOperator() {
      return {
        async readCapturedOwnedSnapshot(input) {
          const { receiptId } = input as { receiptId: string }
          const found = receipts.get(receiptId) ?? (receiptId === BASE_RECEIPT_ID ? base : null)
          if (!found) throw new Error('[internal] unknown receipt')
          return { artifacts: found }
        },
        async updateOwnedTheme(input) {
          updates.push(input)
          const { changes } = input as { changes: Array<{ path: string; content: string }> }
          const files = { ...BASE_THEME }
          for (const change of changes) files[change.path] = change.content
          result = frozen(files, taskPackage.projectId)
          return { status: 'passed', action: 'updated' }
        },
        async captureOwnedSnapshot() {
          if (!result) throw new Error('[internal] nothing to capture')
          receipts.set(RESULT_RECEIPT_ID, result)
          return { receiptId: RESULT_RECEIPT_ID, receiptHash: 'hash-result' }
        },
      }
    },
    async runCezar() {
      return { runId: 'cezar-run', status: 'review', changes: [{ path: 'templates/front-page.html', content: '<p>Services: design, build, host</p>\n' }], deletedPaths: [] }
    },
    async runCommand(command: string, _args: readonly string[], _cwd: string, env: Record<string, string>): Promise<CommandResult> {
      if (command === 'npx') {
        const report = { suites: [{ specs: [{ title: TEST_ID, tests: [{ status: smokeStatus }] }], suites: [] }], stats: { expected: smokeStatus === 'expected' ? 1 : 0, unexpected: smokeStatus === 'expected' ? 0 : 1, skipped: 0, flaky: 0 } }
        await fs.writeFile(env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify(report))
        return { exitCode: smokeStatus === 'expected' ? 0 : 1, durationMs: 5, stdout: '', stderr: '' }
      }
      return { exitCode: 0, durationMs: 3, stdout: 'No syntax errors', stderr: '' }
    },
    ...overrides,
  }
}

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'wp-host-')))
  const dirs = ['sites', 'state', 'work', 'toolchain', 'check-toolchain/node_modules', 'operator']
  for (const dir of dirs) await fs.mkdir(path.join(root, dir), { recursive: true, mode: 0o700 })
  config = {
    operatorRoot: path.join(root, 'operator'), sitesRoot: path.join(root, 'sites'), stateRoot: path.join(root, 'state'),
    toolchainRoot: path.join(root, 'toolchain'), checkToolchainRoot: path.join(root, 'check-toolchain'), workRoot: path.join(root, 'work'),
    cezar: { command: 'npx', args: [], port: 4391, workflow: 'quick-task', timeoutMs: 60_000 },
  }
  taskPackage = loadTaskPackageFixture('snapshot')
  base = frozen(BASE_THEME, taskPackage.projectId)
  taskPackage.baseRevision = base.snapshot.sourceRevision
  result = null
  updates = []
  smokeStatus = 'expected'
  await writeReceipt(base, BASE_RECEIPT_ID)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('WordPress execution host', () => {
  it('supports only wordpress-theme@1', () => {
    const host = createWordpressExecutionHost(config, dependencies())
    expect(host.supports('wordpress-theme', 1)).toBe(true)
    expect(host.supports('react-vite', 1)).toBe(false)
    expect(host.supports('wordpress-theme', 2)).toBe(false)
  })

  it('applies the Cezar change through the owned theme update and returns a canonical manifest with real checks', async () => {
    const host = createWordpressExecutionHost(config, dependencies())
    const manifest = resultManifestV1Schema.parse(await host.execute({ taskPackage, scope: hostScope, actorUserId: randomUUID(), baseDir: root }))
    expect(manifest.baseRevision).toEqual(base.snapshot.sourceRevision)
    expect(manifest.resultRevision).not.toEqual(base.snapshot.sourceRevision)
    expect(manifest.changedPaths).toEqual(['templates/front-page.html'])
    expect(manifest.externalRunId).toBe('cezar:cezar-run')
    expect(manifest.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: 'smoke-tests-1', testId: TEST_ID, acIds: ['AC-101'], status: 'passed', commandProfileId: 'playwright-smoke' }),
      expect.objectContaining({ checkId: 'lint', testId: 'lint', status: 'passed', commandProfileId: 'php-lint' }),
    ]))
    expect(updates).toEqual([expect.objectContaining({
      scope: { ...hostScope, projectId: taskPackage.projectId },
      handle: { siteId: SITE_ID },
      changes: [{ path: 'templates/front-page.html', expectedHash: base.snapshot.themeFiles['templates/front-page.html'], content: '<p>Services: design, build, host</p>\n' }],
    })])
  })

  it('reports a failing required smoke test as failed instead of hiding it', async () => {
    smokeStatus = 'unexpected'
    const host = createWordpressExecutionHost(config, dependencies())
    const manifest = await host.execute({ taskPackage, scope: hostScope, actorUserId: randomUUID(), baseDir: root })
    expect(manifest.checks.find((check) => check.checkId === 'smoke-tests-1')).toMatchObject({ status: 'failed', exitCode: 1 })
  })

  it('refuses when no owned receipt matches the package base revision', async () => {
    taskPackage.baseRevision = { kind: 'snapshot', contentHash: 'f'.repeat(64), externalWorkspaceId: SITE_ID }
    const host = createWordpressExecutionHost(config, dependencies())
    await expect(host.execute({ taskPackage, scope: hostScope, actorUserId: randomUUID(), baseDir: root })).rejects.toThrow('wordpress_host_base_receipt_missing')
    expect(updates).toEqual([])
  })

  it('refuses a receipt that belongs to another organization', async () => {
    const host = createWordpressExecutionHost(config, dependencies())
    const foreign = { ...hostScope, organizationId: '33333333-3333-4333-8333-333333333333' }
    await expect(host.execute({ taskPackage, scope: foreign, actorUserId: randomUUID(), baseDir: root })).rejects.toThrow('wordpress_host_base_receipt_missing')
  })

  it.each([
    [{ runId: 'r', status: 'review' as const, changes: [], deletedPaths: ['templates/front-page.html'] }, 'deletion_unsupported'],
    [{ runId: 'r', status: 'done' as const, changes: [], deletedPaths: [] }, 'no_changes'],
  ])('refuses an unusable Cezar result before touching the site (%#)', async (cezarResult, code) => {
    const host = createWordpressExecutionHost(config, dependencies({ runCezar: async () => cezarResult }))
    await expect(host.execute({ taskPackage, scope: hostScope, actorUserId: randomUUID(), baseDir: root })).rejects.toThrow(code)
    expect(updates).toEqual([])
  })

  it.each([
    ['test-results/.last-run.json'],
    ['functions.php'],
    ['patterns/hero.php'],
  ])('refuses a change to %s outside the editable theme contract before touching the site', async (changedPath) => {
    const host = createWordpressExecutionHost(config, dependencies({
      runCezar: async () => ({ runId: 'r', status: 'review', changes: [{ path: 'templates/front-page.html', content: '<p>x</p>' }, { path: changedPath, content: 'x' }], deletedPaths: [] }),
    }))
    await expect(host.execute({ taskPackage, scope: hostScope, actorUserId: randomUUID(), baseDir: root })).rejects.toThrow(`path_not_editable:${changedPath}`)
    expect(updates).toEqual([])
  })

  it('refuses a git package', async () => {
    const host = createWordpressExecutionHost(config, dependencies())
    const gitPackage = { ...taskPackage, baseRevision: { kind: 'git' as const, commitSha: 'a'.repeat(40) } }
    await expect(host.execute({ taskPackage: gitPackage, scope: hostScope, actorUserId: randomUUID(), baseDir: root })).rejects.toThrow('snapshot_revision_required')
  })
})

describe('Cezar prompt', () => {
  it('carries the task, criteria, required tests and the editable-path contract', () => {
    const prompt = buildCezarPrompt(loadTaskPackageFixture('snapshot'))
    expect(prompt).toContain('AC-101')
    expect(prompt).toContain(TEST_ID)
    expect(prompt).toContain('templates/')
    expect(prompt).toContain('do not ask questions')
  })
})
