import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { designTokenExportSchema, mapDesignTokens } from './design-tokens.ts'
import { readRecord, withSiteLock } from './ownership.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory } from './paths.ts'
import { createWordPressStudioTools } from './tools.ts'
import { buildThemeWithinLock } from './theme-build.ts'
import type { CommandRunner } from './runner.ts'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const managedPath = z.string().max(180).refine((value) => !/[\x00-\x1f\x7f]/.test(value)).regex(/^(?:(?:templates|parts)\/(?:[a-z][a-z0-9-]*\/){0,3}[a-z][a-z0-9-]*\.html|assets\/(?:css\/(?:[a-z][a-z0-9-]*\/){0,3}[a-z][a-z0-9-]*\.css|js\/(?:[a-z][a-z0-9-]*\/){0,3}[a-z][a-z0-9-]*\.js))$/)
const changeSchema = z.object({ path: managedPath, expectedHash: hashSchema.nullable(), content: z.string().max(128 * 1024) }).strict()
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema, updateId: z.uuid(), changes: z.array(changeSchema).min(1).max(32).refine((changes) => new Set(changes.map((change) => change.path)).size === changes.length),
  designTokens: designTokenExportSchema.optional(),
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute), toolchainRoot: z.string().refine(path.isAbsolute), timeoutMs: z.number().int().min(1).max(120_000).optional() }).strict(),
}).strict()
const journalSchema = z.object({
  schemaVersion: z.literal(1), siteId: siteHandleSchema.shape.siteId, requestHash: hashSchema,
  status: z.enum(['prepared', 'applied']),
  files: z.array(z.object({ path: managedPath, before: z.string().nullable(), beforeHash: hashSchema.nullable(), afterHash: hashSchema }).strict()).min(1).max(32),
  cssHash: hashSchema.optional(),
}).strict()
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const MAX_BYTES = 1024 * 1024

async function read(filename: string, nullable = false, maximum = MAX_BYTES): Promise<Buffer | null> {
  try { await fs.lstat(filename) } catch (error) {
    if (nullable && error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  await assertRegularFile(filename)
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maximum) throw toolError('theme_update_limit')
    const buffer = Buffer.alloc(info.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!result.bytesRead) break
      offset += result.bytesRead
    }
    if (offset !== info.size) throw toolError('theme_update_input_changed')
    return buffer.subarray(0, offset)
  } finally { await handle.close() }
}

async function write(root: string, filename: string, content: string, exclusive = false) {
  await assertContainedPath(root, filename)
  await assertSafeDirectory(path.dirname(filename))
  const temporary = path.join(path.dirname(filename), `.update-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    await assertContainedPath(root, filename)
    if (exclusive) await fs.link(temporary, filename)
    else await fs.rename(temporary, filename)
  } finally { await fs.rm(temporary, { force: true }) }
}

export async function updateOwnedTheme(value: unknown, dependencies: { runner?: CommandRunner } = {}) {
  try {
    const input = parseInput(inputSchema, value)
    if (input.changes.reduce((size, change) => size + Buffer.byteLength(change.content), 0) > MAX_BYTES) throw toolError('theme_update_limit')
    for (const change of input.changes) {
      if (Buffer.byteLength(change.content) > 128 * 1024) throw toolError('theme_update_limit')
      if (Buffer.from(change.content).toString() !== change.content) throw toolError('theme_update_encoding')
    }
    const tools = createWordPressStudioTools(input.config, dependencies)
    await tools.status(input.scope, input.handle)
    const statePath = path.join(input.config.stateRoot, input.handle.siteId)
    return await withSiteLock(statePath, async () => {
      await tools.status(input.scope, input.handle)
      const owner = await readRecord(statePath)
      const themePath = path.join(input.config.sitesRoot, input.handle.siteId, 'wp-content/themes', owner.request.themeSlug)
      await assertSafeDirectory(themePath)
      const designBytes = await read(path.join(statePath, 'theme-design-journal.json'), true)
      if (designBytes) {
        const design = parseInput(z.object({ schemaVersion: z.literal(1), siteId: siteHandleSchema.shape.siteId, themeSlug: z.string(), status: z.literal('applied'), inputHash: hashSchema, artifactsHash: hashSchema, afterHash: hashSchema }), JSON.parse(designBytes.toString()))
        const mapping = input.designTokens ? mapDesignTokens(input.designTokens) : null
        if (!mapping || design.siteId !== input.handle.siteId || design.themeSlug !== owner.request.themeSlug || design.inputHash !== mapping.inputHash || design.artifactsHash !== mapping.artifactsHash) throw toolError('theme_update_design_conflict')
        const themeJson = await read(path.join(themePath, 'theme.json'))
        if (!themeJson || digest(themeJson) !== design.afterHash) throw toolError('theme_update_design_conflict')
      } else if (input.designTokens) throw toolError('theme_update_design_conflict')
      const journalPath = path.join(statePath, `theme-update-${input.updateId}.json`)
      await assertContainedPath(statePath, journalPath)
      const requestHash = digest(JSON.stringify(input))
      const previousBytes = await read(journalPath, true, 2 * MAX_BYTES)
      const previous = previousBytes ? parseInput(journalSchema, JSON.parse(previousBytes.toString())) : null
      if (previous) {
        if (previous.siteId !== input.handle.siteId || previous.requestHash !== requestHash) throw toolError('theme_update_idempotency_conflict')
        if (previous.status !== 'applied' || !previous.cssHash) throw toolError('theme_update_reconciliation_required')
        for (const changed of previous.files) {
          const current = await read(path.join(themePath, changed.path))
          if (!current || digest(current) !== changed.afterHash) throw toolError('theme_update_conflict')
        }
        const css = await read(path.join(themePath, 'assets/dist/tailwind.css'), false, 2 * MAX_BYTES)
        if (!css || digest(css) !== previous.cssHash) throw toolError('theme_update_conflict')
        return { schemaVersion: 1, status: 'passed', action: 'unchanged', provenance: dependencies.runner || owner.result?.provenance === 'fixture' || input.designTokens?.provenance === 'fixture' ? 'fixture' : 'local', siteId: input.handle.siteId, updateId: input.updateId, files: previous.files.map(({ path: filename, afterHash }) => ({ path: filename, sha256: afterHash })), cssHash: previous.cssHash, database: 'not_modified', retention: 'not_verified', browser: 'not_run' }
      }
      const files: z.infer<typeof journalSchema>['files'] = []
      let beforeBytes = 0
      for (const change of input.changes) {
        const filename = path.join(themePath, change.path)
        await assertContainedPath(themePath, filename)
        await assertSafeDirectory(path.dirname(filename))
        const current = await read(filename, true, 128 * 1024)
        const beforeHash = current ? digest(current) : null
        if (beforeHash !== change.expectedHash) throw toolError('theme_update_conflict')
        beforeBytes += current?.length ?? 0
        if (beforeBytes > MAX_BYTES) throw toolError('theme_update_limit')
        files.push({ path: change.path, before: current?.toString('base64') ?? null, beforeHash, afterHash: digest(change.content) })
      }
      if (files.every((file) => file.beforeHash === file.afterHash)) throw toolError('theme_update_no_change')
      const journal: z.infer<typeof journalSchema> = { schemaVersion: 1, siteId: input.handle.siteId, requestHash, status: 'prepared', files }
      await write(statePath, journalPath, JSON.stringify(journal) + '\n', true)
      for (const change of input.changes) {
        const filename = path.join(themePath, change.path)
        const current = await read(filename, true, 128 * 1024)
        if ((current ? digest(current) : null) !== change.expectedHash) throw toolError('theme_update_conflict')
        await write(themePath, filename, change.content, change.expectedHash === null)
      }
      const build = await buildThemeWithinLock({ scope: input.scope, handle: input.handle, config: { ...input.config, ...(input.designTokens ? { designTokens: input.designTokens } : {}) } }, dependencies)
      for (const file of files) {
        const current = await read(path.join(themePath, file.path))
        if (!current || digest(current) !== file.afterHash) throw toolError('theme_update_write_unconfirmed')
      }
      const confirmedCss = await read(path.join(themePath, 'assets/dist/tailwind.css'), false, 2 * MAX_BYTES)
      if (!confirmedCss || digest(confirmedCss) !== build.output.sha256) throw toolError('theme_update_write_unconfirmed')
      journal.status = 'applied'; journal.cssHash = build.output.sha256
      await write(statePath, journalPath, JSON.stringify(journal) + '\n')
      return { schemaVersion: 1, status: 'passed', action: 'updated', provenance: build.provenance, siteId: input.handle.siteId, updateId: input.updateId, files: files.map(({ path: filename, afterHash }) => ({ path: filename, sha256: afterHash })), cssHash: build.output.sha256, build, database: 'not_modified', retention: 'not_verified', browser: 'not_run' }
    })
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    const known = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH', 'theme_update_limit', 'theme_update_design_conflict', 'theme_update_encoding', 'theme_update_input_changed', 'theme_update_conflict', 'theme_update_idempotency_conflict', 'theme_update_reconciliation_required', 'theme_update_no_change', 'theme_update_write_unconfirmed', 'theme_compile_failed'])
    throw toolError(known.has(code) ? code : 'theme_update_failed')
  }
}
