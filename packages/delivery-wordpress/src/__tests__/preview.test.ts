import assert from 'node:assert/strict'
import test from 'node:test'
import { transitionPreviewPublication } from '../preview.ts'

const initial = { schemaVersion: 1, siteId: 'a'.repeat(64), packageHash: 'b'.repeat(64), state: 'prepared', host: null }
const begin = { type: 'begin', approvedPackageHash: initial.packageHash, approvedHost: null }

test('publication timeout cannot trigger a second create; observed host still needs exact revision verification', () => {
  const uploading = transitionPreviewPublication(initial, begin)
  const uncertain = transitionPreviewPublication(uploading, { type: 'interrupted' })
  assert.throws(() => transitionPreviewPublication(uncertain, begin), /reconciliation_required/)
  const observed = transitionPreviewPublication(uncertain, { type: 'observed', host: 'owned-studio.wp.build' })
  assert.equal(observed.state, 'uploaded_unverified')
  assert.throws(() => transitionPreviewPublication(observed, { type: 'verified', host: 'owned-studio.wp.build', observedPackageHash: 'c'.repeat(64) }), /revision_mismatch/)
  assert.equal(transitionPreviewPublication(observed, { type: 'verified', host: 'owned-studio.wp.build', observedPackageHash: initial.packageHash }).state, 'verified')
})

test('revision and target approval must match, cross-site adoption and unsafe hosts fail', () => {
  assert.throws(() => transitionPreviewPublication(initial, { ...begin, approvedPackageHash: 'c'.repeat(64) }))
  assert.throws(() => transitionPreviewPublication(initial, { ...begin, approvedHost: 'different.wp.build' }))
  const uploading = transitionPreviewPublication({ ...initial, host: 'original.wp.build' }, { ...begin, approvedHost: 'original.wp.build' })
  assert.throws(() => transitionPreviewPublication(uploading, { type: 'observed', host: 'foreign.wp.build' }))
  for (const host of ['localhost', '127.0.0.1', 'x.wp.build.evil.test', 'x.wp.build/path', 'https://x.wp.build', 'x.wp.build\n', 'x'.repeat(64) + '.wp.build']) {
    assert.throws(() => transitionPreviewPublication(uploading, { type: 'observed', host }))
  }
})

test('remote observation cannot verify an unstarted local candidate or bypass revision state', () => {
  assert.throws(() => transitionPreviewPublication(initial, { type: 'observed', host: 'owned.wp.build' }))
  assert.throws(() => transitionPreviewPublication(initial, { type: 'verified', host: 'owned.wp.build', observedPackageHash: initial.packageHash }))
})

import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestHashFor, siteIdFor, writeRecord } from '../ownership.ts'
import type { CommandRunner } from '../runner.ts'
import { inspectOwnedPreview } from '../preview.ts'

const toolchainRoot = process.env.WP_TAILWIND_TOOLCHAIN_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wp-theme-build-'))
  const config = { sitesRoot: path.join(directory, 'sites'), stateRoot: path.join(directory, 'state'), toolchainRoot }
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  for (const folder of [config.sitesRoot, config.stateRoot, sitePath, statePath]) await mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'theme-build', name: 'Theme fixture', themeSlug: 'theme-fixture' }
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready',
    result: { schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'owned-studio', localUrl: 'http://localhost:12345', themeSlug: request.themeSlug, themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [] } })
  const themePath = path.join(sitePath, 'wp-content/themes', request.themeSlug)
  await mkdir(path.join(themePath, 'assets/css'), { recursive: true, mode: 0o700 })
  await writeFile(path.join(themePath, 'index.php'), '\uFEFF<?php /* Never execute theme PHP */ ?><div class="flex p-4"></div>')
  await writeFile(path.join(themePath, 'page.html'), '<main class="grid gap-6 bg-design-brand"></main>')
  await writeFile(path.join(themePath, 'theme.js'), 'throw new Error("DO_NOT_EXECUTE"); const classes = "text-xl font-bold"')
  await writeFile(path.join(themePath, 'assets/css/custom.css'), 'body { color: purple; }')
  await writeFile(path.join(themePath, 'theme.json'), '{"version":3,"styles":{"color":{"text":"purple"}}}')
  await writeFile(path.join(sitePath, 'database-surrogate'), 'preserved native content')
  let inventory = 0
  let foreignRegistration = false
  const runner: CommandRunner = async (executable, args) => {
    assert.equal(executable, 'studio')
    assert.deepEqual(args, ['site', 'list', '--format', 'json'])
    inventory += 1
    return { stdout: JSON.stringify([{ id: foreignRegistration && inventory > 1 ? 'foreign-studio' : 'owned-studio', path: sitePath, running: false }]), exitCode: 0 }
  }
  return { directory, config, scope, handle, themePath, sitePath, statePath, runner,
    input: { scope, handle, config }, foreignRegistration: () => { foreignRegistration = true },
    output: path.join(themePath, 'assets/dist/tailwind.css'),
    dispose: () => rm(directory, { recursive: true, force: true }) }
}



test('readiness scopes account-wide listing to exact Studio site and never publishes', async () => {
  const context = await fixture()
  try {
    let cliVersion = '1.19.0'
    let rawListing: string | undefined
    let entries: unknown[] = [{ localSiteId: 'unrelated', url: 'https://foreign.wp.build', date: Date.now() }]
    const commands: string[][] = []
    const runner: CommandRunner = async (executable, args, options) => {
      commands.push([...args])
      if (args[0] === '--version') return { stdout: cliVersion, exitCode: 0 }
      if (args[0] === 'auth') return { stdout: 'private account data never reported', exitCode: 0 }
      if (args[0] === 'preview') return { stdout: rawListing ?? JSON.stringify(entries), exitCode: 0 }
      return context.runner(executable, args, options)
    }
    const input = { scope: context.scope, handle: context.handle, config: { sitesRoot: context.config.sitesRoot, stateRoot: context.config.stateRoot } }
    const absent = await inspectOwnedPreview(input, { runner })
    assert.equal(absent.host, null)
    assert.equal(absent.provenance, 'fixture')
    entries.push({ localSiteId: 'owned-studio', url: 'https://owned.wp.build', date: Date.now() })
    assert.equal((await inspectOwnedPreview(input, { runner })).host, 'owned.wp.build')
    await assert.rejects(inspectOwnedPreview({ ...input, savedHost: 'different.wp.build' }, { runner }), /binding_mismatch/)
    entries.push({ localSiteId: 'owned-studio', url: 'https://another.wp.build', date: Date.now() })
    await assert.rejects(inspectOwnedPreview(input, { runner }), /ambiguous/)
    entries = [{ localSiteId: 'owned-studio', url: 'https://owned.wp.build', date: Date.now() - 8 * 24 * 60 * 60 * 1000 }]
    assert.equal((await inspectOwnedPreview(input, { runner })).expired, true)
    entries = [{ localSiteId: 'owned-studio', url: 'https://owned.wp.build\n', date: Date.now() }]
    await assert.rejects(inspectOwnedPreview(input, { runner }), /host_invalid/)
    rawListing = '  '
    await assert.rejects(inspectOwnedPreview(input, { runner }), /listing_invalid/)
    rawListing = 'Update available: 1.19.0 → 1.21.0\nNo preview sites found.'
    assert.equal((await inspectOwnedPreview(input, { runner })).host, null)
    cliVersion = 'Previously 1.19.0\n1.21.0'
    await assert.rejects(inspectOwnedPreview(input, { runner }), /version_unverified/)
    assert.ok(commands.every((args) => !args.includes('create') && !args.includes('update')))
    assert.ok(!JSON.stringify(absent).includes('private account data'))
  } finally { await context.dispose() }
})
