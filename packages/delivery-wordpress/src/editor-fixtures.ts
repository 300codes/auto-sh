import { randomBytes, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory } from './paths.ts'
import { readRecord, withSiteLock } from './ownership.ts'
import { createCommandRunner, parseStudioJson, type CommandRunner } from './runner.ts'
import { createWordPressStudioTools } from './tools.ts'

const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema, fixtureId: z.uuid(),
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute), timeoutMs: z.number().int().min(1).max(600_000).optional() }).strict(),
}).strict()
const kinds = ['role', 'actor', 'group', 'field', 'media', 'replacement', 'navigation', 'header', 'footer', 'styles', 'page'] as const
const kindSchema = z.enum(kinds)
const resourceSchema = z.object({ kind: kindSchema, id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
const journalSchema = z.object({
  schemaVersion: z.literal(1), definitionVersion: z.union([z.literal(1), z.literal(2)]), siteId: siteHandleSchema.shape.siteId, fixtureId: z.uuid(),
  scope: scopeSchema, themeSlug: z.string(), marker: z.string(), password: z.string(),
  status: z.enum(['preparing', 'ready', 'cleaned', 'reconciliation_required']),
  pending: kindSchema.nullable(), resources: z.array(resourceSchema),
}).strict()
type Input = z.infer<typeof inputSchema>
type Journal = z.infer<typeof journalSchema>
type Kind = z.infer<typeof kindSchema>
type Dependencies = { runner?: CommandRunner }
const capabilities = ['read', 'edit_posts', 'edit_others_posts', 'edit_published_posts', 'publish_posts', 'delete_posts', 'delete_others_posts', 'delete_published_posts', 'edit_pages', 'edit_others_pages', 'edit_published_pages', 'publish_pages', 'delete_pages', 'delete_others_pages', 'delete_published_pages', 'upload_files', 'edit_theme_options']
const forbiddenCapabilities = ['manage_options', 'install_plugins', 'edit_plugins', 'activate_plugins', 'update_core', 'create_users', 'edit_users', 'promote_users', 'delete_users']

const php = String.raw`
function om_fixture_fail() { throw new Exception('editor_fixture_operation_failed'); }
function om_fixture_id($value) { if (is_wp_error($value) || !is_numeric($value) || intval($value) < 1) om_fixture_fail(); return intval($value); }
$marker = $input['marker']; $kind = $input['kind']; $action = $input['action'];
$types = array('group'=>'acf-field-group','field'=>'acf-field','media'=>'attachment','replacement'=>'attachment','navigation'=>'wp_navigation','header'=>'wp_template_part','footer'=>'wp_template_part','styles'=>'wp_global_styles','page'=>'page');
$slug = $marker . '-' . $kind;
if ($kind === 'group') $slug = 'group_' . $marker;
if ($kind === 'field') $slug = 'field_' . $marker;
function om_fixture_find($kind, $slug, $types) {
  if ($kind === 'role') return get_role($slug) ? array(0) : array();
  if ($kind === 'actor') { $user = get_user_by('login', $slug); return $user ? array(intval($user->ID)) : array(); }
  return array_map('intval', get_posts(array('post_type'=>$types[$kind], 'post_status'=>array_values(get_post_stati()), 'name'=>$slug, 'numberposts'=>3, 'fields'=>'ids', 'suppress_filters'=>true)));
}
if ($action === 'preflight') {
  if (!function_exists('acf_update_field_group') || !function_exists('acf_update_field') || !function_exists('update_field') || !defined('WPSEO_VERSION') || intval(get_option('blog_public')) !== 0 || get_stylesheet() !== $input['themeSlug']) om_fixture_fail();
  foreach ($input['kinds'] as $candidate) {
    $name = $marker . '-' . $candidate;
    if ($candidate === 'group') $name = 'group_' . $marker;
    if ($candidate === 'field') $name = 'field_' . $marker;
    if (count(om_fixture_find($candidate, $name, $types))) om_fixture_fail();
  }
  if (count(get_posts(array('post_type'=>'wp_global_styles','post_status'=>'any','numberposts'=>1,'tax_query'=>array(array('taxonomy'=>'wp_theme','field'=>'name','terms'=>$input['themeSlug'])))))) om_fixture_fail();
  $upload = wp_upload_dir();
  if (!empty($upload['error']) || file_exists($upload['path'] . '/' . $marker . '.png') || file_exists($upload['path'] . '/' . $marker . '-replacement.png')) om_fixture_fail();
  echo wp_json_encode(array('ok'=>true)); return;
}
if ($action === 'find') { echo wp_json_encode(array('ids'=>om_fixture_find($kind, $slug, $types))); return; }
if ($action === 'create') {
  if (count(om_fixture_find($kind, $slug, $types))) om_fixture_fail();
  if ($kind === 'role') {
    $caps = array_fill_keys($input['capabilities'], true);
    if (!add_role($slug, 'Delivery fixture editor', $caps)) om_fixture_fail();
    $id = 0;
  } elseif ($kind === 'actor') {
    $id = om_fixture_id(wp_insert_user(array('user_login'=>$slug, 'user_pass'=>$input['password'], 'user_email'=>$slug.'@example.invalid', 'role'=>$marker.'-role')));
  } elseif ($kind === 'group') {
    $group = acf_update_field_group(array('key'=>$slug, 'title'=>'Delivery fixture fields', 'active'=>false, 'location'=>array(array(array('param'=>'post','operator'=>'==','value'=>'0')))));
    $id = om_fixture_id($group['ID'] ?? 0);
  } elseif ($kind === 'field') {
    $field = acf_update_field(array('key'=>$slug, 'label'=>'Delivery fixture text', 'name'=>$marker.'_text', 'type'=>'text', 'parent'=>$input['ids']['group']));
    $id = om_fixture_id($field['ID'] ?? 0);
  } elseif ($kind === 'media' || $kind === 'replacement') {
    $ownedBytes = base64_decode($kind === 'media' ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwTpv5HwAENAIyWy0K4AAAAABJRU5ErkJggg==' : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO45O34HwAFrwJeHsPFwwAAAABJRU5ErkJggg==');
    $upload = wp_upload_bits($marker.($kind === 'replacement' ? '-replacement' : '').'.png', null, $ownedBytes);
    if (!empty($upload['error'])) om_fixture_fail();
    try {
      $id = om_fixture_id(wp_insert_attachment(array('post_title'=>$slug,'post_name'=>$slug,'post_status'=>'inherit','post_mime_type'=>'image/png','post_author'=>$input['ids']['actor'],'meta_input'=>array('_om_delivery_fixture'=>$marker)), $upload['file'], 0, true));
    } catch (Throwable $error) {
      if (!count(om_fixture_find($kind, $slug, $types)) && !is_link($upload['file']) && is_file($upload['file']) && hash_file('sha256', $upload['file']) === hash('sha256', $ownedBytes)) {
        unlink($upload['file']);
      }
      om_fixture_fail();
    }
  } else {
    $content = '';
    if ($kind === 'navigation') $content = '<!-- wp:navigation-link {"label":"Fixture link","url":"#fixture-content","kind":"custom"} /-->';
    if ($kind === 'header' || $kind === 'footer') $content = '<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>Editable fixture '.$kind.'</p><!-- /wp:paragraph --></div><!-- /wp:group -->';
    if ($kind === 'styles') $content = wp_json_encode(array('version'=>2, 'isGlobalStylesUserThemeJSON'=>true, 'styles'=>array('spacing'=>array('blockGap'=>'1.25rem'))));
    if ($kind === 'page') {
      $image = wp_get_attachment_url($input['ids']['media']);
      if (!$image) om_fixture_fail();
      $content = '<!-- wp:template-part '.wp_json_encode(array('slug'=>$marker.'-header','theme'=>$input['themeSlug'])).' /-->'
        .'<!-- wp:group {"anchor":"fixture-content"} --><div class="wp-block-group" id="fixture-content"><!-- wp:heading --><h2 class="wp-block-heading">Editable heading</h2><!-- /wp:heading -->'
        .'<!-- wp:paragraph --><p>Editable native section</p><!-- /wp:paragraph -->'
        .'<!-- wp:image '.wp_json_encode(array('id'=>$input['ids']['media'],'sizeSlug'=>'full','linkDestination'=>'none')).' --><figure class="wp-block-image size-full"><img src="'.esc_url($image).'" alt="Fixture image" class="wp-image-'.$input['ids']['media'].'"/></figure><!-- /wp:image -->'
        .'<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="#fixture-content">Editable CTA</a></div><!-- /wp:button --></div><!-- /wp:buttons -->'
        .'<!-- wp:navigation '.wp_json_encode(array('ref'=>$input['ids']['navigation'])).' /--></div><!-- /wp:group -->'
        .'<!-- wp:template-part '.wp_json_encode(array('slug'=>$marker.'-footer','theme'=>$input['themeSlug'])).' /-->';
    }
    $id = om_fixture_id(wp_insert_post(array('post_type'=>$types[$kind], 'post_status'=>$kind==='page'?'draft':'publish', 'post_name'=>$slug, 'post_title'=>$slug, 'post_content'=>$content, 'post_author'=>$input['ids']['actor'], 'meta_input'=>array('_om_delivery_fixture'=>$marker)), true));
    if ($kind === 'styles' && is_wp_error(wp_set_object_terms($id, $input['themeSlug'], 'wp_theme'))) om_fixture_fail();
    if ($kind === 'header' || $kind === 'footer') {
      if (is_wp_error(wp_set_object_terms($id, $input['themeSlug'], 'wp_theme')) || is_wp_error(wp_set_object_terms($id, $kind, 'wp_template_part_area'))) om_fixture_fail();
    }
    if ($kind === 'page') {
      acf_update_field_group(array('ID'=>$input['ids']['group'], 'key'=>'group_'.$marker, 'title'=>'Delivery fixture fields', 'active'=>true, 'location'=>array(array(array('param'=>'post','operator'=>'==','value'=>strval($id))))));
      update_field('field_'.$marker, 'Editable ACF fixture', $id);
      update_post_meta($id, '_yoast_wpseo_title', 'Editable SEO fixture');
      update_post_meta($id, '_yoast_wpseo_metadesc', 'Editable SEO description');
    }
  }
  echo wp_json_encode(array('id'=>$id)); return;
}
$id = intval($input['id']);
if ($kind === 'role') {
  $role = get_role($slug);
  if (!$role) { if ($action === 'delete') { echo wp_json_encode(array('deleted'=>true)); return; } om_fixture_fail(); }
  $expected = array_fill_keys($input['capabilities'], true); $actual = $role->capabilities;
  ksort($actual); ksort($expected); if ($actual !== $expected) om_fixture_fail();
} elseif ($kind === 'actor') {
  $user = get_user_by('id', $id);
  if (!$user) { if ($action === 'delete') { echo wp_json_encode(array('deleted'=>true)); return; } om_fixture_fail(); }
  if ($user->user_login !== $slug || $user->roles !== array($marker.'-role')) om_fixture_fail();
} else {
  $post = get_post($id);
  if (!$post) { if ($action === 'delete') { echo wp_json_encode(array('deleted'=>true)); return; } om_fixture_fail(); }
  if ($post->post_type !== $types[$kind]) om_fixture_fail();
  if ($kind === 'group' || $kind === 'field') {
    if ($post->post_name !== $slug || ($kind==='field' && intval($post->post_parent)!==$input['ids']['group'])) om_fixture_fail();
  } elseif (get_post_meta($id, '_om_delivery_fixture', true) !== $marker) om_fixture_fail();
}
if ($action === 'delete') {
  if ($kind === 'role') { if (count(get_users(array('role'=>$slug,'number'=>1,'fields'=>'ID')))) om_fixture_fail(); remove_role($slug); if (get_role($slug)) om_fixture_fail(); }
  elseif ($kind === 'actor') {
    global $wpdb;
    if (intval($wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_author = %d", $id)))) om_fixture_fail();
    require_once ABSPATH.'wp-admin/includes/user.php'; if (!wp_delete_user($id)) om_fixture_fail();
  } elseif ($kind === 'group') {
    if (count(get_posts(array('post_type'=>'acf-field','post_status'=>array_values(get_post_stati()),'post_parent'=>$id,'numberposts'=>1,'fields'=>'ids')))) om_fixture_fail();
    if (!acf_delete_field_group($id)) om_fixture_fail();
  } elseif ($kind === 'field') {
    $field = acf_get_field($id);
    if (!is_array($field) || ($field['type'] ?? null) !== 'text') om_fixture_fail();
    if (count(get_posts(array('post_type'=>'acf-field','post_status'=>array_values(get_post_stati()),'post_parent'=>$id,'numberposts'=>1,'fields'=>'ids')))) om_fixture_fail();
    if (!acf_delete_field($id)) om_fixture_fail();
  }
  elseif ($kind === 'media' || $kind === 'replacement') { if (!wp_delete_attachment($id, true)) om_fixture_fail(); }
  elseif (!wp_delete_post($id, true)) om_fixture_fail();
  echo wp_json_encode(array('deleted'=>true)); return;
}
if ($action !== 'read') om_fixture_fail();
if ($kind === 'actor') {
  $caps = array(); foreach (array_merge($input['capabilities'], $input['forbiddenCapabilities']) as $cap) $caps[$cap] = user_can($id, $cap);
  echo wp_json_encode(array('id'=>$id,'capabilities'=>$caps)); return;
}
if (in_array($kind, array('styles','header','footer','navigation'), true)) { echo wp_json_encode(array('id'=>$id,'content'=>$post->post_content)); return; }
if ($kind === 'page') {
  echo wp_json_encode(array('id'=>$id,'content'=>$post->post_content,'acf'=>get_field('field_'.$marker,$id),'seoTitle'=>get_post_meta($id,'_yoast_wpseo_title',true),'seoDescription'=>get_post_meta($id,'_yoast_wpseo_metadesc',true))); return;
}
echo wp_json_encode(array('id'=>$id));
`

async function readJournal(filename: string): Promise<Journal | null> {
  try { await fs.lstat(filename) } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
  await assertRegularFile(filename)
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if ((await file.stat()).size > 64 * 1024) throw toolError('editor_fixture_journal_limit')
    return parseInput(journalSchema, JSON.parse(await file.readFile('utf8')))
  } finally { await file.close() }
}
async function writeJournal(filename: string, journal: Journal) {
  await assertContainedPath(path.dirname(filename), filename)
  const temporary = path.join(path.dirname(filename), `.editor-${randomUUID()}.tmp`)
  try { await fs.writeFile(temporary, JSON.stringify(journal), { mode: 0o600, flag: 'wx' }); await assertContainedPath(path.dirname(filename), filename); await fs.rename(temporary, filename) }
  finally { await fs.rm(temporary, { force: true }) }
}
async function context(input: Input, dependencies: Dependencies) {
  const runner = dependencies.runner ?? createCommandRunner({ timeoutMs: input.config.timeoutMs })
  const tools = createWordPressStudioTools(input.config, { runner })
  await tools.status(input.scope, input.handle)
  const statePath = path.join(input.config.stateRoot, input.handle.siteId)
  const owner = await readRecord(statePath)
  const filename = path.join(statePath, `editor-fixture-${input.fixtureId}.json`)
  const journal = await readJournal(filename)
  if (journal && (journal.siteId !== input.handle.siteId || journal.fixtureId !== input.fixtureId || JSON.stringify(journal.scope) !== JSON.stringify(input.scope) || journal.themeSlug !== owner.request.themeSlug)) throw toolError('editor_fixture_ownership_conflict')
  const call = async (current: Journal, action: string, kind: Kind, id = 0) => {
    const data = { action, kind, id, marker: current.marker, themeSlug: current.themeSlug, password: action === 'create' && kind === 'actor' ? current.password : '', capabilities, forbiddenCapabilities, kinds, ids: Object.fromEntries(current.resources.map((resource) => [resource.kind, resource.id])) }
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64')
    return parseStudioJson((await runner('studio', ['wp', 'eval', `$input = json_decode(base64_decode('${encoded}'), true);\n${php}`, '--path', path.join(input.config.sitesRoot, input.handle.siteId)], { timeoutMs: input.config.timeoutMs })).stdout)
  }
  return { tools, statePath, owner, filename, journal, call }
}
async function safe<Result>(work: () => Promise<Result>) {
  try { return await work() } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    const allowed = new Set(['invalid_input', 'ownership_mismatch', 'site_registration_mismatch', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH', 'editor_fixture_ownership_conflict', 'editor_fixture_reconciliation_required', 'editor_fixture_not_ready', 'editor_fixture_capabilities_invalid'])
    throw toolError(allowed.has(code) ? code : 'editor_fixture_failed')
  }
}
async function readState(current: Awaited<ReturnType<typeof context>>, journal: Journal, dependencies: Dependencies) {
  if (journal.status !== 'ready') throw toolError('editor_fixture_not_ready')
  let actor: { id: number; capabilities: Record<string, boolean> } | undefined
  let page: { id: number; content: string; acf: string; seoTitle: string; seoDescription: string } | undefined
  const nativeContent: Record<string, { id: number; content: string }> = {}
  for (const resource of journal.resources) {
    const value = await current.call(journal, 'read', resource.kind, resource.id)
    const observed = parseInput(z.object({ id: z.number().int().nonnegative() }), value)
    if (observed.id !== resource.id) throw toolError('editor_fixture_ownership_conflict')
    if (resource.kind === 'actor') actor = parseInput(z.object({ id: z.number().int().positive(), capabilities: z.record(z.string(), z.boolean()) }), value)
    if (['styles', 'header', 'footer', 'navigation'].includes(resource.kind)) nativeContent[resource.kind] = parseInput(z.object({ id: z.number().int().positive(), content: z.string() }), value)
    if (resource.kind === 'page') page = parseInput(z.object({ id: z.number().int().positive(), content: z.string(), acf: z.string(), seoTitle: z.string(), seoDescription: z.string() }), value)
  }
  if (!actor || !page || capabilities.some((capability) => actor!.capabilities[capability] !== true) || forbiddenCapabilities.some((capability) => actor!.capabilities[capability] !== false)) throw toolError('editor_fixture_capabilities_invalid')
  return { schemaVersion: 1, definitionVersion: journal.definitionVersion, status: 'ready', provenance: dependencies.runner || current.owner.result?.provenance === 'fixture' ? 'fixture' : 'live', siteId: journal.siteId, fixtureId: journal.fixtureId,
    actor: { id: actor.id, login: `${journal.marker}-actor`, capabilities: actor.capabilities }, resources: journal.resources, page, nativeContent,
    browser: 'not_run', globalStyles: 'owned_fixture_storage_only', credentials: 'private_state_only' }
}
export async function prepareOwnedEditorFixture(value: unknown, dependencies: Dependencies = {}) {
  return safe(async () => {
    const input = parseInput(inputSchema, value)
    const initial = await context(input, dependencies)
    return withSiteLock(initial.statePath, async () => {
      const current = await context(input, dependencies)
      if (current.journal) return readState(current, current.journal, dependencies)
      const journal: Journal = { schemaVersion: 1, definitionVersion: 2, siteId: input.handle.siteId, fixtureId: input.fixtureId, scope: input.scope, themeSlug: current.owner.request.themeSlug,
        marker: `omqa_${input.fixtureId.replaceAll('-', '')}`, password: randomBytes(32).toString('base64url'), status: 'preparing', pending: null, resources: [] }
      parseInput(z.object({ ok: z.literal(true) }), await current.call(journal, 'preflight', 'role'))
      await writeJournal(current.filename, journal)
      for (const kind of kinds) {
        journal.pending = kind
        await writeJournal(current.filename, journal)
        try {
          const result = parseInput(z.object({ id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(), await current.call(journal, 'create', kind))
          if ((kind === 'role') !== (result.id === 0)) throw toolError('editor_fixture_invalid_id')
          journal.resources.push({ kind, id: result.id }); journal.pending = null
          await writeJournal(current.filename, journal)
        } catch {
          journal.status = 'reconciliation_required'
          try {
            const found = parseInput(z.object({ ids: z.array(z.number().int().nonnegative()).max(3) }), await current.call(journal, 'find', kind))
            if (found.ids.length === 1 && !journal.resources.some((resource) => resource.kind === kind)) journal.resources.push({ kind, id: found.ids[0]! })
          } catch {}
          await writeJournal(current.filename, journal)
          throw toolError('editor_fixture_reconciliation_required')
        }
      }
      journal.status = 'ready'
      const result = await readState(current, journal, dependencies)
      await writeJournal(current.filename, journal)
      return result
    })
  })
}
export async function readOwnedEditorFixture(value: unknown, dependencies: Dependencies = {}) {
  return safe(async () => {
    const input = parseInput(inputSchema, value); const initial = await context(input, dependencies)
    return withSiteLock(initial.statePath, async () => {
      const current = await context(input, dependencies)
      if (!current.journal) throw toolError('editor_fixture_not_ready')
      return readState(current, current.journal, dependencies)
    })
  })
}
export async function cleanupOwnedEditorFixture(value: unknown, dependencies: Dependencies = {}) {
  return safe(async () => {
    const input = parseInput(inputSchema, value); const initial = await context(input, dependencies)
    return withSiteLock(initial.statePath, async () => {
      const current = await context(input, dependencies); const journal = current.journal
      if (!journal || journal.status === 'cleaned') return { status: 'cleaned', browser: 'not_run' }
      if (journal.status !== 'ready') throw toolError('editor_fixture_reconciliation_required')
      for (const resource of [...journal.resources].reverse()) {
        parseInput(z.object({ deleted: z.literal(true) }), await current.call(journal, 'delete', resource.kind, resource.id))
        journal.resources = journal.resources.filter((item) => item.kind !== resource.kind)
        await writeJournal(current.filename, journal)
      }
      journal.status = 'cleaned'; journal.password = ''
      await writeJournal(current.filename, journal)
      return { status: 'cleaned', browser: 'not_run' }
    })
  })
}


async function main() {
  const { values } = parseArgs({ strict: true, options: { request: { type: 'string' }, output: { type: 'string' }, operation: { type: 'string' } } })
  if (!values.request || !values.output || !['prepare', 'read', 'cleanup'].includes(values.operation ?? '')) throw toolError('invalid_input')
  const filename = path.resolve(values.request)
  await assertRegularFile(filename)
  const request = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  let input: Input
  try {
    const stat = await request.stat()
    if (stat.size > 64 * 1024 || (stat.mode & 0o077) !== 0) throw toolError('invalid_input')
    input = parseInput(inputSchema, JSON.parse(await request.readFile('utf8')))
  } finally { await request.close() }
  const output = path.resolve(values.output)
  await assertSafeDirectory(path.dirname(output))
  const file = await fs.open(output, 'wx', 0o600)
  try {
    const operation = values.operation === 'prepare' ? prepareOwnedEditorFixture : values.operation === 'read' ? readOwnedEditorFixture : cleanupOwnedEditorFixture
    const report = await operation(input)
    await file.writeFile(JSON.stringify(report, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ status: report.status, siteId: input.handle.siteId, fixtureId: input.fixtureId }) + '\n')
  } finally { await file.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('{"status":"blocked","code":"editor_fixture_failed"}\n'); process.exitCode = 1 })
}
