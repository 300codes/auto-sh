import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { mapWordpressResult, type WordpressResultMappingInput } from '../../lib/wordpressResultMapper'
import { type TaskPackageV1 } from '../../lib/contracts'

const absolute = z.string().refine(path.isAbsolute)
const configSchema = z.object({
  operatorRoot: absolute, sitesRoot: absolute, stateRoot: absolute, toolchainRoot: absolute,
  checkToolchainRoot: absolute, evidenceRoot: absolute, disposalPlan: z.string().min(1),
}).strict()
export type RoundtripConfig = z.infer<typeof configSchema>
type Scope = WordpressResultMappingInput['trusted']['scope']
type Frozen = WordpressResultMappingInput['base']
type Handle = { siteId: string }
type Receipt = { receiptId: string; receiptHash: string; snapshotId: string; snapshot: Frozen['snapshot'] }
type Site = { siteId: string; localUrl: string; attemptId: string; provenance: string }
type Tools = {
  createSite(input: { scope: Scope; attemptId: string; idempotencyKey: string; name: string; themeSlug: string }): Promise<Site>
  stop(scope: Scope, handle: Handle): Promise<unknown>
}
type Capture = {
  captureOwnedSnapshot(input: unknown): Promise<Receipt>
  readCapturedOwnedSnapshot(input: unknown): Promise<{ artifacts: Frozen }>
}
const here = path.dirname(fileURLToPath(import.meta.url))
export const smokeTestIds = ['WP frozen AC-001: paragraph contains the attempt marker', 'WP frozen AC-002: all captured PHP files have valid syntax']
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

async function safeDirectory(directory: string) {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || await fs.realpath(directory) !== directory) throw new Error('[internal] wordpress_roundtrip_directory_invalid')
}

export async function readRoundtripConfig(filename: string) {
  if (!path.isAbsolute(filename) || await fs.realpath(filename) !== filename) throw new Error('[internal] wordpress_roundtrip_config_invalid')
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > 65536) throw new Error('[internal] wordpress_roundtrip_private_config_required')
    const config = configSchema.parse(JSON.parse(await file.readFile('utf8')))
    for (const root of [config.operatorRoot, config.sitesRoot, config.stateRoot, config.toolchainRoot, config.checkToolchainRoot, config.evidenceRoot]) await safeDirectory(root)
    for (const root of [config.sitesRoot, config.stateRoot, config.evidenceRoot]) {
      if ((await fs.stat(root)).mode & 0o077) throw new Error('[internal] wordpress_roundtrip_private_root_required')
    }
    return config
  } finally { await file.close() }
}

async function operatorModule(config: RoundtripConfig, filename: string): Promise<Record<string, unknown>> {
  const metadata = JSON.parse(await fs.readFile(path.join(config.operatorRoot, 'package.json'), 'utf8')) as { name?: unknown }
  if (metadata.name !== '@open-mercato/delivery-wordpress') throw new Error('[internal] wordpress_roundtrip_operator_invalid')
  const target = path.join(config.operatorRoot, 'dist', `${filename}.js`)
  if (await fs.realpath(target) !== target || !(await fs.lstat(target)).isFile()) throw new Error('[internal] wordpress_roundtrip_operator_invalid')
  return import(pathToFileURL(target).href)
}

export async function openRoundtrip(config: RoundtripConfig, scope: Scope) {
  const runId = randomUUID()
  const directory = await fs.mkdtemp(path.join(config.evidenceRoot, 'wp-roundtrip-'))
  const commonConfig = { sitesRoot: config.sitesRoot, stateRoot: config.stateRoot, timeoutMs: 180000 }
  const toolsModule = await operatorModule(config, 'tools')
  const capture = await operatorModule(config, 'capture-owned-snapshot')
  const update = await operatorModule(config, 'theme-update')
  if (typeof toolsModule.createWordPressStudioTools !== 'function' || typeof capture.captureOwnedSnapshot !== 'function' || typeof capture.readCapturedOwnedSnapshot !== 'function' || typeof update.updateOwnedTheme !== 'function') throw new Error('[internal] wordpress_roundtrip_operator_unavailable')
  const tools = toolsModule.createWordPressStudioTools(commonConfig) as Tools
  const captureTools = capture as unknown as Capture
  const updateTheme = update.updateOwnedTheme as (value: unknown) => Promise<unknown>
  const siteId = sha256(JSON.stringify([scope.tenantId, scope.organizationId, scope.projectId]))
  const handle = { siteId }
  const creationAttemptId = randomUUID()
  const active = new Set<Promise<unknown>>()
  let closing = false
  async function runOwned<Value>(work: () => Promise<Value>): Promise<Value> {
    if (closing) throw new Error('[internal] wordpress_roundtrip_closing')
    const pending = work()
    active.add(pending)
    try { return await pending } finally { active.delete(pending) }
  }
  const write = async (name: string, value: unknown) => fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await write('ledger.json', { runId, scope, siteId, creationAttemptId, disposalPlan: config.disposalPlan, physicalCleanup: 'retained_owned_site_requires_explicit_disposal', proofScope: 'manual technical frozen-byte checks; no visual design, FLOW, automated executor or release proof' })
  return {
    runId, directory, siteId, creationAttemptId, write,
    async create() {
      const site = await runOwned(() => tools.createSite({ scope, attemptId: creationAttemptId, idempotencyKey: runId, name: 'Manual QA technical roundtrip', themeSlug: 'qa-technical-roundtrip' }))
      const url = new URL(site.localUrl)
      if (site.siteId !== siteId || site.attemptId !== creationAttemptId || site.provenance !== 'live' || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('[internal] wordpress_roundtrip_site_mismatch')
      return site
    },
    capture: () => runOwned(() => captureTools.captureOwnedSnapshot({ scope, handle, config: commonConfig })),
    read: (receipt: Receipt) => runOwned(() => captureTools.readCapturedOwnedSnapshot({ scope, handle, receiptId: receipt.receiptId, expectedReceiptHash: receipt.receiptHash, config: { stateRoot: config.stateRoot } })),
    checks: (marker: string, frozen: Frozen, taskPackage: TaskPackageV1) => runOwned(() => runFrozenChecks(config, directory, marker, frozen, taskPackage)),
    async update(receipt: Receipt, marker: string) {
      const content = `<!-- wp:paragraph --><p>${marker}</p><!-- /wp:paragraph -->\n`
      const result = await runOwned(() => updateTheme({ scope, handle, updateId: randomUUID(), changes: [{ path: 'templates/front-page.html', expectedHash: receipt.snapshot.themeFiles['templates/front-page.html'], content }], config: { ...commonConfig, timeoutMs: 120000, toolchainRoot: config.toolchainRoot } }))
      z.object({ status: z.literal('passed'), action: z.literal('updated') }).parse(result)
    },
    async stop() {
      closing = true
      await Promise.allSettled([...active])
      await tools.stop(scope, handle)
      await write('site-cleanup.json', { siteId, state: 'stopped', retained: true, reason: 'explicit owned-site disposal required', disposalPlan: config.disposalPlan })
    },
  }
}

function execute(command: string, args: string[], cwd: string, marker: string) {
  const started = Date.now()
  return new Promise<{ command: string; exitCode: number; durationMs: number; stdout: string; stderr: string }>((resolve) => {
    execFile(command, args, { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, OM_WP_FROZEN_MARKER: marker, npm_config_offline: 'true', npm_config_yes: 'false', PLAYWRIGHT_JSON_OUTPUT_NAME: 'smoke-report.json' } }, (error, stdout, stderr) => {
      resolve({ command: [command, ...args].join(' '), exitCode: error ? (typeof error.code === 'number' && !error.killed ? error.code : -1) : 0, durationMs: Date.now() - started, stdout, stderr })
    })
  })
}

export async function runFrozenChecks(config: RoundtripConfig, directory: string, marker: string, frozen: Frozen, taskPackage: TaskPackageV1) {
  const work = await fs.mkdtemp(path.join(directory, 'checks-'))
  const theme = path.join(work, 'theme')
  await fs.mkdir(theme, { mode: 0o700 })
  for (const [name, artifact] of Object.entries(frozen.theme)) {
    if (sha256(artifact.bytes) !== frozen.snapshot.themeFiles[name]) throw new Error('[internal] wordpress_roundtrip_frozen_hash_mismatch')
    const filename = path.resolve(theme, name)
    if (!filename.startsWith(`${theme}${path.sep}`)) throw new Error('[internal] wordpress_roundtrip_frozen_path_invalid')
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    await fs.writeFile(filename, artifact.bytes, { mode: 0o400, flag: 'wx' })
  }
  await fs.symlink(path.join(config.checkToolchainRoot, 'node_modules'), path.join(work, 'node_modules'))
  const smoke = await fs.readFile(path.join(here, 'frozen-smoke.cjs'))
  const lint = await fs.readFile(path.join(here, 'frozen-lint.cjs'))
  const playwrightConfig = "module.exports={testDir:'./tests',testMatch:'frozen-smoke.cjs',workers:1,retries:0,reporter:[['json']],use:{}}\n"
  const composerConfig = JSON.stringify({ scripts: { lint: 'node frozen-lint.cjs' } })
  await fs.mkdir(path.join(work, 'tests'), { mode: 0o700 })
  await fs.writeFile(path.join(work, 'tests/frozen-smoke.cjs'), smoke, { mode: 0o600 })
  await fs.writeFile(path.join(work, 'frozen-lint.cjs'), lint, { mode: 0o600 })
  await fs.writeFile(path.join(work, 'playwright.config.cjs'), playwrightConfig, { mode: 0o600 })
  await fs.writeFile(path.join(work, 'composer.json'), composerConfig, { mode: 0o600 })
  const smokeProcess = await execute('npx', ['playwright', 'test'], work, marker)
  await fs.writeFile(path.join(work, 'smoke-process.json'), JSON.stringify(smokeProcess), { mode: 0o600 })
  const lintProcess = await execute('composer', ['run', 'lint'], work, marker)
  await fs.writeFile(path.join(work, 'lint-process.json'), JSON.stringify(lintProcess), { mode: 0o600 })
  const report = await fs.readFile(path.join(work, 'smoke-report.json'))
  const reportSchema = z.object({ suites: z.array(z.unknown()), stats: z.object({ expected: z.number(), unexpected: z.number(), skipped: z.number(), flaky: z.number() }) })
  const parsed = reportSchema.parse(JSON.parse(report.toString('utf8')))
  if (smokeProcess.exitCode !== 0 || lintProcess.exitCode !== 0 || parsed.stats.expected !== 2 || parsed.stats.unexpected || parsed.stats.skipped || parsed.stats.flaky) throw new Error('[internal] wordpress_roundtrip_real_checks_failed')
  const observedTests: string[] = []
  function inspectSuite(value: unknown) {
    const suite = z.object({ suites: z.array(z.unknown()).default([]), specs: z.array(z.object({ title: z.string(), tests: z.array(z.object({ status: z.literal('expected'), results: z.array(z.object({ status: z.literal('passed') })).length(1) })).length(1) })).default([]) }).parse(value)
    for (const spec of suite.specs) observedTests.push(spec.title)
    for (const child of suite.suites) inspectSuite(child)
  }
  for (const suite of parsed.suites) inspectSuite(suite)
  if (JSON.stringify(observedTests.sort()) !== JSON.stringify([...smokeTestIds].sort())) throw new Error('[internal] wordpress_roundtrip_test_identity_mismatch')
  for (const [name, artifact] of Object.entries(frozen.theme)) {
    if (sha256(await fs.readFile(path.join(theme, name))) !== sha256(artifact.bytes)) throw new Error('[internal] wordpress_roundtrip_check_mutated_input')
  }
  const prefix = `checks/${path.basename(work)}`
  const smokeDefinition = Buffer.from(JSON.stringify({ source: smoke.toString('utf8'), config: playwrightConfig }))
  const lintDefinition = Buffer.from(JSON.stringify({ source: lint.toString('utf8'), composer: composerConfig }))
  const smokeReport = Buffer.from(JSON.stringify({ ...smokeProcess, playwright: JSON.parse(report.toString('utf8')) }))
  const lintReport = Buffer.from(JSON.stringify(lintProcess))
  await fs.writeFile(path.join(work, 'smoke-definition.json'), smokeDefinition, { mode: 0o600 })
  await fs.writeFile(path.join(work, 'lint-definition.json'), lintDefinition, { mode: 0o600 })
  await fs.writeFile(path.join(work, 'smoke-proof.json'), smokeReport, { mode: 0o600 })
  await fs.writeFile(path.join(work, 'lint-proof.json'), lintReport, { mode: 0o600 })
  const common = { validationProfileVersion: taskPackage.validationProfile.version, sourceRevision: frozen.snapshot.sourceRevision, status: 'passed' as const, exitCode: 0 }
  const checks: WordpressResultMappingInput['checks'] = smokeTestIds.map((testId, index) => ({
    check: { ...common, checkId: 'smoke-tests', testId, acIds: [`AC-00${index + 1}`], commandProfileId: 'playwright-smoke', durationMs: smokeProcess.durationMs, testDefinitionHash: sha256(smokeDefinition), rawReportHash: sha256(smokeReport) },
    definition: { path: `${prefix}/smoke-definition.json`, bytes: smokeDefinition }, report: { path: `${prefix}/smoke-proof.json`, bytes: smokeReport },
  }))
  checks.push({ check: { ...common, checkId: 'lint', testId: 'lint', acIds: [], commandProfileId: 'php-lint', durationMs: lintProcess.durationMs, testDefinitionHash: sha256(lintDefinition), rawReportHash: sha256(lintReport) }, definition: { path: `${prefix}/lint-definition.json`, bytes: lintDefinition }, report: { path: `${prefix}/lint-proof.json`, bytes: lintReport } })
  return checks
}

export function mapRoundtripResult(taskPackage: TaskPackageV1, scope: Scope, base: Frozen, result: Frozen, checks: WordpressResultMappingInput['checks'], externalRunId: string) {
  const execution = { projectId: taskPackage.projectId, taskId: taskPackage.taskId, attemptId: taskPackage.attemptId, baselineId: taskPackage.baselineId, baselineHash: taskPackage.baselineHash, targetProfileId: taskPackage.targetProfileId, targetProfileVersion: taskPackage.targetProfileVersion, packageSchemaVersion: taskPackage.schemaVersion, externalRunId }
  return mapWordpressResult({ taskPackage, base, result, checks, execution, trusted: { scope, siteId: base.snapshot.siteId, creationAttemptId: base.snapshot.creationAttemptId, baseToolExecutionId: base.snapshot.toolExecutionId, resultToolExecutionId: result.snapshot.toolExecutionId, execution }, usage: { source: 'runner', values: 'unknown' } })
}
