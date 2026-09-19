import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { prepareOwnedTheme } from '../prepare-theme.ts'
import { createWordPressStudioTools } from '../tools.ts'
import { requestHashFor, siteIdFor, writeRecord } from '../ownership.ts'
import type { CommandRunner } from '../runner.ts'

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
  await writeFile(path.join(themePath, 'functions.php'), "<?php\ndefined('ABSPATH') || exit;\n")
  await mkdir(path.join(themePath, 'inc'))
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


const designTokens = { schemaVersion: 1, provenance: 'fixture', source: { designRef: 'test', revision: 'v1' }, tokens: {
  colors: [{ id: 'brand', name: 'Brand', value: '#123456' }], fonts: [{ id: 'body', name: 'Body', families: ['system-ui'] }],
  fontSizes: [{ id: 'reading', name: 'Reading', value: '1rem' }], spacing: [{ id: 'section', name: 'Section', value: '2rem' }],
} }
async function inputFor(context: Awaited<ReturnType<typeof fixture>>) {
  const digest = async (filename: string) => createHash('sha256').update(await readFile(path.join(context.themePath, filename))).digest('hex')
  let expectedAssetsHash: string | null = null
  try { expectedAssetsHash = await digest('inc/assets.php') } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  return { ...context.input, designTokens, expectedThemeJsonHash: await digest('theme.json'), expectedFunctionsHash: await digest('functions.php'), expectedAssetsHash }
}

test('coordinator applies design, enqueue and real build under one lock; replay preserves content', async () => {
  const context = await fixture()
  try {
    const first = await prepareOwnedTheme(await inputFor(context), { runner: context.runner })
    const second = await prepareOwnedTheme(await inputFor(context), { runner: context.runner })
    assert.equal(first.build.output.sha256, second.build.output.sha256)
    assert.ok((await readFile(context.output, 'utf8')).includes('.bg-design-brand'))
    assert.equal(JSON.parse(await readFile(path.join(context.themePath, 'theme.json'), 'utf8')).styles.color.text, 'purple')
    assert.equal(await readFile(path.join(context.sitePath, 'database-surrogate'), 'utf8'), 'preserved native content')
    assert.equal(first.browserEditor, 'not_run')
    await assert.rejects(stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

test('failure after apply retains reconciliation lock and denies real snapshot entrypoint', async () => {
  const context = await fixture()
  try {
    const input = await inputFor(context)
    await assert.rejects(prepareOwnedTheme({ ...input, config: { ...input.config, timeoutMs: 1 } }, { runner: context.runner }), /theme_prepare_reconciliation_required/)
    assert.ok((await readFile(path.join(context.themePath, 'functions.php'), 'utf8')).includes('inc/assets.php'))
    const tools = createWordPressStudioTools({ sitesRoot: context.config.sitesRoot, stateRoot: context.config.stateRoot }, { runner: context.runner })
    await assert.rejects(tools.captureSnapshot(context.scope, context.handle), /site_busy_or_reconciliation_required/)
    await assert.rejects(prepareOwnedTheme(await inputFor(context), { runner: context.runner }), /site_busy_or_reconciliation_required/)
    assert.equal(await readFile(path.join(context.sitePath, 'database-surrogate'), 'utf8'), 'preserved native content')
  } finally { await context.dispose() }
})

test('stale precondition fails before any theme mutation', async () => {
  const context = await fixture()
  try {
    const input = await inputFor(context)
    await assert.rejects(prepareOwnedTheme({ ...input, expectedFunctionsHash: '0'.repeat(64) }, { runner: context.runner }), /theme_prepare_reconciliation_required/)
    assert.equal(await readFile(path.join(context.themePath, 'functions.php'), 'utf8'), "<?php\ndefined('ABSPATH') || exit;\n")
    assert.equal(JSON.parse(await readFile(path.join(context.themePath, 'theme.json'), 'utf8')).settings, undefined)
  } finally { await context.dispose() }
})
