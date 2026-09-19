import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { cleanupOwnedEditorFixture, prepareOwnedEditorFixture, readOwnedEditorFixture } from '../editor-fixtures.ts'
import { requestHashFor, siteIdFor, writeRecord } from '../ownership.ts'
import { createWordPressStudioTools } from '../tools.ts'
import type { CommandRunner } from '../runner.ts'

type Call = { action: string; kind: string; id: number; marker: string; password: string; capabilities: string[]; forbiddenCapabilities: string[]; ids: Record<string, number> }
async function fixture(options: { uncertain?: string; deniedRead?: string; escalatedActor?: boolean; collision?: boolean; deniedDelete?: string } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-editor-fixture-'))
  const config = { sitesRoot: path.join(directory, 'sites'), stateRoot: path.join(directory, 'state') }
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  for (const folder of [config.sitesRoot, config.stateRoot, sitePath, statePath]) await fs.mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'editor', name: 'Editor fixture', themeSlug: 'editor-fixture' }
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready', result: {
    schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'owned-studio', localUrl: 'http://localhost:12345', themeSlug: request.themeSlug, themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [],
  } })
  const resources = new Map<string, number>()
  const calls: Call[] = []
  const scripts: string[] = []
  let nextId = 10
  let edited = false
  const runner: CommandRunner = async (executable, args) => {
    assert.equal(executable, 'studio')
    if (args[0] === 'site') return { stdout: JSON.stringify([{ id: 'owned-studio', path: sitePath, running: false }]), exitCode: 0 }
    assert.deepEqual(args.slice(0, 2), ['wp', 'eval'])
    assert.deepEqual(args.slice(-2), ['--path', sitePath])
    const script = args[2]!
    const encoded = script.match(/base64_decode\('([A-Za-z0-9+/=]+)'\)/)?.[1]
    assert.ok(encoded)
    const input = JSON.parse(Buffer.from(encoded, 'base64').toString()) as Call
    calls.push(input); scripts.push(script)
    let result: unknown
    if (input.action === 'preflight') {
      if (options.collision) throw new Error('RAW_PRIVATE_COLLISION')
      result = { ok: true }
    } else if (input.action === 'create') {
      assert.equal(resources.has(input.kind), false)
      if (input.kind === 'actor') assert.ok(input.password.length >= 40)
      else assert.equal(input.password, '')
      const id = input.kind === 'role' ? 0 : nextId++
      resources.set(input.kind, id)
      if (options.uncertain === input.kind) throw new Error('RAW_PRIVATE_MUTATION_FAILURE')
      result = { id }
    } else if (input.action === 'find') result = { ids: resources.has(input.kind) ? [resources.get(input.kind)] : [] }
    else if (input.action === 'delete') {
      if (options.deniedDelete === input.kind) throw new Error('RAW_PRIVATE_OWNERSHIP_FAILURE')
      assert.equal(input.id, resources.get(input.kind)); resources.delete(input.kind); result = { deleted: true }
    } else if (input.action === 'read') {
      if (options.deniedRead === input.kind) throw new Error('RAW_PRIVATE_OWNERSHIP_FAILURE')
      assert.equal(input.id, resources.get(input.kind))
      result = input.kind === 'actor' ? { id: input.id, capabilities: { ...Object.fromEntries(input.capabilities.map((capability) => [capability, true])), ...Object.fromEntries(input.forbiddenCapabilities.map((capability) => [capability, options.escalatedActor ? true : false])) } }
        : input.kind === 'page' ? { id: input.id, content: edited ? 'Native edited content' : 'Native initial content', acf: edited ? 'Editor ACF' : 'Editable ACF fixture', seoTitle: edited ? 'Editor SEO' : 'Editable SEO fixture', seoDescription: 'Editable SEO description' }
          : ['styles', 'header', 'footer', 'navigation'].includes(input.kind) ? { id: input.id, content: `${edited ? 'Edited' : 'Initial'} ${input.kind}` } : { id: input.id }
    } else assert.fail(`Unexpected ${input.action}`)
    return { stdout: JSON.stringify(result), exitCode: 0 }
  }
  const input = { scope, handle, fixtureId: randomUUID(), config }
  const journalPath = path.join(statePath, `editor-fixture-${input.fixtureId}.json`)
  return { directory, input, runner, statePath, journalPath, calls, scripts, resources, edit: () => { edited = true }, dispose: () => fs.rm(directory, { recursive: true, force: true }) }
}

test('prepares versioned native resources, restricts actor, keeps credentials private and replays without writes', async () => {
  const context = await fixture()
  try {
    const first = await prepareOwnedEditorFixture(context.input, { runner: context.runner })
    assert.equal(first.provenance, 'fixture'); assert.equal(first.browser, 'not_run')
    assert.equal(first.resources.length, 11)
    assert.notEqual(first.resources.find((resource) => resource.kind === 'media')?.id, first.resources.find((resource) => resource.kind === 'replacement')?.id)
    assert.equal(first.actor.capabilities.edit_theme_options, true)
    for (const cap of ['manage_options', 'install_plugins', 'edit_plugins', 'edit_users']) assert.equal(first.actor.capabilities[cap], false)
    const journal = JSON.parse(await fs.readFile(context.journalPath, 'utf8')) as { password: string; status: string; marker: string; definitionVersion: number }
    assert.equal(journal.status, 'ready'); assert.equal(journal.definitionVersion, 2)
    assert.equal(first.actor.login, `${journal.marker}-actor`)
    assert.equal((await fs.stat(context.journalPath)).mode & 0o077, 0)
    assert.ok(!JSON.stringify(first).includes(journal.password))
    const createCount = context.calls.filter((call) => call.action === 'create').length
    await prepareOwnedEditorFixture(context.input, { runner: context.runner })
    assert.equal(context.calls.filter((call) => call.action === 'create').length, createCount)
    context.edit()
    const read = await readOwnedEditorFixture(context.input, { runner: context.runner })
    assert.equal(read.page.acf, 'Editor ACF'); assert.equal(read.page.seoTitle, 'Editor SEO')
    assert.equal(read.nativeContent.styles?.content, 'Edited styles')
    assert.equal(read.nativeContent.header?.content, 'Edited header')
  } finally { await context.dispose() }
})

test('version one journals remain readable and cleanable without adding replacement media on replay', async () => {
  const context = await fixture()
  try {
    await prepareOwnedEditorFixture(context.input, { runner: context.runner })
    const journal = JSON.parse(await fs.readFile(context.journalPath, 'utf8')) as { definitionVersion: number; resources: Array<{ kind: string; id: number }> }
    journal.definitionVersion = 1
    journal.resources = journal.resources.filter((resource) => resource.kind !== 'replacement')
    context.resources.delete('replacement')
    await fs.writeFile(context.journalPath, JSON.stringify(journal))
    const writes = context.calls.filter((call) => call.action === 'create').length
    const replay = await prepareOwnedEditorFixture(context.input, { runner: context.runner })
    assert.equal(replay.definitionVersion, 1)
    assert.equal(replay.resources.length, 10)
    assert.equal(context.calls.filter((call) => call.action === 'create').length, writes)
    await cleanupOwnedEditorFixture(context.input, { runner: context.runner })
    assert.equal(context.resources.size, 0)
  } finally { await context.dispose() }
})

test('fixed PHP is syntactically valid and uses real ACF APIs and supported native block structures', async () => {
  const context = await fixture()
  try {
    await prepareOwnedEditorFixture(context.input, { runner: context.runner })
    const script = context.scripts[0]!
    for (const token of ['acf_update_field_group(', 'acf_update_field(', 'update_field(', 'get_field(', 'wp_insert_attachment(', 'wp_insert_user(', 'wp_global_styles', 'isGlobalStylesUserThemeJSON', 'wp:heading', 'wp:image', 'wp:button', 'wp:group', 'wp:navigation', 'wp:template-part', 'wp_theme', 'wp_template_part_area', 'post_author = %d']) assert.ok(script.includes(token), token)
    const filename = path.join(context.directory, 'fixture.php')
    await fs.writeFile(filename, '<?php\n' + script)
    const result = await promisify(execFile)('php', ['-l', filename], { timeout: 5000 })
    assert.match(result.stdout, /No syntax errors/)
  } finally { await context.dispose() }
})

test('cleanup deletes recorded resources in reverse order and erases credentials; replay is inert', async () => {
  const context = await fixture()
  try {
    const prepared = await prepareOwnedEditorFixture(context.input, { runner: context.runner })
    await cleanupOwnedEditorFixture(context.input, { runner: context.runner })
    assert.deepEqual(context.calls.filter((call) => call.action === 'delete').map((call) => call.kind), [...prepared.resources].reverse().map((resource) => resource.kind))
    assert.equal(context.resources.size, 0)
    const journal = JSON.parse(await fs.readFile(context.journalPath, 'utf8')) as { password: string; status: string }
    assert.equal(journal.status, 'cleaned'); assert.equal(journal.password, '')
    const count = context.calls.length
    await cleanupOwnedEditorFixture(context.input, { runner: context.runner })
    assert.equal(context.calls.length, count)
  } finally { await context.dispose() }
})

for (const kind of ['actor', 'group', 'media', 'replacement', 'page']) {
  test(`uncertain ${kind} creation records marker-based recovery and retains lock`, async () => {
    const context = await fixture({ uncertain: kind })
    try {
      await assert.rejects(prepareOwnedEditorFixture(context.input, { runner: context.runner }), /editor_fixture_reconciliation_required/)
      const journal = JSON.parse(await fs.readFile(context.journalPath, 'utf8')) as { status: string; pending: string; resources: Array<{ kind: string }> }
      assert.equal(journal.status, 'reconciliation_required'); assert.equal(journal.pending, kind)
      assert.ok(journal.resources.some((resource) => resource.kind === kind))
      assert.equal(context.calls.at(-1)?.action, 'find')
      await assert.rejects(createWordPressStudioTools(context.input.config, { runner: context.runner }).captureSnapshot(context.input.scope, context.input.handle), /site_busy_or_reconciliation_required/)
      await assert.rejects(cleanupOwnedEditorFixture(context.input, { runner: context.runner }), /site_busy_or_reconciliation_required/)
    } finally { await context.dispose() }
  })
}

test('foreign scope and journal symlink cause zero WP mutations', async () => {
  for (const symlink of [false, true]) {
    const context = await fixture()
    try {
      if (symlink) { const outside = path.join(context.directory, 'outside.json'); await fs.writeFile(outside, '{}'); await fs.symlink(outside, context.journalPath) }
      const input = symlink ? context.input : { ...context.input, scope: { ...context.input.scope, organizationId: randomUUID() } }
      await assert.rejects(prepareOwnedEditorFixture(input, { runner: context.runner }))
      assert.equal(context.calls.length, 0)
    } finally { await context.dispose() }
  }
})

test('existing native ownership collision refuses before fixture journal or create', async () => {
  const context = await fixture({ collision: true })
  try {
    await assert.rejects(prepareOwnedEditorFixture(context.input, { runner: context.runner }), /editor_fixture_failed/)
    assert.equal(context.calls.filter((call) => call.action === 'create').length, 0)
    await assert.rejects(fs.stat(context.journalPath), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

test('escalated actor capabilities cannot produce ready report', async () => {
  const context = await fixture({ escalatedActor: true })
  try {
    await assert.rejects(prepareOwnedEditorFixture(context.input, { runner: context.runner }), /editor_fixture_capabilities_invalid/)
    assert.ok((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
    const journal = JSON.parse(await fs.readFile(context.journalPath, 'utf8')) as { status: string }
    assert.equal(journal.status, 'preparing')
  } finally { await context.dispose() }
})

for (const kind of ['page', 'actor']) {
  test(`cleanup refuses native ${kind} ownership or unmanaged records failure without discarding ledger`, async () => {
    const context = await fixture({ deniedDelete: kind })
    try {
      await prepareOwnedEditorFixture(context.input, { runner: context.runner })
      await assert.rejects(cleanupOwnedEditorFixture(context.input, { runner: context.runner }), /editor_fixture_failed/)
      assert.ok(context.resources.has(kind)); assert.ok(context.resources.has('role'))
      const journal = JSON.parse(await fs.readFile(context.journalPath, 'utf8')) as { resources: Array<{ kind: string }> }
      assert.ok(journal.resources.some((resource) => resource.kind === kind))
      assert.ok((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
    } finally { await context.dispose() }
  })
}

test('both fixture images have distinct bytes and valid PNG chunk checksums', async () => {
  const context = await fixture()
  try {
    await prepareOwnedEditorFixture(context.input, { runner: context.runner })
    const images = [...context.scripts[0]!.matchAll(/'(iVBORw0KGgo[^']+)'/g)].map((match) => Buffer.from(match[1]!, 'base64'))
    assert.equal(images.length, 2)
    assert.notDeepEqual(images[0], images[1])
    const { crc32 } = await import('node:zlib')
    for (const bytes of images) {
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      let offset = 8
      const chunks: string[] = []
      while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset)
        const end = offset + 8 + length
        assert.equal(crc32(bytes.subarray(offset + 4, end)), bytes.readUInt32BE(end))
        chunks.push(bytes.subarray(offset + 4, offset + 8).toString())
        offset = end + 4
      }
      assert.deepEqual(chunks, ['IHDR', 'IDAT', 'IEND']); assert.equal(offset, bytes.length)
    }
  } finally { await context.dispose() }
})

test('real PHP attachment failure removes only its orphan upload and preserves attached or changed bytes', async () => {
  for (const kind of ['media', 'replacement']) for (const mode of ['orphan', 'attached', 'changed']) {
    const context = await fixture()
    try {
      await prepareOwnedEditorFixture(context.input, { runner: context.runner })
      const index = context.calls.findIndex((call) => call.action === 'create' && call.kind === kind)
      const script = context.scripts[index]!
      const stubs = `
function get_post_stati() { return array('inherit','publish'); }
function get_posts($args) { return !empty($GLOBALS['attached']) ? array(55) : array(); }
function wp_upload_bits($name,$unused,$bytes) { $file=FIXTURE_DIRECTORY.'/owned.png'; file_put_contents($file,$bytes); return array('error'=>false,'file'=>$file); }
function wp_insert_attachment($data,$file,$parent,$error) {
  if (FIXTURE_MODE==='attached') $GLOBALS['attached']=true;
  if (FIXTURE_MODE==='changed') file_put_contents($file,'unrelated changed bytes');
  throw new Exception('simulated attachment failure');
}
`
      const filename = path.join(context.directory, 'media-failure.php')
      const foreign = path.join(context.directory, 'preexisting.png')
      await fs.writeFile(foreign, 'preexisting unrelated bytes')
      await fs.writeFile(filename, `<?php\ndefine('FIXTURE_DIRECTORY',base64_decode('${Buffer.from(context.directory).toString('base64')}'));\ndefine('FIXTURE_MODE','${mode}');\n${stubs}\ntry {\n${script}\n} catch (Throwable $error) { echo 'handled'; }\n`)
      const result = await promisify(execFile)('php', [filename], { timeout: 5000 })
      assert.equal(result.stdout, 'handled')
      if (mode === 'orphan') await assert.rejects(fs.stat(path.join(context.directory, 'owned.png')), { code: 'ENOENT' })
      else assert.ok((await fs.stat(path.join(context.directory, 'owned.png'))).isFile())
      assert.equal(await fs.readFile(foreign, 'utf8'), 'preexisting unrelated bytes')
    } finally { await context.dispose() }
  }
})

test('real PHP creates separate owned media paths and deletes both through attachment cleanup', async () => {
  const context = await fixture()
  try {
    await prepareOwnedEditorFixture(context.input, { runner: context.runner })
    await cleanupOwnedEditorFixture(context.input, { runner: context.runner })
    const created: string[] = []
    for (const kind of ['media', 'replacement']) {
      const createIndex = context.calls.findIndex((call) => call.action === 'create' && call.kind === kind)
      const filename = path.join(context.directory, `${kind}-create.php`)
      const stubs = `
function get_post_stati() { return array('inherit','publish'); }
function get_posts($args) { return array(); }
function is_wp_error($value) { return false; }
function wp_json_encode($value) { return json_encode($value); }
function wp_upload_bits($name,$unused,$bytes) { $file=FIXTURE_DIRECTORY.'/'.$name; file_put_contents($file,$bytes); return array('error'=>false,'file'=>$file); }
function wp_insert_attachment($data,$file,$parent,$error) {
  if ($data['post_name'] !== $GLOBALS['input']['marker'].'-'.$GLOBALS['input']['kind'] || $data['meta_input']['_om_delivery_fixture'] !== $GLOBALS['input']['marker'] || $data['post_author'] !== $GLOBALS['input']['ids']['actor']) throw new Exception('wrong owner');
  return 55;
}
`
      await fs.writeFile(filename, `<?php\ndefine('FIXTURE_DIRECTORY',base64_decode('${Buffer.from(context.directory).toString('base64')}'));\n${stubs}\n${context.scripts[createIndex]}`)
      assert.equal((await promisify(execFile)('php', [filename], { timeout: 5000 })).stdout, '{"id":55}')
      const marker = context.calls[createIndex]!.marker
      created.push(path.join(context.directory, `${marker}${kind === 'replacement' ? '-replacement' : ''}.png`))
      const deleteIndex = context.calls.findIndex((call) => call.action === 'delete' && call.kind === kind)
      const cleanup = path.join(context.directory, `${kind}-delete.php`)
      await fs.writeFile(cleanup, `<?php
function get_post($id) { return (object) array('post_type'=>'attachment'); }
function get_post_meta($id,$key,$single) { return $GLOBALS['input']['marker']; }
function wp_delete_attachment($id,$force) { if (!$force || $id !== $GLOBALS['input']['id']) throw new Exception('wrong attachment'); return true; }
function wp_json_encode($value) { return json_encode($value); }
${context.scripts[deleteIndex]}`)
      assert.equal((await promisify(execFile)('php', [cleanup], { timeout: 5000 })).stdout, '{"deleted":true}')
    }
    assert.notEqual(created[0], created[1])
    assert.notDeepEqual(await fs.readFile(created[0]!), await fs.readFile(created[1]!))
  } finally { await context.dispose() }
})

test('real PHP field cleanup refuses changed ACF type or children before any cascade', async () => {
  for (const mode of ['group', 'repeater', 'text-with-child', 'text']) {
    const context = await fixture()
    try {
      await prepareOwnedEditorFixture(context.input, { runner: context.runner })
      await cleanupOwnedEditorFixture(context.input, { runner: context.runner })
      const index = context.calls.findIndex((call) => call.action === 'delete' && call.kind === 'field')
      assert.ok(index >= 0)
      const script = context.scripts[index]!
      const stubs = `
function get_post($id) { $input=$GLOBALS['input']; return (object) array('ID'=>$id,'post_type'=>'acf-field','post_name'=>'field_'.$input['marker'],'post_parent'=>$input['ids']['group']); }
function acf_get_field($id) { return array('type'=>FIXTURE_MODE==='text-with-child'?'text':FIXTURE_MODE); }
function get_post_stati() { return array('publish'=>'publish','acf-disabled'=>'acf-disabled','trash'=>'trash'); }
function get_posts($args) {
  if ($args['post_parent'] !== $GLOBALS['input']['id'] || !in_array('acf-disabled',$args['post_status'],true) || !in_array('trash',$args['post_status'],true)) throw new Exception('missing ownership guard');
  return FIXTURE_MODE==='text-with-child'?array(999):array();
}
function acf_delete_field($id) { file_put_contents(FIXTURE_DIRECTORY.'/delete-called','cascade'); return true; }
function wp_json_encode($value) { return json_encode($value); }
`
      const filename = path.join(context.directory, 'field-cleanup.php')
      await fs.writeFile(filename, `<?php\ndefine('FIXTURE_DIRECTORY',base64_decode('${Buffer.from(context.directory).toString('base64')}'));\ndefine('FIXTURE_MODE','${mode}');\n${stubs}\ntry {\n${script}\n} catch (Throwable $error) { echo 'blocked'; }\n`)
      const result = await promisify(execFile)('php', [filename], { timeout: 5000 })
      if (mode === 'text') {
        assert.equal(result.stdout, '{"deleted":true}')
        assert.equal(await fs.readFile(path.join(context.directory, 'delete-called'), 'utf8'), 'cascade')
      } else {
        assert.equal(result.stdout, 'blocked')
        await assert.rejects(fs.stat(path.join(context.directory, 'delete-called')), { code: 'ENOENT' })
      }
    } finally { await context.dispose() }
  }
})
