import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { z } from 'zod'

const absolutePath = z.string().refine(path.isAbsolute)
const scopeSchema = z.object({ tenantId: z.uuid(), organizationId: z.uuid(), projectId: z.uuid() }).strict()
const requestSchema = z.object({ scope: scopeSchema, handle: z.object({ siteId: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), fixtureId: z.uuid(), config: z.object({ sitesRoot: absolutePath, stateRoot: absolutePath, timeoutMs: z.number().int().positive().optional() }).strict() }).strict()
const configSchema = z.object({ operatorRoot: absolutePath, editorRequestFile: absolutePath, prepareThemeRequestFile: absolutePath, toolchainRoot: absolutePath, expectedPageTemplateHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict()
const resourceSchema = z.object({ kind: z.string(), id: z.number().int().nonnegative() })
const stateSchema = z.object({ status: z.literal('ready'), siteId: z.string(), fixtureId: z.uuid(), provenance: z.enum(['fixture', 'live']),
  actor: z.object({ id: z.number().int().positive(), login: z.string(), capabilities: z.record(z.string(), z.boolean()) }),
  resources: z.array(resourceSchema), page: z.object({ id: z.number().int().positive(), content: z.string(), acf: z.string(), seoTitle: z.string(), seoDescription: z.string() }),
  nativeContent: z.record(z.string(), z.object({ id: z.number().int().positive(), content: z.string() })),
})
export type WordPressEditorState = z.infer<typeof stateSchema>

async function privateJson(filename: string): Promise<unknown> {
  const stat = await fs.lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0) throw new Error('[internal] wordpress_private_input_required')
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { return JSON.parse(await file.readFile('utf8')) as unknown } finally { await file.close() }
}
async function run(args: string[]) {
  try { await promisify(execFile)(process.execPath, args, { timeout: 300_000, maxBuffer: 1024 * 1024, encoding: 'utf8' }) }
  catch { throw new Error('[internal] wordpress_operator_failed_check_private_state') }
}
export async function createWordPressBrowserFixture() {
  const configPath = process.env.OM_WP_EDITOR_CONFIG
  if (!configPath || !path.isAbsolute(configPath)) throw new Error('[internal] wordpress_fixture_configuration_required')
  const config = configSchema.parse(await privateJson(configPath))
  const original = requestSchema.parse(await privateJson(config.editorRequestFile))
  const input = { ...original, fixtureId: randomUUID() }
  const directory = await fs.mkdtemp(path.join(input.config.stateRoot, '.editor-browser-'))
  const requestFile = path.join(directory, 'request.json')
  await fs.writeFile(requestFile, JSON.stringify(input), { mode: 0o600, flag: 'wx' })
  const stateDirectory = path.join(input.config.stateRoot, input.handle.siteId)
  const owner = z.object({ result: z.object({ localUrl: z.url(), scope: scopeSchema, siteId: z.string(), themeSlug: z.string() }) }).parse(await privateJson(path.join(stateDirectory, 'record.json')))
  const siteUrl = new URL(owner.result.localUrl)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(siteUrl.hostname) || siteUrl.protocol !== 'http:' || siteUrl.username || siteUrl.password || siteUrl.pathname !== '/' || owner.result.siteId !== input.handle.siteId || JSON.stringify(owner.result.scope) !== JSON.stringify(input.scope)) throw new Error('[internal] wordpress_fixture_scope_mismatch')
  const operator = path.join(config.operatorRoot, 'dist/editor-fixtures.js')
  const packageInfo = JSON.parse(await fs.readFile(path.join(config.operatorRoot, 'package.json'), 'utf8')) as { name?: unknown }
  if (packageInfo.name !== '@open-mercato/delivery-wordpress') throw new Error('[internal] wordpress_operator_mismatch')
  let closing = false
  const active = new Set<Promise<void>>()
  const runOwned = async (args: string[], cleanup = false) => {
    if (closing && !cleanup) throw new Error('[internal] wordpress_fixture_closing')
    const pending = run(args)
    active.add(pending)
    try { await pending } finally { active.delete(pending) }
  }
  let sequence = 0
  let expectedPageTemplateHash = config.expectedPageTemplateHash
  const invoke = async (operation: 'prepare' | 'read' | 'cleanup') => {
    const output = path.join(directory, `${sequence++}-${operation}.json`)
    await runOwned([operator, '--request', requestFile, '--output', output, '--operation', operation], operation === 'cleanup')
    return privateJson(output)
  }
  const settle = async () => {
    closing = true
    await Promise.allSettled([...active])
  }
  const cleanup = async () => {
    await settle()
    const result = z.object({ status: z.literal('cleaned') }).parse(await invoke('cleanup'))
    await fs.rm(directory, { recursive: true })
    return result
  }
  const updateTheme = async (revision: string, phase: 'before' | 'after') => {
    const prepared = z.object({ designTokens: z.unknown().optional() }).passthrough().parse(await privateJson(config.prepareThemeRequestFile))
    const filename = path.join(input.config.sitesRoot, input.handle.siteId, 'wp-content/themes', owner.result.themeSlug, 'templates/page.html')
    let previous: Buffer | null = null
    try {
      const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const before = await file.stat()
        if (!before.isFile() || before.size > 128 * 1024) throw new Error('[internal] wordpress_template_input_limit')
        const buffer = Buffer.alloc(before.size + 1)
        let offset = 0
        while (offset < buffer.length) {
          const chunk = await file.read(buffer, offset, buffer.length - offset, offset)
          if (!chunk.bytesRead) break
          offset += chunk.bytesRead
        }
        previous = buffer.subarray(0, offset)
        const after = await file.stat()
        if (previous.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('[internal] wordpress_template_changed')
      } finally { await file.close() }
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    const previousHash = previous ? createHash('sha256').update(previous).digest('hex') : null
    if (previousHash !== expectedPageTemplateHash) throw new Error('[internal] wordpress_template_approval_mismatch')
    const classes = phase === 'after' ? 'p-8 gap-4' : 'p-8'
    const content = `<!-- wp:group {"tagName":"main","className":"${classes}","layout":{"type":"constrained"}} --><main class="wp-block-group ${classes}"><!-- wp:paragraph --><p>Local build revision ${revision}</p><!-- /wp:paragraph --><!-- wp:post-content /--></main><!-- /wp:group -->\n`
    const updateInput = { scope: input.scope, handle: input.handle, updateId: randomUUID(), changes: [{ path: 'templates/page.html', expectedHash: expectedPageTemplateHash, content }], ...(prepared.designTokens ? { designTokens: prepared.designTokens } : {}), config: { ...input.config, toolchainRoot: config.toolchainRoot, timeoutMs: 120_000 } }
    const updateFile = path.join(directory, `${sequence++}-update-request.json`)
    const output = path.join(directory, `${sequence++}-update-result.json`)
    await fs.writeFile(updateFile, JSON.stringify(updateInput), { mode: 0o600, flag: 'wx' })
    const bridge = "import{readFile,writeFile}from'node:fs/promises';import{pathToFileURL}from'node:url';const operator=await import(pathToFileURL(process.argv[1]).href);const input=JSON.parse(await readFile(process.argv[2],'utf8'));const result=await operator.updateOwnedTheme(input);await writeFile(process.argv[3],JSON.stringify(result),{mode:384,flag:'wx'});"
    await runOwned(['--input-type=module', '--eval', bridge, path.join(config.operatorRoot, 'dist/theme-update.js'), updateFile, output])
    const result = z.object({ status: z.literal('passed'), action: z.literal('updated'), cssHash: z.string(), files: z.array(z.object({ path: z.string(), sha256: z.string() })) }).parse(await privateJson(output))
    expectedPageTemplateHash = createHash('sha256').update(content).digest('hex')
    return result
  }
  const prepare = async () => {
    const report = stateSchema.parse(await invoke('prepare'))
    const journal = z.object({ password: z.string(), marker: z.string() }).parse(await privateJson(path.join(stateDirectory, `editor-fixture-${input.fixtureId}.json`)))
    if (report.actor.login !== `${journal.marker}-actor`) throw new Error('[internal] wordpress_actor_mismatch')
    return { report, credentials: { login: report.actor.login, password: journal.password } }
  }
  return { input, siteUrl: siteUrl.origin, prepare, read: async () => stateSchema.parse(await invoke('read')), updateTheme, settle, cleanup }
}
