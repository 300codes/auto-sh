import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyOwnedThemeDesign, applyThemeDesignWithinLock } from '../theme-design-apply.ts'
import { requestHashFor, siteIdFor, withSiteLock, writeRecord } from '../ownership.ts'
import type { CommandRunner } from '../runner.ts'

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const design = () => ({ schemaVersion: 1, provenance: 'fixture', source: { designRef: 'fixture:w2', revision: 'v1' }, tokens: {
  colors: [{ id: 'brand', name: 'Brand', value: '#123456' }],
  fonts: [{ id: 'body', name: 'Body', families: ['system-ui'] }],
  fontSizes: [{ id: 'reading', name: 'Reading', value: '1rem' }],
  spacing: [{ id: 'section', name: 'Section', value: '2rem' }],
} })

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-design-apply-'))
  const config = { sitesRoot: path.join(directory, 'sites'), stateRoot: path.join(directory, 'state') }
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  for (const folder of [config.sitesRoot, config.stateRoot, sitePath, statePath]) await fs.mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'design-apply', name: 'Fixture', themeSlug: 'fixture' }
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready', result: {
    schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId, toolExecutionId: randomUUID(),
    studioSiteId: 'fixture-studio', localUrl: 'http://localhost:9999', themeSlug: 'fixture', themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [],
  } })
  const themePath = path.join(sitePath, 'wp-content/themes/fixture')
  await fs.mkdir(themePath, { recursive: true, mode: 0o700 })
  const filename = path.join(themePath, 'theme.json')
  const original = { version: 3, customRoot: { retained: true }, settings: {
    layout: { contentSize: '740px' }, color: { custom: false, palette: [{ slug: 'client', name: 'Client', color: '#abcdef', customField: 'preserve' }] },
    typography: { fluid: true }, spacing: { units: ['px', 'rem'] },
  }, styles: { color: { text: 'var:preset|color|client' }, blocks: { 'core/button': { border: { radius: '8px' } } } }, templateParts: [{ name: 'header', area: 'header' }] }
  await fs.writeFile(filename, JSON.stringify(original) + '\n')
  const database = path.join(sitePath, 'content-and-global-styles.sqlite-surrogate')
  await fs.writeFile(database, 'private native content, ACF, global styles: unchanged')
  let registrations = 0
  let rejectUnderLock = false
  const runner: CommandRunner = async (executable, args) => {
    assert.equal(executable, 'studio')
    assert.deepEqual(args, ['site', 'list', '--format', 'json'])
    registrations += 1
    return { stdout: JSON.stringify([{ id: rejectUnderLock && registrations > 1 ? 'other-studio' : 'fixture-studio', path: sitePath, running: false }]), exitCode: 0 }
  }
  const currentHash = async () => hash(await fs.readFile(filename))
  const input = async () => ({ scope, handle, config, expectedThemeJsonHash: await currentHash(), designTokens: design() })
  return { directory, filename, themePath, sitePath, statePath, scope, handle, config, original, database, runner, currentHash, input,
    journalPath: path.join(statePath, 'theme-design-journal.json'),
    rejectRegistration: () => { rejectUnderLock = true },
    dispose: () => fs.rm(directory, { recursive: true, force: true }),
  }
}

test('applies managed presets preserving client settings/styles/content and replays without byte changes', async () => {
  const context = await fixture()
  try {
    const before = await fs.readFile(context.filename, 'utf8')
    const first = await applyOwnedThemeDesign(await context.input(), { runner: context.runner })
    const after = await fs.readFile(context.filename, 'utf8')
    const document = JSON.parse(after)
    assert.equal(first.action, 'applied')
    assert.equal(first.provenance, 'fixture')
    assert.equal(first.approvalVerification, 'not_evaluated')
    assert.equal(first.beforeHash, hash(before))
    assert.equal(first.afterHash, hash(after))
    assert.equal(first.managedPresetCount, 4)
    assert.deepEqual(document.styles, context.original.styles)
    assert.deepEqual(document.templateParts, context.original.templateParts)
    assert.deepEqual(document.customRoot, context.original.customRoot)
    assert.deepEqual(document.settings.layout, context.original.settings.layout)
    assert.deepEqual(document.settings.color.palette[0], context.original.settings.color.palette[0])
    assert.equal(document.settings.color.custom, false)
    assert.equal(document.settings.typography.fluid, true)
    assert.deepEqual(document.settings.spacing.units, ['px', 'rem'])
    assert.equal(document.settings.color.palette[1].slug, 'design-brand')
    assert.equal(await fs.readFile(context.database, 'utf8'), 'private native content, ACF, global styles: unchanged')
    const journalBytes = await fs.readFile(context.journalPath, 'utf8')
    const journal = JSON.parse(journalBytes)
    assert.equal(journal.status, 'applied')
    assert.equal(journal.beforeThemeJson, before)
    assert.equal((await fs.stat(context.journalPath)).mode & 0o077, 0)
    const second = await applyOwnedThemeDesign(await context.input(), { runner: context.runner })
    assert.equal(second.action, 'unchanged')
    assert.equal(second.journalRevisionHash, first.journalRevisionHash)
    assert.equal(await fs.readFile(context.filename, 'utf8'), after)
    assert.equal(await fs.readFile(context.journalPath, 'utf8'), journalBytes)
    assert.ok(!JSON.stringify(second).includes(context.directory))
    assert.ok(!JSON.stringify(second).includes('private native'))
    await assert.rejects(fs.stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

test('updates and removes only previously owned unchanged presets while keeping later client additions', async () => {
  const context = await fixture()
  try {
    await applyOwnedThemeDesign(await context.input(), { runner: context.runner })
    const document = JSON.parse(await fs.readFile(context.filename, 'utf8'))
    document.settings.color.palette.push({ slug: 'client-new', name: 'New', color: '#ffffff' })
    document.styles.spacing = { blockGap: '3rem' }
    await fs.writeFile(context.filename, JSON.stringify(document))
    const input = await context.input()
    input.designTokens.source.revision = 'v2'
    input.designTokens.tokens.colors = [{ id: 'new-brand', name: 'New brand', value: '#654321' }]
    await applyOwnedThemeDesign(input, { runner: context.runner })
    const updated = JSON.parse(await fs.readFile(context.filename, 'utf8'))
    assert.deepEqual(updated.settings.color.palette.map((entry: { slug: string }) => entry.slug), ['client', 'client-new', 'design-new-brand'])
    assert.deepEqual(updated.styles, document.styles)
  } finally { await context.dispose() }
})

test('replay preserves interleaved palette ordering and detects concurrent file changes before reporting success', async (contextTest) => {
  const context = await fixture()
  try {
    await applyOwnedThemeDesign(await context.input(), { runner: context.runner })
    const document = JSON.parse(await fs.readFile(context.filename, 'utf8'))
    document.settings.color.palette.push({ slug: 'client-last', name: 'Last', color: '#ffffff' })
    await fs.writeFile(context.filename, JSON.stringify(document))
    const before = await fs.readFile(context.filename, 'utf8')
    const report = await applyOwnedThemeDesign(await context.input(), { runner: context.runner })
    assert.equal(report.action, 'unchanged')
    assert.equal(await fs.readFile(context.filename, 'utf8'), before)
    assert.equal(JSON.parse(await fs.readFile(context.journalPath, 'utf8')).afterHash, hash(before))
    const input = await context.input()
    const open = fs.open.bind(fs)
    let themeReads = 0
    const fault = contextTest.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === context.filename && ++themeReads === 2) await fs.writeFile(context.filename, before + ' ')
      return open(...args)
    })
    await assert.rejects(applyOwnedThemeDesign(input, { runner: context.runner }), /theme_design_write_unconfirmed/)
    fault.mock.restore()
  } finally { await context.dispose() }
})

for (const variant of ['changed', 'deleted', 'extra-field'] as const) {
  test(`refuses ${variant} user edits to previously owned presets`, async () => {
    const context = await fixture()
    try {
      await applyOwnedThemeDesign(await context.input(), { runner: context.runner })
      const document = JSON.parse(await fs.readFile(context.filename, 'utf8'))
      if (variant === 'changed') document.settings.color.palette[1].color = '#ffffff'
      if (variant === 'deleted') document.settings.color.palette.pop()
      if (variant === 'extra-field') document.settings.color.palette[1].custom = true
      await fs.writeFile(context.filename, JSON.stringify(document))
      const before = await fs.readFile(context.filename)
      await assert.rejects(applyOwnedThemeDesign(await context.input(), { runner: context.runner }), /theme_design_managed_conflict/)
      assert.deepEqual(await fs.readFile(context.filename), before)
      assert.ok((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
    } finally { await context.dispose() }
  })
}

test('does not adopt pre-existing same-valued preset without journal ownership', async () => {
  const context = await fixture()
  try {
    const document = structuredClone(context.original)
    document.settings.color.palette.push({ slug: 'design-brand', name: 'Brand', color: '#123456', customField: 'existing' })
    await fs.writeFile(context.filename, JSON.stringify(document))
    const before = await fs.readFile(context.filename)
    await assert.rejects(applyOwnedThemeDesign(await context.input(), { runner: context.runner }), /theme_design_slug_conflict/)
    assert.deepEqual(await fs.readFile(context.filename), before)
    await assert.rejects(fs.stat(context.journalPath), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

test('expected hash is mandatory on replay and stale input never overwrites changes', async () => {
  const context = await fixture()
  try {
    const input = await context.input()
    await applyOwnedThemeDesign(input, { runner: context.runner })
    const before = await fs.readFile(context.filename)
    await assert.rejects(applyOwnedThemeDesign(input, { runner: context.runner }), /theme_design_hash_conflict/)
    assert.deepEqual(await fs.readFile(context.filename), before)
  } finally { await context.dispose() }
})

for (const variant of ['foreign-scope', 'registration', 'theme-symlink', 'journal-symlink', 'unknown-format', 'duplicate-slug', 'malformed-json', 'oversized', 'invalid-encoding'] as const) {
  test(`fails closed for ${variant}`, async () => {
    const context = await fixture()
    try {
      const input = await context.input()
      if (variant === 'foreign-scope') input.scope = { ...input.scope, tenantId: randomUUID() }
      if (variant === 'registration') context.rejectRegistration()
      if (variant === 'theme-symlink') { await fs.rename(context.filename, context.filename + '.original'); await fs.symlink(context.filename + '.original', context.filename) }
      if (variant === 'journal-symlink') await fs.symlink(context.filename, context.journalPath)
      if (variant === 'unknown-format') await fs.writeFile(context.filename, '{"version":2}')
      if (variant === 'duplicate-slug') await fs.writeFile(context.filename, JSON.stringify({ version: 3, settings: { color: { palette: [{ slug: 'same' }, { slug: 'same' }] } } }))
      if (variant === 'malformed-json') await fs.writeFile(context.filename, '{')
      if (variant === 'oversized') await fs.writeFile(context.filename, ' '.repeat(256 * 1024 + 1))
      if (variant === 'invalid-encoding') await fs.writeFile(context.filename, Buffer.from([0xff, 0xfe]))
      input.expectedThemeJsonHash = await context.currentHash()
      const before = await fs.readFile(context.filename)
      await assert.rejects(applyOwnedThemeDesign(input, { runner: context.runner }))
      assert.deepEqual(await fs.readFile(context.filename), before)
    } finally { await context.dispose() }
  })
}

test('lock-held primitive rejects unlocked use and composes without reentrant acquisition', async () => {
  const context = await fixture()
  try {
    await assert.rejects(applyThemeDesignWithinLock(await context.input(), { runner: context.runner }), /UNSAFE_PATH/)
    await withSiteLock(context.statePath, async () => {
      const report = await applyThemeDesignWithinLock(await context.input(), { runner: context.runner })
      assert.equal(report.action, 'applied')
      await assert.rejects(applyOwnedThemeDesign(await context.input(), { runner: context.runner }), /site_busy_or_reconciliation_required/)
    })
  } finally { await context.dispose() }
})

test('partial apply retains private before-image and prepared journal; retry requires reconciliation', async (contextTest) => {
  const context = await fixture()
  try {
    const before = await fs.readFile(context.filename, 'utf8')
    const rename = fs.rename.bind(fs)
    let journalWrites = 0
    const fault = contextTest.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      if (to === context.journalPath && ++journalWrites === 2) throw new Error('PRIVATE_UNSANITIZED_WRITE_FAILURE')
      return rename(from, to)
    })
    await assert.rejects(applyOwnedThemeDesign(await context.input(), { runner: context.runner }), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, '[internal] theme_design_apply_failed')
      return true
    })
    fault.mock.restore()
    const journal = JSON.parse(await fs.readFile(context.journalPath, 'utf8'))
    assert.equal(journal.status, 'prepared')
    assert.equal(journal.beforeThemeJson, before)
    assert.equal(journal.beforeHash, hash(before))
    assert.equal(journal.afterHash, await context.currentHash())
    await assert.rejects(applyOwnedThemeDesign(await context.input(), { runner: context.runner }), /site_busy_or_reconciliation_required/)
    await assert.rejects(applyThemeDesignWithinLock(await context.input(), { runner: context.runner }), /theme_design_reconciliation_required/)
    assert.ok(!(await fs.readdir(context.themePath)).some((name) => name.startsWith('.theme-design-')))
    assert.equal(await fs.readFile(context.database, 'utf8'), 'private native content, ACF, global styles: unchanged')
  } finally { await context.dispose() }
})
