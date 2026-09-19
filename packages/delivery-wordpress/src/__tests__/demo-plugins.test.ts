import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, symlink, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { archiveHttpPolicyPhp, demoPluginsConfigSchema, provisionDemoPlugins, type DemoPluginsConfig } from '../demo-plugins.ts'
import { siteIdFor, requestHashFor, writeRecord } from '../ownership.ts'
import type { CreateSiteRequest } from '../contracts.ts'
import type { CommandRunner } from '../runner.ts'

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wp-demo-plugins-'))
  const sitesRoot = path.join(directory, 'sites')
  const stateRoot = path.join(directory, 'state')
  const archivesRoot = path.join(directory, 'archives')
  for (const root of [sitesRoot, stateRoot, archivesRoot]) await mkdir(root, { mode: 0o700 })
  const request: CreateSiteRequest = { scope: { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }, attemptId: randomUUID(), idempotencyKey: 'fixture', name: 'Fixture', themeSlug: 'fixture' }
  const siteId = siteIdFor(request.scope)
  const sitePath = path.join(sitesRoot, siteId)
  const statePath = path.join(stateRoot, siteId)
  await mkdir(sitePath, { mode: 0o700 })
  await mkdir(statePath, { mode: 0o700 })
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready', result: { schemaVersion: 1, provenance: 'fixture', siteId, scope: request.scope, attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'fixture-studio', localUrl: 'http://localhost:9999', themeSlug: 'fixture', themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [] } })
  const config: DemoPluginsConfig = { sitesRoot, stateRoot, plugins: [] }
  for (const slug of ['advanced-custom-fields-pro', 'polylang', 'wordpress-seo'] as const) {
    const bytes = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from(`synthetic zip ${slug}`)])
    const archivePath = path.join(archivesRoot, `${slug}.zip`)
    await writeFile(archivePath, bytes, { mode: 0o600 })
    config.plugins.push({ slug, version: '1.0.0', sha256: createHash('sha256').update(bytes).digest('hex'), archivePath })
  }
  const installed = new Map<string, { name: string; version: string; status: string }>()
  const calls: string[][] = []
  let noindex = '1'
  let wrongRegistration = false
  let failInstall = false
  const runner: CommandRunner = async (executable, args) => {
    assert.equal(executable, 'studio')
    calls.push([...args])
    const result = (stdout: string) => ({ stdout, exitCode: 0 as const })
    if (args[0] === 'site') return result(JSON.stringify([{ id: wrongRegistration ? 'foreign-studio' : 'fixture-studio', path: sitePath, running: true }]))
    assert.equal(args[args.indexOf('--path') + 1], sitePath)
    if (args[1] === 'plugin' && args[2] === 'list') return result(JSON.stringify([...installed.values()]))
    if (args[1] === 'plugin' && args[2] === 'install') {
      if (failInstall) throw Object.assign(new Error('PRIVATE_RUNNER_FAILURE'), { code: 'COMMAND_FAILED' })
      const url = new URL(args[3]!)
      assert.equal(url.hostname, '127.0.0.1')
      assert.equal(args.find((argument) => argument.startsWith('--exec=')), `--exec=${archiveHttpPolicyPhp(url.href)}`)
      assert.ok(!args.includes('--insecure'))
      assert.match(url.pathname, /^\/[a-f0-9]{64}\/[a-z-]+\.zip$/)
      const plugin = config.plugins.find((entry) => url.pathname.endsWith(`/${entry.slug}.zip`))!
      assert.equal((await fetch(new URL('/wrong-path', url))).status, 404)
      assert.equal((await fetch(url, { method: 'POST' })).status, 404)
      const response = await fetch(url)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), plugin.sha256)
      for (let retry = 0; retry < 2; retry += 1) { const allowed = await fetch(url); assert.equal(allowed.status, 200); await allowed.arrayBuffer() }
      assert.equal((await fetch(url)).status, 429)
      installed.set(plugin.slug, { name: plugin.slug, status: 'inactive', version: plugin.version })
      return result('PRIVATE_INSTALL_OUTPUT')
    }
    if (args[1] === 'plugin' && args[2] === 'activate') { installed.get(args[3]!)!.status = 'active'; return result('PRIVATE_ACTIVATION_OUTPUT') }
    if (args[1] === 'option' && args[2] === 'get') return result(noindex)
    if (args[1] === 'option' && args[2] === 'update') { noindex = args[4]!; return result('updated') }
    throw new Error('Unexpected fixture command')
  }
  const run = () => provisionDemoPlugins(request.scope, { siteId }, config, { runner })
  const mutations = () => calls.filter((args) => ['install', 'activate', 'update'].includes(args[2] ?? ''))
  return { directory, sitePath, statePath, config, request, siteId, calls, installed, runner, run, mutations,
    wrongRegistration: () => { wrongRegistration = true }, failInstall: () => { failInstall = true }, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

test('installs once and replays without resets or secret output', async () => {
  const context = await fixture()
  try {
    const first = await context.run()
    assert.deepEqual(first.plugins.map((plugin) => plugin.action), ['installed', 'installed', 'installed'])
    assert.equal(first.noindexChanged, true)
    assert.equal(context.mutations().length, 7)
    const second = await context.run()
    assert.deepEqual(second.plugins.map((plugin) => plugin.action), ['unchanged', 'unchanged', 'unchanged'])
    assert.equal(second.noindexChanged, false)
    assert.equal(context.mutations().length, 7)
    assert.equal(second.provenance, 'fixture')
    for (const args of context.calls.filter((call) => call[2] === 'install')) await assert.rejects(fetch(args[3]!))
    assert.ok(!JSON.stringify(first).includes(context.directory))
    assert.ok(!JSON.stringify(first).includes('PRIVATE_'))
  } finally { await context.cleanup() }
})

test('activates matching inactive plugins without reinstalling', async () => {
  const context = await fixture()
  try {
    for (const plugin of context.config.plugins) context.installed.set(plugin.slug, { name: plugin.slug, version: plugin.version, status: 'inactive' })
    const result = await context.run()
    assert.ok(result.plugins.every((plugin) => plugin.action === 'activated'))
    assert.equal(context.calls.filter((args) => args[2] === 'install').length, 0)
  } finally { await context.cleanup() }
})

for (const failure of ['foreign-scope', 'wrong-registration', 'last-archive-hash', 'version-mismatch', 'symlink', 'served-archive', 'public-archive', 'archive-size'] as const) {
  test(`preflight ${failure} prevents all mutations`, async () => {
    const context = await fixture()
    try {
      if (failure === 'wrong-registration') context.wrongRegistration()
      if (failure === 'last-archive-hash') await writeFile(context.config.plugins[2]!.archivePath, 'tampered final archive')
      if (failure === 'version-mismatch') context.installed.set('wordpress-seo', { name: 'wordpress-seo', version: '2.0.0', status: 'active' })
      if (failure === 'symlink') { const filename = context.config.plugins[0]!.archivePath; await symlink(filename, `${filename}.link`); context.config.plugins[0]!.archivePath = `${filename}.link` }
      if (failure === 'served-archive') { const filename = path.join(context.sitePath, 'paid.zip'); await writeFile(filename, 'PKxx', { mode: 0o600 }); context.config.plugins[0]!.archivePath = filename }
      if (failure === 'public-archive') { const filename = path.join(context.directory, 'public.zip'); await writeFile(filename, 'PKxx', { mode: 0o644 }); context.config.plugins[0]!.archivePath = filename }
      if (failure === 'archive-size') await writeFile(context.config.plugins[0]!.archivePath, '')
      const scope = failure === 'foreign-scope' ? { ...context.request.scope, tenantId: randomUUID() } : context.request.scope
      await assert.rejects(provisionDemoPlugins(scope, { siteId: context.siteId }, context.config, { runner: context.runner }))
      assert.equal(context.mutations().length, 0)
      await assert.rejects(stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
    } finally { await context.cleanup() }
  })
}

test('uncertain mutation retains lock and prevents blind retry', async () => {
  const context = await fixture()
  try {
    context.failInstall()
    await assert.rejects(context.run(), /COMMAND_FAILED/)
    assert.ok((await stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
    const install = context.calls.find((args) => args[2] === 'install')!
    await assert.rejects(fetch(install[3]!))
    const before = context.mutations().length
    await assert.rejects(context.run(), /site_busy_or_reconciliation_required/)
    assert.equal(context.mutations().length, before)
  } finally { await context.cleanup() }
})

test('strict config rejects unknown or repeated plugin identities', () => {
  const plugin = { slug: 'polylang', version: '1.0', sha256: 'a'.repeat(64), archivePath: '/private/plugin.zip' }
  assert.equal(demoPluginsConfigSchema.safeParse({ sitesRoot: '/sites', stateRoot: '/state', plugins: [plugin, plugin, plugin] }).success, false)
  assert.equal(demoPluginsConfigSchema.safeParse({ sitesRoot: '/sites', stateRoot: '/state', plugins: [{ ...plugin, slug: 'untrusted-plugin' }, plugin, plugin] }).success, false)
})

test('rechecks Studio registration under lock before provisioning', async () => {
  const context = await fixture()
  try {
    let inventories = 0
    const runner: CommandRunner = async (executable, args, options) => {
      if (args[0] === 'site' && ++inventories === 2) context.wrongRegistration()
      return context.runner(executable, args, options)
    }
    await assert.rejects(provisionDemoPlugins(context.request.scope, { siteId: context.siteId }, context.config, { runner }), /site_registration_mismatch/)
    assert.equal(context.mutations().length, 0)
  } finally { await context.cleanup() }
})

test('installs frozen verified archive bytes even if originals change after preflight', async () => {
  const context = await fixture()
  try {
    let inventories = 0
    const runner: CommandRunner = async (executable, args, options) => {
      if (args[0] === 'site' && ++inventories === 2) await writeFile(context.config.plugins[0]!.archivePath, 'changed after verification')
      return context.runner(executable, args, options)
    }
    const report = await provisionDemoPlugins(context.request.scope, { siteId: context.siteId }, context.config, { runner })
    assert.equal(report.plugins.length, 3)
    assert.ok(report.plugins.every((entry) => entry.status === 'active'))
  } finally { await context.cleanup() }
})


test('transport lifetime closes the listener and fails closed for an overdue install', async () => {
  const context = await fixture()
  try {
    context.config.timeoutMs = 25
    const runner: CommandRunner = async (executable, args, options) => {
      if (args[1] === 'plugin' && args[2] === 'install') {
        assert.equal(options?.timeoutMs, 25)
        await new Promise((resolve) => setTimeout(resolve, 60))
        await assert.rejects(fetch(args[3]!))
        return { stdout: '', exitCode: 0 }
      }
      return context.runner(executable, args, options)
    }
    await assert.rejects(provisionDemoPlugins(context.request.scope, { siteId: context.siteId }, context.config, { runner }), /archive_transport_expired/)
    assert.ok((await stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
  } finally { await context.cleanup() }
})


test('HTTP policy scopes hooks to the generated exact URL and preserves other requests', () => {
  const url = `http://127.0.0.1:42319/${'a'.repeat(64)}/polylang.zip`
  const php = archiveHttpPolicyPhp(url)
  assert.ok(php.startsWith("WP_CLI::add_hook('after_wp_load', static function()"))
  assert.ok(php.includes(`$om_archive_url = '${url}'`))
  assert.ok(php.includes("$url === $om_archive_url && $host === '127.0.0.1' ? true : $external"))
  assert.ok(php.includes("if ($url !== $om_archive_url || $host !== '127.0.0.1') return $ports; $ports[] = 42319;"))
  assert.ok(php.includes("if ($url === $om_archive_url) $args['redirection'] = 0; return $args;"))
  assert.ok(!php.includes('__return_true'))
  for (const invalid of [url.replace('127.0.0.1', 'localhost'), url.replace(':42319', ':65536'), `${url}?other=true`, `${url}';evil();`, url.replace('polylang.zip', 'other.zip'), url.replace('http:', 'https:')]) {
    assert.throws(() => archiveHttpPolicyPhp(invalid), /archive_transport_url_invalid/)
  }
})
