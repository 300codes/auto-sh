import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory } from './paths.ts'
import { readRecord, withSiteLock } from './ownership.ts'
import { createWordPressStudioTools } from './tools.ts'
import type { CommandRunner } from './runner.ts'
import { mapDesignTokens } from './design-tokens.ts'

const MAX_BYTES = 2 * 1024 * 1024
const OUTPUT = 'assets/dist/tailwind.css'
const PINNED_VERSION = '4.3.3'
const configSchema = z.object({
  sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute),
  toolchainRoot: z.string().refine(path.isAbsolute), designTokens: z.unknown().optional(),
  timeoutMs: z.number().int().min(1).max(120_000).default(60_000),
}).strict()
const inputSchema = z.object({ scope: scopeSchema, handle: siteHandleSchema, config: configSchema }).strict()
const sourceSchema = z.object({ path: z.string(), extension: z.enum(['php', 'html', 'js']), content: z.string() })
const workerSchema = z.object({ toolchainRoot: z.string(), sources: z.array(sourceSchema).max(256), designCss: z.string() }).strict()
const compiledSchema = z.object({ css: z.string().min(1).max(MAX_BYTES), candidateCount: z.number().int().nonnegative(),
  compiler: z.object({ version: z.literal(PINNED_VERSION), entryHash: z.string() }),
  scanner: z.object({ version: z.literal(PINNED_VERSION), entryHash: z.string() }), defaultThemeHash: z.string(),
}).strict()
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

async function readBounded(filename: string, limit = MAX_BYTES): Promise<Buffer> {
  await assertRegularFile(filename)
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > limit) throw toolError('theme_input_limit')
    const buffer = Buffer.alloc(info.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const chunk = await file.read(buffer, offset, buffer.length - offset, offset)
      if (!chunk.bytesRead) break
      offset += chunk.bytesRead
    }
    if (offset !== info.size) throw toolError('theme_input_changed')
    return buffer.subarray(0, offset)
  } finally { await file.close() }
}

async function inspectToolchain(root: string) {
  await assertSafeDirectory(root)
  const compiler = path.join(root, 'node_modules/tailwindcss')
  const scanner = path.join(root, 'node_modules/@tailwindcss/oxide')
  const packageSchema = z.object({ version: z.literal(PINNED_VERSION) })
  for (const directory of [compiler, scanner]) {
    parseInput(packageSchema, JSON.parse((await readBounded(path.join(directory, 'package.json'), 64 * 1024)).toString()))
  }
  const compilerFile = path.join(compiler, 'dist/lib.mjs')
  const scannerFile = path.join(scanner, 'index.js')
  const theme = await readBounded(path.join(compiler, 'theme.css'))
  return { compilerFile, scannerFile, theme: theme.toString(), compilerHash: hash(await readBounded(compilerFile)), scannerHash: hash(await readBounded(scannerFile)), themeHash: hash(theme) }
}

async function collectSources(themePath: string) {
  await assertSafeDirectory(themePath)
  const sources: z.infer<typeof sourceSchema>[] = []
  let bytes = 0
  let entries = 0
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 12) throw toolError('theme_input_limit')
    for (const name of (await fs.readdir(directory)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
      if (++entries > 2048) throw toolError('theme_input_limit')
      const filename = path.join(directory, name)
      const info = await fs.lstat(filename)
      if (info.isSymbolicLink()) throw toolError('UNSAFE_PATH')
      const relative = path.relative(themePath, filename).split(path.sep).join('/')
      if (['.git', 'node_modules'].includes(name) || relative === 'assets/dist') continue
      if (info.isDirectory()) { await visit(filename, depth + 1); continue }
      if (!info.isFile()) throw toolError('UNSAFE_PATH')
      const extension = path.extname(name).slice(1)
      if (extension !== 'php' && extension !== 'html' && extension !== 'js') continue
      const content = await readBounded(filename)
      bytes += content.length
      if (bytes > MAX_BYTES || sources.length >= 256) throw toolError('theme_input_limit')
      let decoded: string
      try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content) } catch { throw toolError('theme_source_encoding') }
      sources.push({ path: relative, extension, content: decoded })
    }
  }
  await visit(themePath, 0)
  if (!sources.length) throw toolError('theme_sources_missing')
  return sources
}

async function compileInWorker(input: z.infer<typeof workerSchema>, timeout: number) {
  return new Promise<z.infer<typeof compiledSchema>>((resolve, reject) => {
    const child = execFile(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--theme-build-worker'], {
      timeout, maxBuffer: 3 * MAX_BYTES, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    }, (error, stdout) => {
      if (error) { reject(toolError('theme_compile_failed')); return }
      try { resolve(parseInput(compiledSchema, JSON.parse(stdout))) } catch { reject(toolError('theme_compile_failed')) }
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(JSON.stringify(input))
  })
}

async function prepareBuild(value: unknown, dependencies: { runner?: CommandRunner }) {
    const { scope, handle, config } = parseInput(inputSchema, value)
    const tools = createWordPressStudioTools(config, dependencies)
    await tools.status(scope, handle)
    const statePath = path.join(config.stateRoot, handle.siteId)
    const owner = await readRecord(statePath)
    const themePath = path.join(config.sitesRoot, handle.siteId, 'wp-content/themes', owner.request.themeSlug)
    const toolchainRelative = path.relative(config.sitesRoot, config.toolchainRoot)
    if (toolchainRelative === '' || (!toolchainRelative.startsWith(`..${path.sep}`) && toolchainRelative !== '..' && !path.isAbsolute(toolchainRelative))) throw toolError('theme_toolchain_in_served_root')
    const design = config.designTokens === undefined ? undefined : mapDesignTokens(config.designTokens)
    await inspectToolchain(config.toolchainRoot)
    await collectSources(themePath)
    await assertContainedPath(themePath, path.join(themePath, OUTPUT))
    return { scope, handle, config, tools, statePath, owner, themePath, design }
}

export async function buildThemeWithinLock(value: unknown, dependencies: { runner?: CommandRunner } = {}) {
  try {
    const { scope, handle, config, tools, statePath, owner, themePath, design } = await prepareBuild(value, dependencies)
    await assertSafeDirectory(path.join(statePath, 'operation.lock'))
      await tools.status(scope, handle)
      const sources = await collectSources(themePath)
      const compiled = await compileInWorker({ toolchainRoot: config.toolchainRoot, sources, designCss: design?.tailwindCss ?? '' }, config.timeoutMs)
      const output = path.join(themePath, OUTPUT)
      await assertContainedPath(themePath, output)
      await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
      await assertSafeDirectory(path.dirname(output))
      const temporary = path.join(path.dirname(output), `.tailwind-${randomUUID()}.tmp`)
      try {
        await fs.writeFile(temporary, compiled.css, { flag: 'wx', mode: 0o600 })
        await assertContainedPath(themePath, output)
        await fs.rename(temporary, output)
      } finally { await fs.rm(temporary, { force: true }) }
      return {
        schemaVersion: 1, status: 'passed', provenance: dependencies.runner || owner.result?.provenance === 'fixture' || design?.provenance === 'fixture' ? 'fixture' : 'local',
        siteId: handle.siteId, scope, compilation: 'real_local_tailwind', sourceHash: hash(JSON.stringify(sources)),
        sources: sources.map((source) => ({ path: source.path, sha256: hash(source.content) })),
        output: { path: OUTPUT, sha256: hash(compiled.css), sizeBytes: Buffer.byteLength(compiled.css) },
        toolchain: { compiler: compiled.compiler, scanner: compiled.scanner, defaultThemeHash: compiled.defaultThemeHash },
        candidateCount: compiled.candidateCount, preflight: 'excluded',
        ...(design ? { design: { provenance: design.provenance, approvalVerification: design.approvalVerification, inputHash: design.inputHash, artifactsHash: design.artifactsHash } } : {}),
        enqueue: 'not_run', browserEditor: 'not_run', preview: 'not_published', database: 'not_modified',
      }
  } catch (error) {
    const allowed = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH', 'theme_input_limit', 'theme_input_changed', 'theme_source_encoding', 'theme_sources_missing', 'theme_compile_failed', 'theme_toolchain_in_served_root'])
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    throw toolError(allowed.has(code) ? code : 'theme_build_failed')
  }
}


export async function buildOwnedTheme(value: unknown, dependencies: { runner?: CommandRunner } = {}) {
  try {
    const { statePath } = await prepareBuild(value, dependencies)
    return await withSiteLock(statePath, () => buildThemeWithinLock(value, dependencies))
  } catch (error) {
    const allowed = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH', 'theme_input_limit', 'theme_input_changed', 'theme_source_encoding', 'theme_sources_missing', 'theme_compile_failed', 'theme_toolchain_in_served_root'])
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    throw toolError(allowed.has(code) ? code : 'theme_build_failed')
  }
}

async function worker() {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += bytes.length
    if (size > 3 * MAX_BYTES) throw toolError('theme_input_limit')
    chunks.push(bytes)
  }
  const input = parseInput(workerSchema, JSON.parse(Buffer.concat(chunks).toString()))
  const files = await inspectToolchain(input.toolchainRoot)
  const compiler: unknown = await import(pathToFileURL(files.compilerFile).href)
  const scanner: unknown = await import(pathToFileURL(files.scannerFile).href)
  const compile = z.object({ compile: z.custom<(css: string, options: { loadModule: () => never; loadStylesheet: () => never }) => Promise<{ build: (candidates: string[]) => string }>>((value) => typeof value === 'function') }).parse(compiler).compile
  const Scanner = z.object({ Scanner: z.custom<new(options: { sources: [] }) => { scanFiles: (sources: { content: string; extension: string }[]) => string[] }>((value) => typeof value === 'function') }).parse(scanner).Scanner
  const denied = (): never => { throw toolError('theme_external_load_forbidden') }
  const candidates = new Scanner({ sources: [] }).scanFiles(input.sources.map(({ content, extension }) => ({ content, extension }))).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  const result = await compile(`${files.theme}\n${input.designCss}\n@tailwind utilities;`, { loadModule: denied, loadStylesheet: denied })
  const css = result.build(candidates)
  process.stdout.write(JSON.stringify(parseInput(compiledSchema, { css, candidateCount: candidates.length, compiler: { version: PINNED_VERSION, entryHash: files.compilerHash }, scanner: { version: PINNED_VERSION, entryHash: files.scannerHash }, defaultThemeHash: files.themeHash })))
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--theme-build-worker') { await worker(); return }
  const { values } = parseArgs({ strict: true, options: { request: { type: 'string' }, output: { type: 'string' } } })
  if (!values.request || !values.output) throw toolError('invalid_input')
  const request = JSON.parse((await readBounded(path.resolve(values.request), 128 * 1024)).toString()) as unknown
  const reportPath = path.resolve(values.output)
  await assertSafeDirectory(path.dirname(reportPath))
  const file = await fs.open(reportPath, 'wx', 0o600)
  try {
    const report = await buildOwnedTheme(request)
    await file.writeFile(JSON.stringify(report, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ status: report.status, siteId: report.siteId, sha256: report.output.sha256 }) + '\n')
  } finally { await file.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('{"status":"blocked","code":"theme_build_failed"}\n'); process.exitCode = 1 })
}
