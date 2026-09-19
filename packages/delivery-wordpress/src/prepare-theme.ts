import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { designTokenExportSchema } from './design-tokens.ts'
import { readRecord, withSiteLock } from './ownership.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory } from './paths.ts'
import { createWordPressStudioTools } from './tools.ts'
import { buildThemeWithinLock } from './theme-build.ts'
import { applyThemeDesignWithinLock } from './theme-design-apply.ts'
import { installThemeAssetsWithinLock } from './theme-assets.ts'
import type { CommandRunner } from './runner.ts'

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema,
  expectedThemeJsonHash: hashSchema, expectedFunctionsHash: hashSchema, expectedAssetsHash: hashSchema.nullable(),
  designTokens: designTokenExportSchema,
  config: z.object({
    sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute),
    toolchainRoot: z.string().refine(path.isAbsolute), timeoutMs: z.number().int().min(1).max(120_000).optional(),
  }).strict(),
}).strict()

async function fileHash(filename: string) {
  await assertRegularFile(filename)
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > 2 * 1024 * 1024) throw toolError('theme_input_limit')
    const buffer = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const read = await file.read(buffer, offset, buffer.length - offset, offset)
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    const after = await file.stat()
    if (offset !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw toolError('theme_prepare_conflict')
    return digest(buffer.subarray(0, offset))
  } finally { await file.close() }
}

async function prepare(value: unknown, dependencies: { runner?: CommandRunner }) {
  const input = parseInput(inputSchema, value)
  const { scope, handle, config, designTokens } = input
  const roots = { sitesRoot: config.sitesRoot, stateRoot: config.stateRoot }
  const tools = createWordPressStudioTools(roots, dependencies)
  await tools.status(scope, handle)
  const statePath = path.join(config.stateRoot, handle.siteId)
  return withSiteLock(statePath, async () => {
    await tools.status(scope, handle)
    const owner = await readRecord(statePath)
    const themePath = path.join(config.sitesRoot, handle.siteId, 'wp-content/themes', owner.request.themeSlug)
    const executionId = randomUUID()
    const journalPath = path.join(statePath, `prepare-${executionId}.json`)
    await assertContainedPath(statePath, journalPath)
    const journal = { schemaVersion: 1, executionId, siteId: handle.siteId, scope,
      status: 'preparing', step: 'preflight', expected: { theme: input.expectedThemeJsonHash, functions: input.expectedFunctionsHash, assets: input.expectedAssetsHash },
      designHash: digest(JSON.stringify(designTokens)), startedAt: new Date().toISOString() }
    const persist = async () => {
      const temporary = path.join(statePath, `prepare-${executionId}-${randomUUID()}.tmp`)
      try {
        await fs.writeFile(temporary, JSON.stringify(journal, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
        await assertContainedPath(statePath, journalPath)
        await fs.rename(temporary, journalPath)
      } finally { await fs.rm(temporary, { force: true }) }
    }
    await persist()
    try {
      if (await fileHash(path.join(themePath, 'theme.json')) !== input.expectedThemeJsonHash ||
          await fileHash(path.join(themePath, 'functions.php')) !== input.expectedFunctionsHash) throw toolError('theme_prepare_conflict')
      const assets = path.join(themePath, 'inc/assets.php')
      await assertContainedPath(themePath, assets)
      if (input.expectedAssetsHash === null) {
        try { await fs.lstat(assets); throw toolError('theme_prepare_conflict') } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
        }
      } else if (await fileHash(assets) !== input.expectedAssetsHash) throw toolError('theme_prepare_conflict')
      journal.step = 'design'; await persist()
      const design = await applyThemeDesignWithinLock({ scope, handle, config: roots, designTokens, expectedThemeJsonHash: input.expectedThemeJsonHash }, dependencies)
      journal.step = 'assets'; await persist()
      const enqueue = await installThemeAssetsWithinLock({ scope, handle, config: roots, expectedFunctionsHash: input.expectedFunctionsHash, expectedAssetsHash: input.expectedAssetsHash }, dependencies)
      journal.step = 'build'; await persist()
      const build = await buildThemeWithinLock({ scope, handle, config: { ...config, designTokens } }, dependencies)
      journal.step = 'verify'; await persist()
      await tools.status(scope, handle)
      if (await fileHash(path.join(themePath, build.output.path)) !== build.output.sha256 ||
          await fileHash(path.join(themePath, 'theme.json')) !== design.afterHash) throw toolError('theme_prepare_conflict')
      for (const [relative, expected] of Object.entries(enqueue.files)) {
        if (await fileHash(path.join(themePath, relative)) !== expected) throw toolError('theme_prepare_conflict')
      }
      journal.status = 'prepared'; journal.step = 'complete'; await persist()
      return { schemaVersion: 1, status: 'passed', provenance: build.provenance, executionId,
        siteId: handle.siteId, scope, design, enqueue, build,
        database: 'not_modified', preview: 'not_published', browserFrontend: 'not_run', browserEditor: 'not_run' }
    } catch {
      journal.status = 'reconciliation_required'
      await persist()
      throw toolError('theme_prepare_reconciliation_required')
    }
  })
}

export async function prepareOwnedTheme(value: unknown, dependencies: { runner?: CommandRunner } = {}) {
  try { return await prepare(value, dependencies) } catch (error) {
    const known = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH', 'theme_prepare_reconciliation_required'])
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    throw toolError(known.has(code) ? code : 'theme_prepare_failed')
  }
}

async function main() {
  const { values } = parseArgs({ strict: true, options: { request: { type: 'string' }, output: { type: 'string' } } })
  if (!values.request || !values.output) throw toolError('invalid_input')
  const requestPath = path.resolve(values.request)
  await assertRegularFile(requestPath)
  const metadata = await fs.stat(requestPath)
  if (metadata.size > 128 * 1024 || (metadata.mode & 0o077) !== 0) throw toolError('invalid_input')
  const request: unknown = JSON.parse(await fs.readFile(requestPath, 'utf8'))
  const output = path.resolve(values.output)
  await assertSafeDirectory(path.dirname(output))
  const file = await fs.open(output, 'wx', 0o600)
  try {
    const report = await prepareOwnedTheme(request)
    await file.writeFile(JSON.stringify(report, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ status: report.status, siteId: report.siteId, executionId: report.executionId }) + '\n')
  } finally { await file.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('{"status":"blocked","code":"theme_prepare_failed"}\n'); process.exitCode = 1 })
}
