import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { mock } from 'node:test'
import { applyOwnedThemeDesign } from '../theme-design-apply.ts'
import { updateOwnedTheme } from '../theme-update.ts'
import { requestHashFor, siteIdFor, writeRecord } from '../ownership.ts'
import { createWordPressStudioTools } from '../tools.ts'
import type { CommandRunner } from '../runner.ts'

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const toolchainRoot = process.env.WP_TAILWIND_TOOLCHAIN_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-theme-update-'))
  const config = { sitesRoot: path.join(directory, 'sites'), stateRoot: path.join(directory, 'state'), toolchainRoot }
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  for (const folder of [config.sitesRoot, config.stateRoot, sitePath, statePath]) await fs.mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'update', name: 'Update fixture', themeSlug: 'update-fixture' }
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready', result: {
    schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'owned-studio', localUrl: 'http://localhost:12345', themeSlug: request.themeSlug, themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [],
  } })
  const themePath = path.join(sitePath, 'wp-content/themes', request.themeSlug)
  for (const folder of ['templates', 'parts', 'assets/css', 'assets/js']) await fs.mkdir(path.join(themePath, folder), { recursive: true, mode: 0o700 })
  const template = '<main class="flex">Before</main>'
  await fs.writeFile(path.join(themePath, 'templates/front-page.html'), template)
  await fs.writeFile(path.join(themePath, 'functions.php'), '<?php\n')
  await fs.writeFile(path.join(themePath, 'theme.json'), '{"version":3,"styles":{"color":{"text":"purple"}}}')
  await fs.writeFile(path.join(sitePath, 'database-surrogate'), 'native post content ACF SEO and Global Styles unchanged')
  const runner: CommandRunner = async (executable, args) => {
    assert.equal(executable, 'studio'); assert.deepEqual(args, ['site', 'list', '--format', 'json'])
    return { stdout: JSON.stringify([{ id: 'owned-studio', path: sitePath, running: false }]), exitCode: 0 }
  }
  const input = { scope, handle, config, updateId: randomUUID(), changes: [{ path: 'templates/front-page.html', expectedHash: digest(template), content: '<main class="grid p-8">After</main>' }] }
  return { directory, themePath, sitePath, statePath, input, runner, template, dispose: () => fs.rm(directory, { recursive: true, force: true }) }
}

test('updates actual theme bytes and compiles locally without altering DB styles or functions; exact replay is idempotent', async () => {
  const context = await fixture()
  try {
    const first = await updateOwnedTheme(context.input, { runner: context.runner })
    assert.equal(first.action, 'updated')
    assert.equal(first.retention, 'not_verified')
    assert.equal(await fs.readFile(path.join(context.themePath, 'templates/front-page.html'), 'utf8'), context.input.changes[0]!.content)
    assert.ok((await fs.readFile(path.join(context.themePath, 'assets/dist/tailwind.css'), 'utf8')).includes('.p-8'))
    const replay = await updateOwnedTheme(context.input, { runner: context.runner })
    assert.equal(replay.action, 'unchanged')
    assert.equal(replay.cssHash, first.cssHash)
    assert.equal(await fs.readFile(path.join(context.sitePath, 'database-surrogate'), 'utf8'), 'native post content ACF SEO and Global Styles unchanged')
    assert.equal(await fs.readFile(path.join(context.themePath, 'theme.json'), 'utf8'), '{"version":3,"styles":{"color":{"text":"purple"}}}')
    assert.equal(await fs.readFile(path.join(context.themePath, 'functions.php'), 'utf8'), '<?php\n')
  } finally { await context.dispose() }
})

for (const forbidden of ['../outside.html', 'functions.php', 'theme.json', 'inc/setup.php', 'assets/dist/tailwind.css', 'templates/payload.php', 'templates/page.html\n', 'wp-content/database/.ht.sqlite']) {
  test(`rejects unowned write ${forbidden}`, async () => {
    const context = await fixture()
    try {
      await assert.rejects(updateOwnedTheme({ ...context.input, changes: [{ ...context.input.changes[0], path: forbidden }] }, { runner: context.runner }), /invalid_input/)
      assert.equal(await fs.readFile(path.join(context.themePath, 'templates/front-page.html'), 'utf8'), context.template)
      await assert.rejects(fs.stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
    } finally { await context.dispose() }
  })
}

test('stale preconditions and symlinks fail before any source replacement', async () => {
  for (const symlink of [false, true]) {
    const context = await fixture()
    try {
      if (symlink) { await fs.rename(path.join(context.themePath, 'templates/front-page.html'), path.join(context.directory, 'outside.html')); await fs.symlink(path.join(context.directory, 'outside.html'), path.join(context.themePath, 'templates/front-page.html')) }
      const input = { ...context.input, changes: [{ ...context.input.changes[0]!, expectedHash: symlink ? context.input.changes[0]!.expectedHash : '0'.repeat(64) }] }
      await assert.rejects(updateOwnedTheme(input, { runner: context.runner }))
      assert.equal(await fs.readFile(path.join(context.themePath, 'templates/front-page.html'), 'utf8'), context.template)
    } finally { await context.dispose() }
  }
})

test('same update ID with different payload and changed managed result refuse replay', async () => {
  for (const changedFile of [false, true]) {
    const context = await fixture()
    try {
      await updateOwnedTheme(context.input, { runner: context.runner })
      if (changedFile) await fs.writeFile(path.join(context.themePath, 'templates/front-page.html'), 'User revision')
      const input = changedFile ? context.input : { ...context.input, changes: [{ ...context.input.changes[0]!, content: 'Different request' }] }
      await assert.rejects(updateOwnedTheme(input, { runner: context.runner }), changedFile ? /theme_update_conflict/ : /theme_update_idempotency_conflict/)
    } finally { await context.dispose() }
  }
})

test('compile failure retains before-image and lock, refuses snapshot and blind restart', async () => {
  const context = await fixture()
  try {
    const input = { ...context.input, config: { ...context.input.config, timeoutMs: 1 } }
    await assert.rejects(updateOwnedTheme(input, { runner: context.runner }), /theme_compile_failed/)
    const journal = JSON.parse(await fs.readFile(path.join(context.statePath, `theme-update-${context.input.updateId}.json`), 'utf8')) as { status: string; files: Array<{ before: string }> }
    assert.equal(journal.status, 'prepared')
    assert.equal(Buffer.from(journal.files[0]!.before, 'base64').toString(), context.template)
    await assert.rejects(createWordPressStudioTools(context.input.config, { runner: context.runner }).captureSnapshot(context.input.scope, context.input.handle), /site_busy_or_reconciliation_required/)
    await assert.rejects(updateOwnedTheme(input, { runner: context.runner }), /site_busy_or_reconciliation_required/)
  } finally { await context.dispose() }
})

test('no-op new update does not pretend to perform redeploy and duplicate paths are rejected', async () => {
  const context = await fixture()
  try {
    await assert.rejects(updateOwnedTheme({ ...context.input, changes: [{ ...context.input.changes[0]!, content: context.template }] }, { runner: context.runner }), /theme_update_no_change/)
    await assert.rejects(updateOwnedTheme({ ...context.input, changes: [context.input.changes[0], context.input.changes[0]] }, { runner: context.runner }), /invalid_input/)
  } finally { await context.dispose() }
})


test('managed design requires the exact applied mapping before source writes', async () => {
  const design = JSON.parse(await fs.readFile(new URL('../../../../context/changes/wordpress-design-token-mapping/fixture.json', import.meta.url), 'utf8')) as Record<string, unknown>
  for (const mode of ['missing', 'different', 'matching', 'prepared']) {
    const context = await fixture()
    try {
      const themeJson = await fs.readFile(path.join(context.themePath, 'theme.json'))
      await applyOwnedThemeDesign({ scope: context.input.scope, handle: context.input.handle, config: { sitesRoot: context.input.config.sitesRoot, stateRoot: context.input.config.stateRoot }, designTokens: design, expectedThemeJsonHash: digest(themeJson) }, { runner: context.runner })
      const input = { ...context.input, ...(mode !== 'missing' ? { designTokens: mode === 'different' ? { ...design, source: { ...(design.source as object), revision: 'different' } } : design } : {}) }
      if (mode === 'prepared') {
        const filename = path.join(context.statePath, 'theme-design-journal.json')
        const journal = JSON.parse(await fs.readFile(filename, 'utf8')) as Record<string, unknown>
        await fs.writeFile(filename, JSON.stringify({ ...journal, status: 'prepared' }))
      }
      if (mode === 'matching') assert.equal((await updateOwnedTheme(input, { runner: context.runner })).action, 'updated')
      else {
        await assert.rejects(updateOwnedTheme(input, { runner: context.runner }))
        assert.equal(await fs.readFile(path.join(context.themePath, 'templates/front-page.html'), 'utf8'), context.template)
      }
    } finally { await context.dispose() }
  }
})

test('UTF8 byte limit rejects a character-bounded oversized file before acquiring lock', async () => {
  const context = await fixture()
  try {
    await assert.rejects(updateOwnedTheme({ ...context.input, changes: [{ ...context.input.changes[0], content: 'ą'.repeat(100 * 1024) }] }, { runner: context.runner }), /theme_update_limit/)
    await assert.rejects(fs.stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

test('post-build CSS mutation fails final verification and retains prepared journal', async () => {
  const context = await fixture()
  const rename = fs.rename
  try {
    const intercepted = mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      const result = await rename(from, to)
      if (String(to) === path.join(context.themePath, 'assets/dist/tailwind.css')) await fs.writeFile(to, 'interleaved bytes')
      return result
    })
    await assert.rejects(updateOwnedTheme(context.input, { runner: context.runner }), /theme_update_write_unconfirmed/)
    intercepted.mock.restore()
    const journal = JSON.parse(await fs.readFile(path.join(context.statePath, `theme-update-${context.input.updateId}.json`), 'utf8')) as { status: string }
    assert.equal(journal.status, 'prepared')
    assert.ok((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
  } finally { mock.restoreAll(); await context.dispose() }
})
