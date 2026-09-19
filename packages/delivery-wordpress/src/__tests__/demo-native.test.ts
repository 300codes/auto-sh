import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runDemoNativeProbe } from '../demo-native.ts'
import { requestHashFor, siteIdFor, withSiteLock, writeRecord } from '../ownership.ts'
import type { CommandRunner } from '../runner.ts'

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wp-native-probe-'))
  const config = { sitesRoot: path.join(directory, 'sites'), stateRoot: path.join(directory, 'state'), timeoutMs: 1000 }
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  for (const folder of [config.sitesRoot, config.stateRoot, sitePath, statePath]) await mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'native', name: 'Native demo', themeSlug: 'native-demo' }
  await writeRecord(statePath, {
    schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready',
    result: { schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId,
      toolExecutionId: randomUUID(), studioSiteId: 'owned-studio-site', localUrl: 'http://localhost:12345', themeSlug: request.themeSlug,
      themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [] },
  })
  const calls: string[][] = []
  let post: { ID: number; post_name: string; post_title: string; post_status: string; post_content: string } | undefined
  let meta = ''
  let inventoryCalls = 0
  const faults = { failUpdate: false, createThrows: false, failMetaRead: false, failDelete: false, malformedId: false, foreignPost: false, replaceRegistration: false, noindex: '0' }
  const runner: CommandRunner = async (executable, args, options) => {
    calls.push([...args])
    assert.equal(executable, 'studio')
    if (args[0] === 'site') {
      inventoryCalls += 1
      return { stdout: JSON.stringify([{ id: faults.replaceRegistration && inventoryCalls > 1 ? 'foreign-site' : 'owned-studio-site', path: sitePath, running: true }]), exitCode: 0 }
    }
    assert.equal(args.at(-1), sitePath)
    assert.equal(options?.timeoutMs, 1000)
    const command = args.slice(1, -2)
    let stdout = ''
    if (command[0] === 'core') stdout = '6.9.4'
    else if (command[0] === 'eval') { assert.deepEqual(command, ['eval', 'echo PHP_VERSION;']); stdout = '8.3.16' }
    else if (command[0] === 'option') stdout = faults.noindex
    else if (command[1] === 'create') {
      post = { ID: 42, post_name: command.find((arg) => arg.startsWith('--post_name='))!.split('=')[1]!,
        post_title: command.find((arg) => arg.startsWith('--post_title='))!.split('=')[1]!, post_status: 'draft', post_content: '' }
      if (faults.createThrows) throw new Error('PRIVATE_SECRET')
      stdout = faults.malformedId ? '42; PRIVATE_SECRET' : '42'
    } else if (command[1] === 'list') stdout = JSON.stringify(post ? [post] : [])
    else if (command[1] === 'get') {
      assert.equal(command[2], '42')
      stdout = JSON.stringify(faults.foreignPost && post ? { ...post, post_title: 'existing customer content' } : post)
    } else if (command[1] === 'update') {
      assert.equal(command[2], '42'); assert.ok(post)
      if (faults.failUpdate) throw new Error('PRIVATE_SECRET')
      post.post_content = command[3]!.slice('--post_content='.length)
    } else if (command[1] === 'meta' && command[2] === 'update') {
      assert.equal(command[3], '42'); assert.equal(command[4], '_om_native_probe'); meta = command[5]!
    } else if (command[1] === 'meta' && command[2] === 'get') {
      if (faults.failMetaRead) throw new Error('PRIVATE_SECRET /private/native/path')
      stdout = meta
    } else if (command[1] === 'delete') {
      assert.deepEqual(command, ['post', 'delete', '42', '--force'])
      if (faults.failDelete) throw new Error('PRIVATE_SECRET')
      post = undefined
    } else throw new Error('Unexpected fixture command')
    return { stdout, exitCode: 0 }
  }
  return { directory, config, scope, handle, statePath, faults, calls, runner,
    hasPost: () => !!post, corruptContent: () => { assert.ok(post); post.post_content = 'changed during replay' },
    dispose: () => rm(directory, { recursive: true, force: true }) }
}

test('native CRUD verifies versions, noindex and plugin replay persistence between separate locks', async () => {
  const context = await fixture()
  try {
    let replayed = false
    const report = await runDemoNativeProbe(context.scope, context.handle, context.config, {
      runner: context.runner,
      replayPlugins: async () => {
        await assert.rejects(stat(path.join(context.statePath, 'operation.lock')))
        await withSiteLock(context.statePath, async () => { replayed = true; assert.equal(context.hasPost(), true) })
      },
    })
    assert.equal(replayed, true)
    assert.equal(report.status, 'passed')
    assert.deepEqual(report.versions, { wordpress: '6.9.4', php: '8.3.16' })
    assert.deepEqual(report.checks, { noindex: 'passed', content: 'passed', meta: 'passed', pluginReplayPersistence: 'passed' })
    assert.deepEqual(report.cleanup, { status: 'passed' })
    assert.equal(report.provenance, 'fixture')
    assert.equal(report.redeploy.status, 'not_run')
    assert.equal(context.hasPost(), false)
    assert.equal(context.calls.filter((args) => args[2] === 'delete').length, 1)
    await assert.rejects(stat(path.join(context.statePath, 'operation.lock')))
    assert.ok(!JSON.stringify(report).includes(context.directory))
  } finally { await context.dispose() }
})

test('foreign scope and changed Studio registration cannot issue WP mutations', async () => {
  const context = await fixture()
  try {
    await assert.rejects(runDemoNativeProbe({ ...context.scope, tenantId: randomUUID() }, context.handle, context.config, { runner: context.runner }), /ownership_mismatch/)
    assert.equal(context.calls.length, 0)
    context.faults.replaceRegistration = true
    assert.equal((await runDemoNativeProbe(context.scope, context.handle, context.config, { runner: context.runner })).status, 'failed')
    assert.equal(context.calls.some((args) => args[0] === 'wp'), false)
  } finally { await context.dispose() }
})

for (const scenario of ['read failure', 'replay failure', 'changed content'] as const) {
  test(`${scenario} still cleans only the probe draft and sanitizes errors`, async () => {
    const context = await fixture()
    try {
      context.faults.failMetaRead = scenario === 'read failure'
      const report = await runDemoNativeProbe(context.scope, context.handle, context.config, { runner: context.runner,
        replayPlugins: async () => {
          if (scenario === 'replay failure') throw new Error('PRIVATE_SECRET')
          if (scenario === 'changed content') context.corruptContent()
        },
      })
      assert.equal(report.status, 'failed')
      assert.equal(report.cleanup.status, 'passed')
      assert.equal(context.hasPost(), false)
      assert.ok(!JSON.stringify(report).includes('PRIVATE_SECRET'))
      await assert.rejects(stat(path.join(context.statePath, 'operation.lock')))
    } finally { await context.dispose() }
  })
}

for (const scenario of ['malformedId', 'foreignPost', 'failDelete'] as const) {
  test(`${scenario} fails closed and retains reconciliation lock`, async () => {
    const context = await fixture()
    try {
      context.faults[scenario] = true
      const report = await runDemoNativeProbe(context.scope, context.handle, context.config, { runner: context.runner })
      assert.equal(report.status, 'failed')
      assert.ok((await stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
      if (scenario === 'foreignPost') assert.equal(context.calls.some((args) => args[2] === 'delete'), false)
      if (scenario === 'malformedId') assert.equal(report.cleanup.status, 'passed')
      else assert.equal(report.cleanup.status, 'failed')
      assert.ok(!JSON.stringify(report).includes('PRIVATE_SECRET'))
    } finally { await context.dispose() }
  })
}

test('noindex failure creates no post and missing replay never claims persistence', async () => {
  const context = await fixture()
  try {
    context.faults.noindex = '1'
    const denied = await runDemoNativeProbe(context.scope, context.handle, context.config, { runner: context.runner })
    assert.equal(denied.status, 'failed')
    assert.equal(denied.checks.noindex, 'failed')
    assert.equal(context.calls.some((args) => args[2] === 'create'), false)
    context.faults.noindex = '0'
    const allowed = await runDemoNativeProbe(context.scope, context.handle, context.config, { runner: context.runner })
    assert.equal(allowed.status, 'passed')
    assert.equal(allowed.checks.pluginReplayPersistence, 'not_run')
  } finally { await context.dispose() }
})

for (const scenario of ['failUpdate', 'createThrows'] as const) {
  test(`${scenario} attempts cleanup after the draft was created`, async () => {
    const context = await fixture()
    try {
      context.faults[scenario] = true
      const report = await runDemoNativeProbe(context.scope, context.handle, context.config, { runner: context.runner })
      assert.equal(report.status, 'failed')
      assert.equal(report.cleanup.status, 'passed')
      assert.equal(context.hasPost(), false)
      assert.equal(context.calls.filter((args) => args[2] === 'delete').length, 1)
      if (scenario === 'createThrows') {
        assert.equal(report.code, 'native_reconciliation_required')
        assert.ok((await stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
      } else await assert.rejects(stat(path.join(context.statePath, 'operation.lock')))
    } finally { await context.dispose() }
  })
}

test('failed plugin mutation lock is never stolen for cleanup', async () => {
  const context = await fixture()
  try {
    const report = await runDemoNativeProbe(context.scope, context.handle, context.config, { runner: context.runner,
      replayPlugins: () => withSiteLock(context.statePath, async () => { throw new Error('PRIVATE_SECRET') }),
    })
    assert.equal(report.status, 'failed')
    assert.equal(report.cleanup.status, 'failed')
    assert.equal(report.code, 'native_reconciliation_required')
    assert.equal(context.hasPost(), true)
    assert.equal(context.calls.some((args) => args[2] === 'delete'), false)
    assert.ok((await stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
  } finally { await context.dispose() }
})
