import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory } from './paths.ts'
import { readRecord, withSiteLock } from './ownership.ts'
import { createWordPressStudioTools } from './tools.ts'
import type { CommandRunner } from './runner.ts'

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema,
  expectedFunctionsHash: hashSchema, expectedAssetsHash: hashSchema.nullable(),
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute) }).strict(),
}).strict()
const journalSchema = z.object({
  schemaVersion: z.literal(1), siteId: siteHandleSchema.shape.siteId, status: z.enum(['prepared', 'applied']),
  before: z.object({ functions: z.string(), assets: z.string().nullable() }),
  after: z.object({ functionsHash: hashSchema, assetsHash: hashSchema }),
}).strict()
const includeLine = "require_once __DIR__ . '/inc/assets.php';"
const assetSource = `<?php
defined('ABSPATH') || exit;
add_action('enqueue_block_assets', function () {
    $relative = 'assets/dist/tailwind.css';
    $file = get_theme_file_path($relative);
    if (!is_readable($file)) {
        return;
    }
    $version = hash_file('sha256', $file);
    if ($version === false) {
        return;
    }
    wp_enqueue_style('om-delivery-tailwind', get_theme_file_uri($relative), array(), $version);
}, 20);
`
const MAX_FILE_BYTES = 512 * 1024

type Input = z.infer<typeof inputSchema>
type Dependencies = { runner?: CommandRunner }

async function readFile(filename: string, nullable = false, maximumBytes = MAX_FILE_BYTES): Promise<Buffer | null> {
  try { await fs.lstat(filename) } catch (error) {
    if (nullable && error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  await assertRegularFile(filename)
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maximumBytes) throw toolError('theme_assets_input_limit')
    const buffer = Buffer.alloc(info.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!result.bytesRead) break
      offset += result.bytesRead
    }
    if (offset !== info.size) throw toolError('theme_assets_input_changed')
    return buffer.subarray(0, offset)
  } finally { await handle.close() }
}

async function writeAtomic(filename: string, contents: Buffer | string, exclusive = false) {
  await assertSafeDirectory(path.dirname(filename))
  await assertContainedPath(path.dirname(filename), filename)
  const temporary = path.join(path.dirname(filename), `.assets-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
    await assertContainedPath(path.dirname(filename), filename)
    if (exclusive) await fs.link(temporary, filename)
    else await fs.rename(temporary, filename)
  } finally { await fs.rm(temporary, { force: true }) }
}

async function inspect(input: Input, dependencies: Dependencies) {
  await createWordPressStudioTools(input.config, dependencies).status(input.scope, input.handle)
  const statePath = path.join(input.config.stateRoot, input.handle.siteId)
  const owner = await readRecord(statePath)
  const themePath = path.join(input.config.sitesRoot, input.handle.siteId, 'wp-content/themes', owner.request.themeSlug)
  await assertSafeDirectory(themePath)
  await assertSafeDirectory(path.join(themePath, 'inc'))
  const functionsPath = path.join(themePath, 'functions.php')
  const assetsPath = path.join(themePath, 'inc/assets.php')
  await assertContainedPath(themePath, functionsPath)
  await assertContainedPath(themePath, assetsPath)
  const functions = await readFile(functionsPath)
  const assets = await readFile(assetsPath, true)
  if (!functions || digest(functions) !== input.expectedFunctionsHash || (assets ? digest(assets) : null) !== input.expectedAssetsHash) throw toolError('theme_assets_conflict')
  let functionsText: string
  try { functionsText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(functions) } catch { throw toolError('theme_assets_php_format') }
  if (!functionsText.startsWith('<?php\n') && !functionsText.startsWith('<?php\r\n')) throw toolError('theme_assets_php_format')
  if (functionsText.includes('?>') || /\bdeclare\s*\(|\bnamespace\s/.test(functionsText)) throw toolError('theme_assets_php_format')
  const journalPath = path.join(statePath, 'theme-assets-journal.json')
  const journalBytes = await readFile(journalPath, true, 1024 * 1024)
  const journal = journalBytes ? parseInput(journalSchema, JSON.parse(journalBytes.toString())) : null
  if (journal && (journal.siteId !== input.handle.siteId || journal.status !== 'applied')) throw toolError('theme_assets_reconciliation_required')
  const opening = functionsText.startsWith('<?php\r\n') ? '<?php\r\n' : '<?php\n'
  const hasInclude = functionsText.startsWith(`${opening}${includeLine}\n`)
  if (assets) {
    if (!journal || digest(assets) !== journal.after.assetsHash || assets.toString() !== assetSource || !hasInclude || functionsText.split(includeLine).length !== 2) throw toolError('theme_assets_ownership_conflict')
  } else if (journal || functionsText.includes('inc/assets.php')) throw toolError('theme_assets_ownership_conflict')
  return { statePath, functionsPath, assetsPath, functions, assets, journalPath, owner, opening }
}

async function installWithinLock(input: Input, dependencies: Dependencies) {
  const statePath = path.join(input.config.stateRoot, input.handle.siteId)
  await assertSafeDirectory(path.join(statePath, 'operation.lock'))
  const current = await inspect(input, dependencies)
  if (current.assets) {
    const finalFunctions = await readFile(current.functionsPath)
    const finalAssets = await readFile(current.assetsPath)
    if (!finalFunctions || !finalAssets || digest(finalFunctions) !== input.expectedFunctionsHash || digest(finalAssets) !== input.expectedAssetsHash) throw toolError('theme_assets_conflict')
    return report(input, current.owner.result?.provenance, dependencies, finalFunctions, finalAssets, 'unchanged')
  }
  const functions = Buffer.concat([Buffer.from(`${current.opening}${includeLine}\n`), current.functions.subarray(Buffer.byteLength(current.opening))])
  const assets = Buffer.from(assetSource)
  if (functions.length > MAX_FILE_BYTES) throw toolError('theme_assets_input_limit')
  const journal = { schemaVersion: 1, siteId: input.handle.siteId, status: 'prepared',
    before: { functions: current.functions.toString('base64'), assets: null },
    after: { functionsHash: digest(functions), assetsHash: digest(assets) },
  }
  await writeAtomic(current.journalPath, JSON.stringify(journal, null, 2) + '\n')
  await writeAtomic(current.assetsPath, assets, true)
  const beforeCommit = await readFile(current.functionsPath)
  if (!beforeCommit || digest(beforeCommit) !== input.expectedFunctionsHash) throw toolError('theme_assets_conflict')
  await writeAtomic(current.functionsPath, functions)
  const confirmedFunctions = await readFile(current.functionsPath)
  const confirmedAssets = await readFile(current.assetsPath)
  if (!confirmedFunctions || !confirmedAssets || digest(confirmedFunctions) !== digest(functions) || digest(confirmedAssets) !== digest(assets)) throw toolError('theme_assets_write_unconfirmed')
  await writeAtomic(current.journalPath, JSON.stringify({ ...journal, status: 'applied' }, null, 2) + '\n')
  return report(input, current.owner.result?.provenance, dependencies, functions, assets, 'installed')
}

function report(input: Input, provenance: 'fixture' | 'live' | undefined, dependencies: Dependencies, functions: Buffer, assets: Buffer, action: 'installed' | 'unchanged') {
  return { schemaVersion: 1, status: 'passed', provenance: dependencies.runner || provenance === 'fixture' ? 'fixture' : 'local',
    siteId: input.handle.siteId, action,
    files: { 'functions.php': digest(functions), 'inc/assets.php': digest(assets) },
    cssPath: 'assets/dist/tailwind.css', hook: 'enqueue_block_assets', urlVersion: 'runtime_sha256',
    frontend: 'not_verified', editorIframe: 'not_verified', database: 'not_modified',
  }
}

async function safe<Result>(work: () => Promise<Result>): Promise<Result> {
  try { return await work() } catch (error) {
    const codes = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH', 'theme_assets_conflict', 'theme_assets_php_format', 'theme_assets_input_limit', 'theme_assets_input_changed', 'theme_assets_ownership_conflict', 'theme_assets_reconciliation_required', 'theme_assets_write_unconfirmed'])
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    throw toolError(codes.has(code) ? code : 'theme_assets_failed')
  }
}

export async function installThemeAssetsWithinLock(value: unknown, dependencies: Dependencies = {}) {
  return safe(async () => installWithinLock(parseInput(inputSchema, value), dependencies))
}

export async function installOwnedThemeAssets(value: unknown, dependencies: Dependencies = {}) {
  return safe(async () => {
    const input = parseInput(inputSchema, value)
    const current = await inspect(input, dependencies)
    return withSiteLock(current.statePath, () => installWithinLock(input, dependencies))
  })
}
