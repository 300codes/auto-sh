import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { createSiteRequestSchema, parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { mapDesignTokens } from './design-tokens.ts'
import { readRecord, withSiteLock } from './ownership.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory } from './paths.ts'
import type { CommandRunner } from './runner.ts'
import { createWordPressStudioTools } from './tools.ts'

const MAX_THEME_BYTES = 256 * 1024
const JOURNAL = 'theme-design-journal.json'
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const inputSchema = z.object({
  scope: scopeSchema,
  handle: siteHandleSchema,
  expectedThemeJsonHash: hashSchema,
  designTokens: z.unknown(),
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute) }).strict(),
}).strict()
const jsonSchema = z.json()
type Json = z.infer<typeof jsonSchema>
type JsonObject = { [key: string]: Json }
const presetIdentity = { slug: z.string().regex(/^design-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/), name: z.string().max(80) }
const managedSchema = z.object({
  palette: z.array(z.object({ ...presetIdentity, color: z.string().max(32) }).strict()).max(128),
  fontFamilies: z.array(z.object({ ...presetIdentity, fontFamily: z.string().max(800) }).strict()).max(32),
  fontSizes: z.array(z.object({ ...presetIdentity, size: z.string().max(24) }).strict()).max(64),
  spacingSizes: z.array(z.object({ ...presetIdentity, size: z.string().max(24) }).strict()).max(64),
}).strict()
type Managed = z.infer<typeof managedSchema>
const journalSchema = z.object({
  schemaVersion: z.literal(1), siteId: siteHandleSchema.shape.siteId, themeSlug: createSiteRequestSchema.shape.themeSlug,
  status: z.enum(['prepared', 'applied']), beforeHash: hashSchema, afterHash: hashSchema,
  inputHash: hashSchema, artifactsHash: hashSchema,
  previousManaged: managedSchema, managed: managedSchema,
  beforeThemeJson: z.string().max(MAX_THEME_BYTES),
}).strict()
type Journal = z.infer<typeof journalSchema>
type Dependencies = { runner?: CommandRunner }
const emptyManaged = (): Managed => ({ palette: [], fontFamilies: [], fontSizes: [], spacingSizes: [] })
const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
const object = (value: Json | undefined): JsonObject => {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw toolError('theme_design_format_conflict')
  return value
}
const canonical = (value: Json): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key]!)).join(',') + '}'
  return JSON.stringify(value)
}

async function readBounded(filename: string, limit: number) {
  await assertRegularFile(filename)
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > limit) throw toolError('theme_design_input_limit')
    const buffer = Buffer.alloc(info.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const chunk = await file.read(buffer, offset, buffer.length - offset, offset)
      if (!chunk.bytesRead) break
      offset += chunk.bytesRead
    }
    if (offset !== info.size) throw toolError('theme_design_input_changed')
    return buffer.subarray(0, offset)
  } finally { await file.close() }
}

async function readJournal(statePath: string, siteId: string, themeSlug: string): Promise<Journal | undefined> {
  const filename = path.join(statePath, JOURNAL)
  await assertContainedPath(statePath, filename)
  try { await fs.lstat(filename) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  const bytes = await readBounded(filename, 1024 * 1024)
  let journal: Journal
  try { journal = journalSchema.parse(JSON.parse(bytes.toString('utf8'))) } catch { throw toolError('theme_design_journal_invalid') }
  if (journal.siteId !== siteId || journal.themeSlug !== themeSlug || hash(journal.beforeThemeJson) !== journal.beforeHash) throw toolError('theme_design_journal_invalid')
  for (const set of [journal.managed, journal.previousManaged]) {
    for (const presets of Object.values(set)) if (new Set(presets.map((preset) => preset.slug)).size !== presets.length) throw toolError('theme_design_journal_invalid')
  }
  if (journal.status !== 'applied') throw toolError('theme_design_reconciliation_required')
  return journal
}

function mergePresets(current: Json | undefined, previous: JsonObject[], desired: JsonObject[]): Json[] {
  if (current !== undefined && !Array.isArray(current)) throw toolError('theme_design_format_conflict')
  const entries = (current ?? []) as Json[]
  const indexed = new Map<string, JsonObject>()
  for (const entry of entries) {
    const preset = object(entry)
    if (typeof preset.slug !== 'string' || !preset.slug || indexed.has(preset.slug)) throw toolError('theme_design_format_conflict')
    indexed.set(preset.slug, preset)
  }
  const owned = new Map(previous.map((entry) => [entry.slug, entry]))
  for (const [slug, preset] of owned) {
    const actual = indexed.get(String(slug))
    if (!actual || canonical(actual) !== canonical(preset)) throw toolError('theme_design_managed_conflict')
  }
  for (const preset of desired) {
    if (indexed.has(String(preset.slug)) && !owned.has(preset.slug)) throw toolError('theme_design_slug_conflict')
  }
  const replacements = new Map(desired.map((entry) => [entry.slug, entry]))
  const merged: Json[] = []
  for (const entry of entries) {
    const slug = object(entry).slug
    if (!owned.has(slug)) merged.push(entry)
    else if (replacements.has(slug)) merged.push(replacements.get(slug)!)
    replacements.delete(slug)
  }
  return [...merged, ...replacements.values()]
}

function mergeTheme(document: JsonObject, previous: Managed, desired: Managed) {
  if (document.version !== 3) throw toolError('theme_design_format_conflict')
  const settings = object(document.settings)
  const color = object(settings.color)
  const typography = object(settings.typography)
  const spacing = object(settings.spacing)
  return {
    ...document,
    settings: {
      ...settings,
      color: { ...color, palette: mergePresets(color.palette, previous.palette, desired.palette) },
      typography: {
        ...typography,
        fontFamilies: mergePresets(typography.fontFamilies, previous.fontFamilies, desired.fontFamilies),
        fontSizes: mergePresets(typography.fontSizes, previous.fontSizes, desired.fontSizes),
      },
      spacing: { ...spacing, spacingSizes: mergePresets(spacing.spacingSizes, previous.spacingSizes, desired.spacingSizes) },
    },
  }
}

async function atomicWrite(root: string, filename: string, content: string) {
  await assertContainedPath(root, filename)
  const temporary = path.join(path.dirname(filename), `.theme-design-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    await assertContainedPath(root, filename)
    await fs.rename(temporary, filename)
  } finally { await fs.rm(temporary, { force: true }) }
}

async function apply(value: unknown, dependencies: Dependencies) {
  const input = parseInput(inputSchema, value)
  const design = mapDesignTokens(input.designTokens)
  const tools = createWordPressStudioTools(input.config, dependencies)
  await tools.status(input.scope, input.handle)
  const statePath = path.join(input.config.stateRoot, input.handle.siteId)
  await assertSafeDirectory(path.join(statePath, 'operation.lock'))
  if ((await fs.stat(statePath)).mode & 0o077) throw toolError('UNSAFE_PATH')
  const owner = await readRecord(statePath)
  const themePath = path.join(input.config.sitesRoot, input.handle.siteId, 'wp-content', 'themes', owner.request.themeSlug)
  await assertSafeDirectory(themePath)
  const filename = path.join(themePath, 'theme.json')
  const bytes = await readBounded(filename, MAX_THEME_BYTES)
  const beforeHash = hash(bytes)
  if (beforeHash !== input.expectedThemeJsonHash) throw toolError('theme_design_hash_conflict')
  let source: string
  let document: JsonObject
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    document = object(jsonSchema.parse(JSON.parse(source)))
  } catch { throw toolError('theme_design_format_conflict') }
  const previous = await readJournal(statePath, input.handle.siteId, owner.request.themeSlug)
  const fragment = design.themeJsonFragment.settings
  const managed: Managed = {
    palette: fragment.color.palette, fontFamilies: fragment.typography.fontFamilies,
    fontSizes: fragment.typography.fontSizes, spacingSizes: fragment.spacing.spacingSizes,
  }
  const merged = mergeTheme(document, previous?.managed ?? emptyManaged(), managed)
  const unchanged = canonical(document) === canonical(merged)
  const output = unchanged ? source : JSON.stringify(merged, null, 2) + '\n'
  if (Buffer.byteLength(output) > MAX_THEME_BYTES) throw toolError('theme_design_input_limit')
  const afterHash = hash(output)
  const journal: Journal = {
    schemaVersion: 1, siteId: input.handle.siteId, themeSlug: owner.request.themeSlug, status: 'prepared',
    beforeHash, afterHash, inputHash: design.inputHash, artifactsHash: design.artifactsHash,
    previousManaged: previous?.managed ?? emptyManaged(), managed, beforeThemeJson: source,
  }
  const journalPath = path.join(statePath, JOURNAL)
  if (!unchanged || previous?.inputHash !== design.inputHash || previous?.artifactsHash !== design.artifactsHash || previous?.afterHash !== afterHash) {
    await atomicWrite(statePath, journalPath, JSON.stringify(journal) + '\n')
    if (hash(await readBounded(filename, MAX_THEME_BYTES)) !== beforeHash) throw toolError('theme_design_hash_conflict')
    if (!unchanged) await atomicWrite(themePath, filename, output)
    if (hash(await readBounded(filename, MAX_THEME_BYTES)) !== afterHash) throw toolError('theme_design_write_unconfirmed')
    journal.status = 'applied'
    await atomicWrite(statePath, journalPath, JSON.stringify(journal) + '\n')
  }
  if (hash(await readBounded(filename, MAX_THEME_BYTES)) !== afterHash) throw toolError('theme_design_write_unconfirmed')
  return {
    schemaVersion: 1 as const, status: 'passed' as const, action: unchanged ? 'unchanged' as const : 'applied' as const,
    provenance: dependencies.runner || owner.result?.provenance === 'fixture' || design.provenance === 'fixture' ? 'fixture' as const : 'local' as const,
    siteId: input.handle.siteId, beforeHash, afterHash, inputHash: design.inputHash, artifactsHash: design.artifactsHash,
    approvalVerification: design.approvalVerification, managedPresetCount: Object.values(managed).reduce((sum, entries) => sum + entries.length, 0),
    journalRevisionHash: hash(await readBounded(journalPath, 1024 * 1024)), database: 'not_modified' as const,
  }
}

function safeError(error: unknown): Error {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
  const known = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH',
    'theme_design_format_conflict', 'theme_design_input_limit', 'theme_design_input_changed', 'theme_design_journal_invalid', 'theme_design_reconciliation_required',
    'theme_design_managed_conflict', 'theme_design_slug_conflict', 'theme_design_hash_conflict', 'theme_design_write_unconfirmed'])
  return toolError(known.has(code) ? code : 'theme_design_apply_failed')
}

export async function applyThemeDesignWithinLock(value: unknown, dependencies: Dependencies = {}) {
  try { return await apply(value, dependencies) } catch (error) { throw safeError(error) }
}

export async function applyOwnedThemeDesign(value: unknown, dependencies: Dependencies = {}) {
  try {
    const input = parseInput(inputSchema, value)
    const tools = createWordPressStudioTools(input.config, dependencies)
    await tools.status(input.scope, input.handle)
    return await withSiteLock(path.join(input.config.stateRoot, input.handle.siteId), () => applyThemeDesignWithinLock(input, dependencies))
  } catch (error) { throw safeError(error) }
}

export type ThemeDesignApplyReport = Awaited<ReturnType<typeof applyOwnedThemeDesign>>
