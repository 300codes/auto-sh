import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildOwnedTheme } from '../theme-build.ts'
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

test('real local Tailwind compiles PHP HTML and JS deterministically without evaluating source or resetting content', async () => {
  const context = await fixture()
  try {
    const first = await buildOwnedTheme(context.input, { runner: context.runner })
    const second = await buildOwnedTheme(context.input, { runner: context.runner })
    const css = await readFile(context.output, 'utf8')
    for (const selector of ['.flex', '.p-4', '.grid', '.gap-6', '.text-xl', '.font-bold']) assert.ok(css.includes(selector), selector)
    assert.equal(first.output.sha256, second.output.sha256)
    assert.equal(first.sourceHash, second.sourceHash)
    assert.equal(first.sources.find((source) => source.path === 'index.php')?.sha256, createHash('sha256').update(await readFile(path.join(context.themePath, 'index.php'))).digest('hex'))
    assert.equal(first.compilation, 'real_local_tailwind')
    assert.equal(first.provenance, 'fixture')
    assert.equal(first.toolchain.compiler.version, '4.3.3')
    assert.equal(first.toolchain.scanner.version, '4.3.3')
    assert.equal(first.enqueue, 'not_run')
    assert.equal(first.preflight, 'excluded')
    assert.ok(!css.includes('box-sizing: border-box'))
    assert.equal(await readFile(path.join(context.themePath, 'assets/css/custom.css'), 'utf8'), 'body { color: purple; }')
    assert.equal(await readFile(path.join(context.themePath, 'theme.json'), 'utf8'), '{"version":3,"styles":{"color":{"text":"purple"}}}')
    assert.equal(await readFile(path.join(context.sitePath, 'database-surrogate'), 'utf8'), 'preserved native content')
    await assert.rejects(stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

test('validated fixture design mapper feeds real utilities but never claims approved design', async () => {
  const context = await fixture()
  try {
    const designTokens = { schemaVersion: 1, provenance: 'fixture', source: { designRef: 'fixture-design', revision: 'fixture-revision' }, tokens: {
      colors: [{ id: 'brand', name: 'Brand', value: '#123456' }], fonts: [{ id: 'body', name: 'Body', families: ['system-ui'] }], fontSizes: [{ id: 'reading', name: 'Reading', value: '1rem' }], spacing: [{ id: 'section', name: 'Section', value: '2rem' }],
    } }
    const report = await buildOwnedTheme({ ...context.input, config: { ...context.config, designTokens } }, { runner: context.runner })
    assert.ok((await readFile(context.output, 'utf8')).includes('.bg-design-brand'))
    assert.equal(report.design?.provenance, 'fixture')
    assert.equal(report.design?.approvalVerification, 'not_evaluated')
    assert.equal(report.provenance, 'fixture')
  } finally { await context.dispose() }
})

for (const variant of ['scope', 'input-symlink', 'output-symlink', 'output-parent-symlink', 'oversized', 'invalid-encoding', 'toolchain-served'] as const) {
  test(`rejects ${variant} before output mutation`, async () => {
    const context = await fixture()
    try {
      const input = { ...context.input, config: { ...context.config } }
      if (variant === 'scope') input.scope = { ...input.scope, tenantId: randomUUID() }
      if (variant === 'input-symlink') await symlink(path.join(context.directory, 'outside.php'), path.join(context.themePath, 'link.php'))
      if (variant === 'output-symlink') { await mkdir(path.dirname(context.output)); await symlink(path.join(context.directory, 'outside.css'), context.output) }
      if (variant === 'output-parent-symlink') { await mkdir(path.join(context.directory, 'outside')); await symlink(path.join(context.directory, 'outside'), path.dirname(context.output)) }
      if (variant === 'invalid-encoding') await writeFile(path.join(context.themePath, 'invalid.php'), Buffer.from([0xff, 0xfe]))
      if (variant === 'oversized') await writeFile(path.join(context.themePath, 'large.php'), 'x'.repeat(2 * 1024 * 1024 + 1))
      if (variant === 'toolchain-served') input.config.toolchainRoot = context.sitePath
      await assert.rejects(buildOwnedTheme(input, { runner: context.runner }))
      await assert.rejects(stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
      await assert.rejects(stat(path.join(context.directory, 'outside.css')), { code: 'ENOENT' })
    } finally { await context.dispose() }
  })
}

test('registration change under lock prevents compilation/write and retains reconciliation lock', async () => {
  const context = await fixture()
  try {
    context.foreignRegistration()
    await assert.rejects(buildOwnedTheme(context.input, { runner: context.runner }), /site_registration_mismatch/)
    await assert.rejects(stat(context.output), { code: 'ENOENT' })
    assert.ok((await stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
  } finally { await context.dispose() }
})

test('bounded compiler failure preserves previous CSS and retains operation lock', async () => {
  const context = await fixture()
  try {
    await mkdir(path.dirname(context.output))
    await writeFile(context.output, 'previous compiled CSS')
    await assert.rejects(buildOwnedTheme({ ...context.input, config: { ...context.config, timeoutMs: 1 } }, { runner: context.runner }), /theme_compile_failed/)
    assert.equal(await readFile(context.output, 'utf8'), 'previous compiled CSS')
    assert.ok((await stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
  } finally { await context.dispose() }
})
