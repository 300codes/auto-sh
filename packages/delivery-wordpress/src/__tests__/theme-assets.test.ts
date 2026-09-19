import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test, { mock } from 'node:test'
import { installOwnedThemeAssets, installThemeAssetsWithinLock } from '../theme-assets.ts'
import { requestHashFor, siteIdFor, withSiteLock, writeRecord } from '../ownership.ts'
import { createWordPressStudioTools } from '../tools.ts'
import type { CommandRunner } from '../runner.ts'

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-theme-assets-'))
  const config = { sitesRoot: path.join(directory, 'sites'), stateRoot: path.join(directory, 'state') }
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  for (const folder of [config.sitesRoot, config.stateRoot, sitePath, statePath]) await fs.mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'assets', name: 'Assets fixture', themeSlug: 'assets-fixture' }
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready',
    result: { schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'owned-studio', localUrl: 'http://localhost:12345', themeSlug: request.themeSlug, themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [] } })
  const themePath = path.join(sitePath, 'wp-content/themes', request.themeSlug)
  await fs.mkdir(path.join(themePath, 'inc'), { recursive: true, mode: 0o700 })
  const functions = "<?php\n$unrelated = 'preserved';\nrequire_once __DIR__ . '/inc/setup.php';\n"
  const setup = "<?php\n$GLOBALS['setup_preserved'] = true;\n"
  await fs.writeFile(path.join(themePath, 'functions.php'), functions)
  await fs.writeFile(path.join(themePath, 'inc/setup.php'), setup)
  await fs.writeFile(path.join(sitePath, 'database-surrogate'), 'unchanged DB')
  let reads = 0
  let swapRegistration = false
  const runner: CommandRunner = async (executable, args) => {
    assert.equal(executable, 'studio')
    assert.deepEqual(args, ['site', 'list', '--format', 'json'])
    reads += 1
    return { stdout: JSON.stringify([{ id: swapRegistration && reads > 1 ? 'foreign-site' : 'owned-studio', path: sitePath, running: false }]), exitCode: 0 }
  }
  const input = { scope, handle, config, expectedFunctionsHash: digest(functions), expectedAssetsHash: null as string | null }
  return { directory, statePath, sitePath, themePath, functions, setup, runner, input,
    swapRegistration: () => { swapRegistration = true }, dispose: () => fs.rm(directory, { recursive: true, force: true }),
    hashes: async () => ({ expectedFunctionsHash: digest(await fs.readFile(path.join(themePath, 'functions.php'))), expectedAssetsHash: digest(await fs.readFile(path.join(themePath, 'inc/assets.php'))) }),
  }
}

test('installs bounded native enqueue once and preserves functions setup and DB', async () => {
  const context = await fixture()
  try {
    const first = await installOwnedThemeAssets(context.input, { runner: context.runner })
    assert.equal(first.action, 'installed')
    assert.equal(first.provenance, 'fixture')
    assert.equal(first.frontend, 'not_verified')
    assert.equal(first.editorIframe, 'not_verified')
    const functions = await fs.readFile(path.join(context.themePath, 'functions.php'), 'utf8')
    assert.equal(functions.replace("require_once __DIR__ . '/inc/assets.php';\n", ''), context.functions)
    const replay = await installOwnedThemeAssets({ ...context.input, ...await context.hashes() }, { runner: context.runner })
    assert.equal(replay.action, 'unchanged')
    assert.deepEqual(replay.files, first.files)
    assert.equal(await fs.readFile(path.join(context.themePath, 'inc/setup.php'), 'utf8'), context.setup)
    assert.equal(await fs.readFile(path.join(context.sitePath, 'database-surrogate'), 'utf8'), 'unchanged DB')
    await assert.rejects(fs.stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

test('real PHP callback uses shared frontend/editor hook and actual CSS bytes for version', async () => {
  const context = await fixture()
  try {
    await installOwnedThemeAssets(context.input, { runner: context.runner })
    await fs.mkdir(path.join(context.themePath, 'assets/dist'), { recursive: true })
    const css = '.flex { display: flex; }'
    await fs.writeFile(path.join(context.themePath, 'assets/dist/tailwind.css'), css)
    const php = path.join(context.directory, 'check.php')
    await fs.writeFile(php, `<?php
define('ABSPATH', '/fixture/');
$theme = $argv[1]; $hooks = array(); $styles = array();
function add_action($name, $callback, $priority) { global $hooks; $hooks[$name] = $callback; }
function get_theme_file_path($relative) { global $theme; return $theme . '/' . $relative; }
function get_theme_file_uri($relative) { return 'http://fixture.local/theme/' . $relative; }
function wp_enqueue_style($handle, $uri, $deps, $version) { global $styles; $styles[] = array($handle, $uri, $deps, $version); }
require $theme . '/functions.php';
$hooks['enqueue_block_assets']();
file_put_contents($theme . '/assets/dist/tailwind.css', '.grid { display: grid; }');
$hooks['enqueue_block_assets']();
unlink($theme . '/assets/dist/tailwind.css');
$hooks['enqueue_block_assets']();
echo json_encode(array('hooks' => array_keys($hooks), 'styles' => $styles, 'setup' => $GLOBALS['setup_preserved'], 'unrelated' => $unrelated));
`)
    const { stdout } = await promisify(execFile)('php', [php, context.themePath], { timeout: 5000, maxBuffer: 64 * 1024 })
    const result = JSON.parse(stdout) as { hooks: string[]; styles: Array<[string, string, string[], string]>; setup: boolean; unrelated: string }
    assert.deepEqual(result.hooks, ['enqueue_block_assets'])
    assert.equal(result.styles.length, 2)
    assert.equal(result.styles[0]?.[3], digest(css))
    assert.equal(result.styles[1]?.[3], digest('.grid { display: grid; }'))
    assert.equal(result.styles[0]?.[1], 'http://fixture.local/theme/assets/dist/tailwind.css')
    assert.equal(result.setup, true)
    assert.equal(result.unrelated, 'preserved')
  } finally { await context.dispose() }
})

for (const variant of ['foreign-scope', 'stale-functions', 'unknown-assets', 'functions-symlink', 'inc-symlink', 'closing-tag', 'declare', 'namespace', 'invalid-encoding'] as const) {
  test(`${variant} causes no mutation`, async () => {
    const context = await fixture()
    try {
      const input = { ...context.input }
      if (variant === 'foreign-scope') input.scope = { ...input.scope, organizationId: randomUUID() }
      if (variant === 'stale-functions') input.expectedFunctionsHash = 'a'.repeat(64)
      if (variant === 'unknown-assets') { await fs.writeFile(path.join(context.themePath, 'inc/assets.php'), '<?php /* customer asset logic */'); input.expectedAssetsHash = digest(await fs.readFile(path.join(context.themePath, 'inc/assets.php'))) }
      if (variant === 'functions-symlink') { await fs.unlink(path.join(context.themePath, 'functions.php')); await fs.symlink(path.join(context.directory, 'outside.php'), path.join(context.themePath, 'functions.php')) }
      if (variant === 'inc-symlink') { await fs.rm(path.join(context.themePath, 'inc'), { recursive: true }); await fs.symlink(context.directory, path.join(context.themePath, 'inc')) }
      if (variant === 'declare' || variant === 'namespace') { const source = variant === 'declare' ? '<?php\ndeclare(strict_types=1);\n' : '<?php\nnamespace ClientTheme;\n'; await fs.writeFile(path.join(context.themePath, 'functions.php'), source); input.expectedFunctionsHash = digest(source) }
      if (variant === 'closing-tag' || variant === 'invalid-encoding') { const bytes = variant === 'closing-tag' ? Buffer.from('<?php ?>') : Buffer.from([0xff]); await fs.writeFile(path.join(context.themePath, 'functions.php'), bytes); input.expectedFunctionsHash = digest(bytes) }
      await assert.rejects(installOwnedThemeAssets(input, { runner: context.runner }))
      await assert.rejects(fs.stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
      await assert.rejects(fs.stat(path.join(context.statePath, 'theme-assets-journal.json')), { code: 'ENOENT' })
    } finally { await context.dispose() }
  })
}

test('lock-held primitive composes without reentrant acquire and rejects absent lock', async () => {
  const context = await fixture()
  try {
    await assert.rejects(installThemeAssetsWithinLock(context.input, { runner: context.runner }), /UNSAFE_PATH/)
    const report = await withSiteLock(context.statePath, () => installThemeAssetsWithinLock(context.input, { runner: context.runner }))
    assert.equal(report.action, 'installed')
  } finally { await context.dispose() }
})

test('changed registration under lock prevents write and leaves reconciliation lock', async () => {
  const context = await fixture()
  try {
    context.swapRegistration()
    await assert.rejects(installOwnedThemeAssets(context.input, { runner: context.runner }), /site_registration_mismatch/)
    assert.equal(await fs.readFile(path.join(context.themePath, 'functions.php'), 'utf8'), context.functions)
    assert.ok((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
  } finally { await context.dispose() }
})

test('partial write retains before-image and lock, blocks snapshot and blind retry', async () => {
  const context = await fixture()
  const rename = fs.rename
  try {
    const intercepted = mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      if (String(to) === path.join(context.themePath, 'functions.php')) throw new Error('PRIVATE_RAW_FAILURE')
      return rename(from, to)
    })
    await assert.rejects(installOwnedThemeAssets(context.input, { runner: context.runner }), /theme_assets_failed/)
    intercepted.mock.restore()
    const journal = JSON.parse(await fs.readFile(path.join(context.statePath, 'theme-assets-journal.json'), 'utf8')) as { status: string; before: { functions: string } }
    assert.equal(journal.status, 'prepared')
    assert.equal(Buffer.from(journal.before.functions, 'base64').toString(), context.functions)
    assert.equal(await fs.readFile(path.join(context.themePath, 'functions.php'), 'utf8'), context.functions)
    const tools = createWordPressStudioTools(context.input.config, { runner: context.runner })
    await assert.rejects(tools.captureSnapshot(context.input.scope, context.input.handle), /site_busy_or_reconciliation_required/)
    await assert.rejects(installOwnedThemeAssets({ ...context.input, ...await context.hashes() }, { runner: context.runner }), /theme_assets_reconciliation_required/)
  } finally { mock.restoreAll(); await context.dispose() }
})


test('managed include precedes unconditional customer return without modifying remaining source', async () => {
  const context = await fixture()
  try {
    const original = "<?php\nreturn;\n" + context.functions.slice(6)
    await fs.writeFile(path.join(context.themePath, 'functions.php'), original)
    await installOwnedThemeAssets({ ...context.input, expectedFunctionsHash: digest(original) }, { runner: context.runner })
    const actual = await fs.readFile(path.join(context.themePath, 'functions.php'), 'utf8')
    assert.ok(actual.startsWith("<?php\nrequire_once __DIR__ . '/inc/assets.php';\nreturn;\n"))
    assert.equal(actual.replace("require_once __DIR__ . '/inc/assets.php';\n", ''), original)
  } finally { await context.dispose() }
})

test('replay refuses a moved or commented-out managed include', async () => {
  const context = await fixture()
  try {
    await installOwnedThemeAssets(context.input, { runner: context.runner })
    const filename = path.join(context.themePath, 'functions.php')
    const edited = (await fs.readFile(filename, 'utf8')).replace("require_once __DIR__ . '/inc/assets.php';", "// require_once __DIR__ . '/inc/assets.php';")
    await fs.writeFile(filename, edited)
    await assert.rejects(installOwnedThemeAssets({ ...context.input, ...await context.hashes() }, { runner: context.runner }), /theme_assets_ownership_conflict/)
    assert.equal(await fs.readFile(filename, 'utf8'), edited)
  } finally { await context.dispose() }
})


test('large accepted source has a bounded readable before-image journal on replay', async () => {
  const context = await fixture()
  try {
    const original = '<?php\n/*' + 'x'.repeat(400 * 1024) + '*/\n'
    await fs.writeFile(path.join(context.themePath, 'functions.php'), original)
    await installOwnedThemeAssets({ ...context.input, expectedFunctionsHash: digest(original) }, { runner: context.runner })
    assert.ok((await fs.stat(path.join(context.statePath, 'theme-assets-journal.json'))).size > 512 * 1024)
    const replay = await installOwnedThemeAssets({ ...context.input, ...await context.hashes() }, { runner: context.runner })
    assert.equal(replay.action, 'unchanged')
  } finally { await context.dispose() }
})
