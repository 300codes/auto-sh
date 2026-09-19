import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createSiteRequestSchema, parseInput, toolError } from './contracts.ts'
import type { ToolCheck } from './contracts.ts'
import { createWordPressStudioTools } from './tools.ts'
import { demoPluginsConfigSchema, provisionDemoPlugins } from './demo-plugins.ts'
import { runDemoNativeProbe } from './demo-native.ts'
import { errorCode, smokeLocalUrl } from './cli-support.ts'
import { siteIdFor } from './ownership.ts'
import { assertRegularFile, assertSafeDirectory } from './paths.ts'

type StudioTools = ReturnType<typeof createWordPressStudioTools>
type ProbeDependencies = {
  tools?: StudioTools
  provision?: typeof provisionDemoPlugins
  native?: typeof runDemoNativeProbe
  smoke?: typeof smokeLocalUrl
}

export async function runDemoProbe(requestValue: unknown, configValue: unknown, dependencies: ProbeDependencies = {}) {
  const request = parseInput(createSiteRequestSchema, requestValue)
  const config = parseInput(demoPluginsConfigSchema, configValue)
  const tools = dependencies.tools ?? createWordPressStudioTools(config)
  const provision = dependencies.provision ?? provisionDemoPlugins
  const native = dependencies.native ?? runDemoNativeProbe
  const handle = { siteId: siteIdFor(request.scope) }
  const checkIds = ['site.create', 'site.start', 'plugins.prepare', 'native.edit_and_replay', 'snapshot.capture', 'http.local', 'site.stop']
  const checks: ToolCheck[] = []
  let stage = checkIds[0]!
  let site: Awaited<ReturnType<StudioTools['createSite']>> | undefined
  let plugins: Awaited<ReturnType<typeof provision>> | undefined
  let replay: Awaited<ReturnType<typeof provision>> | undefined
  let nativeProbe: Awaited<ReturnType<typeof native>> | undefined
  let snapshot: Awaited<ReturnType<StudioTools['captureSnapshot']>> | undefined
  let httpCheck: Awaited<ReturnType<typeof smokeLocalUrl>> | undefined
  const passed = () => checks.push({ checkId: stage, status: 'passed', checkedAt: new Date().toISOString() })
  try {
    site = await tools.createSite(request)
    passed()
    stage = 'site.start'
    await tools.start(request.scope, handle)
    passed()
    stage = 'plugins.prepare'
    plugins = await provision(request.scope, handle, config)
    passed()
    stage = 'native.edit_and_replay'
    nativeProbe = await native(request.scope, handle, { sitesRoot: config.sitesRoot, stateRoot: config.stateRoot, timeoutMs: config.timeoutMs }, { replayPlugins: async () => {
      replay = await provision(request.scope, handle, config)
      if (replay.noindexChanged || replay.plugins.some((plugin) => plugin.action !== 'unchanged')) throw toolError('plugin_replay_changed_state')
    } })
    if (nativeProbe.status !== 'passed') throw toolError(nativeProbe.code ?? 'native_probe_failed')
    passed()
    stage = 'snapshot.capture'
    snapshot = await tools.captureSnapshot(request.scope, handle)
    passed()
    stage = 'http.local'
    httpCheck = await (dependencies.smoke ?? smokeLocalUrl)(site.localUrl)
    passed()
  } catch (error) {
    checks.push({ checkId: stage, status: 'failed', code: errorCode(error), checkedAt: new Date().toISOString() })
  } finally {
    if (site) {
      stage = 'site.stop'
      try { await tools.stop(request.scope, handle); passed() }
      catch (error) { checks.push({ checkId: stage, status: 'failed', code: errorCode(error), checkedAt: new Date().toISOString() }) }
    }
  }
  for (const checkId of checkIds) {
    if (!checks.some((check) => check.checkId === checkId)) checks.push({ checkId, status: 'not_run', checkedAt: new Date().toISOString() })
  }
  const fixture = Object.keys(dependencies).length > 0 || site?.provenance === 'fixture' || plugins?.provenance === 'fixture' || snapshot?.provenance === 'fixture'
  return { schemaVersion: 1, provenance: fixture ? 'fixture' : 'live', status: checks.some((check) => check.status === 'failed') ? 'blocked' : 'passed',
    executionMode: 'standalone_tools', omIntegration: 'not_connected', baselineId: null,
    scope: request.scope, attemptId: request.attemptId, siteId: handle.siteId,
    ...(site ? { site } : {}), ...(plugins ? { plugins } : {}), ...(replay ? { replay } : {}),
    ...(nativeProbe ? { nativeProbe } : {}), ...(snapshot ? { snapshot } : {}), ...(httpCheck ? { httpCheck } : {}), checks,
    acceptanceCriteria: 'not_evaluated', preview: { status: 'not_published', verified: false },
    remaining: ['approved_design', 'tailwind_theme', 'browser_editor', 'redeploy_persistence', 'om_roundtrip', 'studio_preview'],
    translations: 'deferred_by_user',
    reconciliationRequired: checks.some((check) => check.status === 'failed'),
  }
}

async function readPrivateJson(filename: string): Promise<unknown> {
  await assertRegularFile(filename)
  if ((await fs.stat(filename)).size > 64 * 1024) throw toolError('request_size_limit')
  return JSON.parse(await fs.readFile(filename, 'utf8')) as unknown
}

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    request: { type: 'string' }, config: { type: 'string' }, output: { type: 'string' },
  } })
  if (!values.request || !values.config || !values.output) throw toolError('invalid_cli_arguments')
  const request = await readPrivateJson(path.resolve(values.request))
  const config = await readPrivateJson(path.resolve(values.config))
  const outputPath = path.resolve(values.output)
  await assertSafeDirectory(path.dirname(outputPath))
  const output = await fs.open(outputPath, 'wx', 0o600)
  try {
    const report = await runDemoProbe(request, config)
    await output.writeFile(JSON.stringify(report, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ status: report.status, siteId: report.siteId, provenance: report.provenance }) + '\n')
    if (report.status !== 'passed') process.exitCode = 1
  } finally { await output.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(JSON.stringify({ status: 'blocked', code: errorCode(error) }) + '\n')
    process.exitCode = 1
  })
}
