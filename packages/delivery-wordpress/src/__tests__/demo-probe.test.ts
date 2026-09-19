import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { runDemoProbe } from '../demo-probe.ts'
import { createWordPressStudioTools } from '../tools.ts'
import { siteIdFor } from '../ownership.ts'
import type { DemoPluginsReport } from '../demo-plugins.ts'
import type { runDemoNativeProbe } from '../demo-native.ts'

function fixture() {
  const request = { scope: { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() },
    attemptId: randomUUID(), idempotencyKey: 'demo-fixture', name: 'Demo fixture', themeSlug: 'demo-fixture' }
  const siteId = siteIdFor(request.scope)
  const config = { sitesRoot: '/unused-sites', stateRoot: '/unused-state', plugins:
    ['advanced-custom-fields-pro', 'polylang', 'wordpress-seo'].map((slug) => ({ slug, version: '1.0', sha256: 'b'.repeat(64), archivePath: `/private/${slug}.zip` })) }
  const tools = createWordPressStudioTools(config)
  const calls: string[] = []
  tools.createSite = async () => {
    calls.push('create')
    return { schemaVersion: 1, provenance: 'fixture', siteId, scope: request.scope, attemptId: request.attemptId,
      toolExecutionId: randomUUID(), studioSiteId: 'fixture', localUrl: 'http://localhost:9000',
      themeSlug: request.themeSlug, themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [] }
  }
  tools.captureSnapshot = async () => {
    calls.push('snapshot')
    return { schemaVersion: 1, provenance: 'fixture', siteId, toolExecutionId: randomUUID(), creationAttemptId: request.attemptId,
      sourceRevision: { kind: 'snapshot', contentHash: 'b'.repeat(64), externalWorkspaceId: siteId },
      themeFiles: {}, databaseHash: 'c'.repeat(64), capturedAt: new Date().toISOString() }
  }
  tools.start = async () => { calls.push('start'); return { ...await tools.status(request.scope, { siteId }), running: true } }
  tools.stop = async () => { calls.push('stop'); return tools.status(request.scope, { siteId }) }
  tools.status = async () => ({ siteId, running: false, studioSiteId: 'fixture', localUrl: 'http://localhost:9000' })
  const provision = async (): Promise<DemoPluginsReport> => {
    calls.push('plugins')
    return { schemaVersion: 1, provenance: 'fixture', siteId, plugins: [], noindex: true, noindexChanged: false }
  }
  const native: typeof runDemoNativeProbe = async (_scope, _handle, _config, deps) => {
    calls.push('native')
    await deps?.replayPlugins?.()
    return { schemaVersion: 1, provenance: 'fixture', siteId, status: 'passed',
      versions: { wordpress: '6.9', php: '8.3.0' }, checks: { noindex: 'passed', content: 'passed', meta: 'passed', pluginReplayPersistence: 'passed' },
      cleanup: { status: 'passed' }, redeploy: { status: 'not_run', code: 'native_probe_not_redeploy' } }
  }
  const smoke = async () => { calls.push('http'); return { statusCode: 200, bytes: 20 } }
  return { request, config, tools, calls, provision, native, smoke }
}

const failure = () => Object.assign(new Error('PRIVATE_RAW_OUTPUT'), { code: 'COMMAND_FAILED' })

test('operator probe records bounded readiness, replay and finally stops its site', async () => {
  const setup = fixture()
  const report = await runDemoProbe(setup.request, setup.config, setup)
  assert.equal(report.status, 'passed')
  assert.equal(report.provenance, 'fixture')
  assert.deepEqual(setup.calls, ['create', 'start', 'plugins', 'native', 'plugins', 'snapshot', 'http', 'stop'])
  assert.equal(report.checks.length, 7)
  assert.ok(report.checks.every((check) => check.status === 'passed'))
  assert.equal(report.omIntegration, 'not_connected')
  assert.equal(report.preview.status, 'not_published')
  assert.equal(report.acceptanceCriteria, 'not_evaluated')
})

test('plugin failure stops owned site, preserves safe failure and lists checks not run', async () => {
  const setup = fixture()
  setup.provision = async () => { throw failure() }
  const report = await runDemoProbe(setup.request, setup.config, setup)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(setup.calls, ['create', 'start', 'stop'])
  assert.equal(report.checks.find((check) => check.checkId === 'plugins.prepare')?.code, 'COMMAND_FAILED')
  assert.equal(report.checks.find((check) => check.checkId === 'snapshot.capture')?.status, 'not_run')
  assert.ok(!JSON.stringify(report).includes('PRIVATE_'))
})

test('unconfirmed create does not stop a site it cannot prove it created', async () => {
  const setup = fixture()
  setup.tools.createSite = async () => { throw failure() }
  const report = await runDemoProbe(setup.request, setup.config, setup)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(setup.calls, [])
  assert.equal(report.checks.find((check) => check.checkId === 'site.stop')?.status, 'not_run')
  assert.equal(report.reconciliationRequired, true)
})

test('cleanup failure cannot yield a passed report', async () => {
  const setup = fixture()
  setup.tools.stop = async () => { throw failure() }
  const report = await runDemoProbe(setup.request, setup.config, setup)
  assert.equal(report.status, 'blocked')
  assert.equal(report.checks.find((check) => check.checkId === 'site.stop')?.status, 'failed')
})

test('replay changes abort remaining probes and stop site', async () => {
  const setup = fixture()
  let invocations = 0
  const provision = setup.provision
  setup.provision = async () => ({ ...await provision(), noindexChanged: ++invocations > 1 })
  const report = await runDemoProbe(setup.request, setup.config, setup)
  assert.equal(report.status, 'blocked')
  assert.equal(report.checks.find((check) => check.checkId === 'native.edit_and_replay')?.code, 'plugin_replay_changed_state')
  assert.ok(!setup.calls.includes('snapshot'))
  assert.equal(setup.calls.at(-1), 'stop')
})

test('invalid trusted config is rejected before site creation', async () => {
  const setup = fixture()
  await assert.rejects(runDemoProbe(setup.request, { ...setup.config, arbitraryShell: 'private' }, setup), /invalid_input/)
  assert.deepEqual(setup.calls, [])
})

test('native failed report remains visible and blocks snapshot even without an exception', async () => {
  const setup = fixture()
  const native = setup.native
  setup.native = async (...args) => ({ ...await native(...args), status: 'failed', code: 'native_cleanup_unconfirmed', cleanup: { status: 'failed', code: 'native_cleanup_unconfirmed' } })
  const report = await runDemoProbe(setup.request, setup.config, setup)
  assert.equal(report.status, 'blocked')
  assert.equal(report.nativeProbe?.cleanup.status, 'failed')
  assert.ok(!setup.calls.includes('snapshot'))
  assert.equal(setup.calls.at(-1), 'stop')
})

test('start failure still attempts owned stop and prevents plugin mutation', async () => {
  const setup = fixture()
  setup.tools.start = async () => { throw failure() }
  const report = await runDemoProbe(setup.request, setup.config, setup)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(setup.calls, ['create', 'stop'])
  assert.equal(report.checks.find((check) => check.checkId === 'site.start')?.status, 'failed')
  assert.equal(report.checks.find((check) => check.checkId === 'plugins.prepare')?.status, 'not_run')
})
