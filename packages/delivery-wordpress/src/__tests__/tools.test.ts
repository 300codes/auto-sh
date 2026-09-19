import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import http from 'node:http'
import https from 'node:https'
import test from 'node:test'
import type { CreateSiteRequest } from '../contracts.ts'
import { siteIdFor } from '../ownership.ts'
import type { CommandRunner } from '../runner.ts'
import { createWordPressStudioTools } from '../tools.ts'

function barrier() {
  let resolve: () => void = () => { throw new Error('[internal] Barrier not initialized') }
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-tools-'))
  const sitesRoot = path.join(directory, 'sites')
  const stateRoot = path.join(directory, 'state')
  const sites = new Map<string, { id: string; path: string; running: boolean; theme: string }>()
  const calls: string[][] = []
  let failCreate = false
  const runner: CommandRunner = async (executable, args) => {
    calls.push([executable, ...args])
    assert.ok(!args.some((argument) => argument.includes('5180') || argument.includes('ai-wordpress-orchestrator')))
    if (executable === 'git') {
      assert.ok(['init', 'add', '-c', 'rev-parse'].includes(args[0] ?? ''))
      return { stdout: args[0] === 'rev-parse' ? 'a'.repeat(40) : '', exitCode: 0 }
    }
    assert.equal(executable, 'studio')
    if (args[0] === 'site' && args[1] === 'list') return { stdout: 'Studio banner\n' + JSON.stringify([...sites.values()]), exitCode: 0 }
    const sitePath = args[args.indexOf('--path') + 1]
    assert.ok(sitePath)
    if (args[0] === 'site' && args[1] === 'create') {
      assert.equal(args[args.indexOf('--runtime') + 1], 'sandbox')
      assert.ok(args.includes('--skip-log-details'))
      await mkdir(path.join(sitePath, 'wp-content', 'themes'), { recursive: true, mode: 0o700 })
      await mkdir(path.join(sitePath, 'wp-content', 'database'), { mode: 0o700 })
      const database = new DatabaseSync(path.join(sitePath, 'wp-content', 'database', '.ht.sqlite'))
      database.exec("CREATE TABLE options (name TEXT, value TEXT); INSERT INTO options VALUES ('private', 'PRIVATE_DATABASE_VALUE')")
      database.close()
      sites.set(sitePath, { id: randomUUID(), path: sitePath, running: true, theme: '' })
      if (failCreate) throw Object.assign(new Error('[internal] COMMAND_INTERRUPTED'), { code: 'COMMAND_INTERRUPTED' })
      return { stdout: '', exitCode: 0 }
    }
    const site = sites.get(sitePath)
    assert.ok(site)
    if (args[0] === 'site' && ['start', 'stop'].includes(args[1] ?? '')) {
      site.running = args[1] === 'start'
      return { stdout: '', exitCode: 0 }
    }
    if (args[0] === 'wp' && args[1] === 'theme' && args[2] === 'activate') {
      site.theme = args[3] ?? ''
      return { stdout: '', exitCode: 0 }
    }
    if (args[0] === 'wp' && args[1] === 'option' && args[2] === 'get') {
      assert.ok(['stylesheet', 'siteurl'].includes(args[3] ?? ''))
      return { stdout: args[3] === 'stylesheet' ? site.theme : 'http://localhost:9999', exitCode: 0 }
    }
    throw new Error('[internal] Unexpected test command')
  }
  const request: CreateSiteRequest = {
    scope: { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() },
    attemptId: randomUUID(), idempotencyKey: 'create-demo', name: 'New project', themeSlug: 'om-demo',
  }
  return { directory, sitesRoot, stateRoot, calls, request, runner,
    tools: createWordPressStudioTools({ sitesRoot, stateRoot }, { runner }),
    failCreate: () => { failCreate = true },
    cleanup: () => rm(directory, { recursive: true, force: true }),
    createCount: () => calls.filter((call) => call[0] === 'studio' && call[1] === 'site' && call[2] === 'create').length,
  }
}

test('create is idempotent, rejects changed requests and isolates tenant ownership', async () => {
  const context = await fixture()
  try {
    const result = await context.tools.createSite(context.request)
    assert.equal(result.provenance, 'fixture')
    assert.deepEqual(await context.tools.createSite(context.request), result)
    assert.equal(context.createCount(), 1)
    await assert.rejects(context.tools.createSite({ ...context.request, name: 'Different name' }), /idempotency_conflict/)
    const foreignScope = { ...context.request.scope, tenantId: randomUUID() }
    await assert.rejects(context.tools.status(foreignScope, { siteId: result.siteId }), /ownership_mismatch/)
    const other = await context.tools.createSite({ ...context.request, scope: foreignScope })
    assert.notEqual(other.siteId, result.siteId)
    assert.equal(context.createCount(), 2)
  } finally { await context.cleanup() }
})

test('parallel create performs the external effect once', async () => {
  const context = await fixture()
  try {
    const outcomes = await Promise.allSettled([context.tools.createSite(context.request), context.tools.createSite(context.request)])
    assert.ok(outcomes.some((outcome) => outcome.status === 'fulfilled'))
    assert.equal(context.createCount(), 1)
    for (const outcome of outcomes) if (outcome.status === 'rejected') assert.match(String(outcome.reason), /reconciliation_required/)
    await context.tools.createSite(context.request)
    assert.equal(context.createCount(), 1)
  } finally { await context.cleanup() }
})

test('preexisting target is never adopted or changed', async () => {
  const context = await fixture()
  try {
    const target = path.join(context.sitesRoot, siteIdFor(context.request.scope))
    await mkdir(target, { recursive: true, mode: 0o700 })
    await assert.rejects(context.tools.createSite(context.request), /site_path_exists/)
    assert.equal(context.createCount(), 0)
    assert.deepEqual(await readdir(target), [])
  } finally { await context.cleanup() }
})

test('uncertain create survives restart and never reruns the external effect', async () => {
  const context = await fixture()
  try {
    context.failCreate()
    await assert.rejects(context.tools.createSite(context.request), /COMMAND_INTERRUPTED/)
    const record = JSON.parse(await readFile(path.join(context.stateRoot, siteIdFor(context.request.scope), 'record.json'), 'utf8'))
    assert.equal(record.status, 'creating')
    const restarted = createWordPressStudioTools({ sitesRoot: context.sitesRoot, stateRoot: context.stateRoot }, { runner: context.runner })
    await assert.rejects(restarted.createSite(context.request), /reconciliation_required/)
    assert.equal(context.createCount(), 1)
  } finally { await context.cleanup() }
})

test('start stop and snapshot preserve runtime state and keep database evidence private', async () => {
  const context = await fixture()
  try {
    const result = await context.tools.createSite(context.request)
    const handle = { siteId: result.siteId }
    const scope = context.request.scope
    assert.equal((await context.tools.status(scope, handle)).running, true)
    assert.equal((await context.tools.stop(scope, handle)).running, false)
    assert.equal((await context.tools.start(scope, handle)).running, true)
    const snapshot = await context.tools.captureSnapshot(scope, handle)
    assert.equal(snapshot.provenance, 'fixture')
    assert.match(snapshot.sourceRevision.contentHash, /^[a-f0-9]{64}$/)
    assert.match(snapshot.databaseHash, /^[a-f0-9]{64}$/)
    assert.ok(Object.keys(snapshot.themeFiles).includes('style.css'))
    assert.equal((await context.tools.status(scope, handle)).running, true)
    const serialized = JSON.stringify(snapshot)
    assert.ok(!serialized.includes('PRIVATE_DATABASE_VALUE'))
    assert.ok(!serialized.includes(context.directory))
    const snapshotRoot = path.join(context.stateRoot, result.siteId, 'snapshots')
    const privateDirectory = path.join(snapshotRoot, (await readdir(snapshotRoot))[0]!)
    assert.equal((await stat(privateDirectory)).mode & 0o777, 0o700)
    assert.equal((await stat(path.join(privateDirectory, 'database.sqlite'))).mode & 0o777, 0o600)
    await context.tools.stop(scope, handle)
    await context.tools.captureSnapshot(scope, handle)
    assert.equal((await context.tools.status(scope, handle)).running, false)
  } finally { await context.cleanup() }
})

test('tools operate through the runner without HTTP or an old orchestrator endpoint', async (contextTest) => {
  const context = await fixture()
  const blockNetwork = () => { throw new Error('[internal] Unexpected network access') }
  const guards = [
    contextTest.mock.method(globalThis, 'fetch', blockNetwork),
    contextTest.mock.method(http, 'get', blockNetwork),
    contextTest.mock.method(http, 'request', blockNetwork),
    contextTest.mock.method(https, 'get', blockNetwork),
    contextTest.mock.method(https, 'request', blockNetwork),
  ]
  try {
    const result = await context.tools.createSite(context.request)
    await context.tools.captureSnapshot(context.request.scope, { siteId: result.siteId })
    for (const guard of guards) assert.equal(guard.mock.callCount(), 0)
  } finally {
    contextTest.mock.restoreAll()
    await context.cleanup()
  }
})

test('an unconfirmed snapshot stop retains the lock and never restarts or captures', async () => {
  const context = await fixture()
  const runner: CommandRunner = async (executable, args, options) => {
    const result = await context.runner(executable, args, options)
    if (executable === 'studio' && args[0] === 'site' && args[1] === 'stop') {
      throw Object.assign(new Error('[internal] COMMAND_INTERRUPTED'), { code: 'COMMAND_INTERRUPTED' })
    }
    return result
  }
  const tools = createWordPressStudioTools({ sitesRoot: context.sitesRoot, stateRoot: context.stateRoot }, { runner })
  try {
    const result = await tools.createSite(context.request)
    const handle = { siteId: result.siteId }
    await assert.rejects(tools.captureSnapshot(context.request.scope, handle), /snapshot_stop_unconfirmed/)
    assert.equal((await tools.status(context.request.scope, handle)).running, false)
    const stateDirectory = path.join(context.stateRoot, result.siteId)
    assert.ok((await stat(path.join(stateDirectory, 'operation.lock'))).isDirectory())
    await assert.rejects(stat(path.join(stateDirectory, 'snapshots')), { code: 'ENOENT' })
    assert.equal(context.calls.filter((call) => call[0] === 'studio' && call[1] === 'site' && call[2] === 'start').length, 0)
    await assert.rejects(tools.start(context.request.scope, handle), /site_busy_or_reconciliation_required/)
  } finally { await context.cleanup() }
})

test('capture holds a site lock against simultaneous start and another capture', async () => {
  const context = await fixture()
  const stopEntered = barrier()
  const stopReleased = barrier()
  const runner: CommandRunner = async (executable, args, options) => {
    const result = await context.runner(executable, args, options)
    if (executable === 'studio' && args[0] === 'site' && args[1] === 'stop') {
      stopEntered.resolve()
      await stopReleased.promise
    }
    return result
  }
  const tools = createWordPressStudioTools({ sitesRoot: context.sitesRoot, stateRoot: context.stateRoot }, { runner })
  let capture: ReturnType<typeof tools.captureSnapshot> | undefined
  try {
    const result = await tools.createSite(context.request)
    const handle = { siteId: result.siteId }
    capture = tools.captureSnapshot(context.request.scope, handle)
    await stopEntered.promise
    await assert.rejects(tools.start(context.request.scope, handle), /site_busy_or_reconciliation_required/)
    await assert.rejects(tools.captureSnapshot(context.request.scope, handle), /site_busy_or_reconciliation_required/)
    stopReleased.resolve()
    const snapshot = await capture
    assert.equal(snapshot.provenance, 'fixture')
    assert.equal((await tools.status(context.request.scope, handle)).running, true)
  } finally {
    stopReleased.resolve()
    if (capture) await capture.catch(() => undefined)
    await context.cleanup()
  }
})
