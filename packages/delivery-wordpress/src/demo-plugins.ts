import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, toolError, type Scope, type SiteHandle } from './contracts.ts'
import { assertRegularFile, assertSafeDirectory } from './paths.ts'
import { withSiteLock } from './ownership.ts'
import { createCommandRunner, parseStudioJson, type CommandRunner } from './runner.ts'
import { createWordPressStudioTools } from './tools.ts'

const slugs = ['advanced-custom-fields-pro', 'polylang', 'wordpress-seo'] as const
const versionSchema = z.string().regex(/^[0-9][A-Za-z0-9._+-]{0,63}$/)
const archiveSchema = z.object({ slug: z.enum(slugs), version: versionSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), archivePath: z.string().refine(path.isAbsolute) }).strict()
export const demoPluginsConfigSchema = z.object({
  sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute),
  plugins: z.array(archiveSchema).length(3).refine((plugins) => slugs.every((slug) => plugins.filter((plugin) => plugin.slug === slug).length === 1)),
  timeoutMs: z.number().int().min(1).max(600_000).optional(),
}).strict()
export type DemoPluginsConfig = z.infer<typeof demoPluginsConfigSchema>
export type DemoPluginsReport = {
  schemaVersion: 1; provenance: 'live' | 'fixture'; siteId: string
  plugins: Array<{ slug: typeof slugs[number]; version: string; sha256: string; status: 'active'; action: 'installed' | 'activated' | 'unchanged' }>
  noindex: true; noindexChanged: boolean
}
const inventorySchema = z.array(z.object({ name: z.string(), status: z.string(), version: z.string() }))
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function within(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}



export function archiveHttpPolicyPhp(url: string): string {
  const match = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/[a-f0-9]{64}\/(advanced-custom-fields-pro|polylang|wordpress-seo)\.zip$/.exec(url)
  const port = Number(match?.[1])
  if (!match || port < 1 || port > 65535) throw toolError('archive_transport_url_invalid')
  return `WP_CLI::add_hook('after_wp_load', static function() { $om_archive_url = '${url}'; ` +
    `add_filter('http_request_host_is_external', static function($external, $host, $url) use ($om_archive_url) { return $url === $om_archive_url && $host === '127.0.0.1' ? true : $external; }, 10, 3); ` +
    `add_filter('http_allowed_safe_ports', static function($ports, $host, $url) use ($om_archive_url) { if ($url !== $om_archive_url || $host !== '127.0.0.1') return $ports; $ports[] = ${port}; return array_values(array_unique($ports)); }, 10, 3); ` +
    `add_filter('http_request_args', static function($args, $url) use ($om_archive_url) { if ($url === $om_archive_url) $args['redirection'] = 0; return $args; }, 10, 2); });`
}

async function withPrivateArchive<Value>(slug: string, bytes: Buffer, timeoutMs: number, install: (url: string) => Promise<Value>): Promise<Value> {
  const pathname = `/${randomBytes(32).toString('hex')}/${slug}.zip`
  let requests = 0
  let active = false
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Connection', 'close')
    if (request.method !== 'GET' || request.url !== pathname) {
      response.writeHead(404)
      response.end()
      return
    }
    if (active || requests >= 3) {
      response.writeHead(429)
      response.end()
      return
    }
    requests += 1
    active = true
    response.once('close', () => { active = false })
    response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff' })
    response.end(bytes)
  })
  server.maxConnections = 4
  server.headersTimeout = Math.min(timeoutMs, 10_000)
  server.requestTimeout = timeoutMs
  server.timeout = timeoutMs
  const close = () => new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
  let expired = false
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => reject(toolError('archive_transport_unavailable')))
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw toolError('archive_transport_unavailable')
    deadline = setTimeout(() => { expired = true; void close() }, timeoutMs)
    deadline.unref()
    const result = await install(`http://127.0.0.1:${address.port}${pathname}`)
    if (expired) throw toolError('archive_transport_expired')
    return result
  } finally {
    if (deadline) clearTimeout(deadline)
    await close()
  }
}

async function provision(scope: Scope, handle: SiteHandle, configValue: DemoPluginsConfig, dependencies: { runner?: CommandRunner } = {}): Promise<DemoPluginsReport> {
  const config = parseInput(demoPluginsConfigSchema, configValue)
  const runner = dependencies.runner ?? createCommandRunner({ timeoutMs: config.timeoutMs })
  const tools = createWordPressStudioTools(config, { runner })
  await tools.status(scope, handle)
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  const archives: Array<{ plugin: DemoPluginsConfig['plugins'][number]; bytes: Buffer }> = []
  try {
    for (const plugin of config.plugins) {
      if (within(config.sitesRoot, plugin.archivePath)) throw toolError('archive_inside_served_root')
      await assertRegularFile(plugin.archivePath)
      await assertSafeDirectory(path.dirname(plugin.archivePath))
      const info = await fs.stat(plugin.archivePath)
      const parent = await fs.stat(path.dirname(plugin.archivePath))
      if ((info.mode & 0o077) !== 0 || (parent.mode & 0o077) !== 0) throw toolError('archive_not_private')
      if (info.size < 4 || info.size > MAX_ARCHIVE_BYTES) throw toolError('archive_size_limit')
      const archive = await fs.open(plugin.archivePath, constants.O_RDONLY | constants.O_NOFOLLOW)
      let bytes: Buffer
      try {
        const opened = await archive.stat()
        if (!opened.isFile() || opened.size !== info.size || opened.ino !== info.ino || opened.dev !== info.dev || (opened.mode & 0o077) !== 0) throw toolError('archive_preflight_failed')
        const buffer = Buffer.alloc(info.size + 1)
        let read = 0
        while (read < buffer.length) {
          const chunk = await archive.read(buffer, read, buffer.length - read, read)
          if (chunk.bytesRead === 0) break
          read += chunk.bytesRead
        }
        if (read !== info.size) throw toolError('archive_size_limit')
        bytes = buffer.subarray(0, read)
      } finally { await archive.close() }
      if (digest(bytes) !== plugin.sha256) throw toolError('archive_hash_mismatch')
      if (bytes.subarray(0, 4).toString('hex') !== '504b0304') throw toolError('invalid_plugin_archive')
      archives.push({ plugin, bytes })
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' && /^(archive_|invalid_plugin_archive|UNSAFE_PATH)/.test(error.code)) throw toolError(error.code)
    throw toolError('archive_preflight_failed')
  }
  const wp = (args: string[], timeoutMs?: number) => runner('studio', ['wp', ...args, '--path', sitePath], { timeoutMs })
  const readInventory = async () => parseInput(inventorySchema, parseStudioJson((await wp(['plugin', 'list', '--fields=name,status,version', '--format=json'])).stdout))
  const checkVersions = (inventory: z.infer<typeof inventorySchema>) => {
    for (const plugin of config.plugins) {
      const matches = inventory.filter((entry) => entry.name === plugin.slug)
      if (matches.length > 1 || (matches[0] && matches[0].version !== plugin.version)) throw toolError('plugin_version_mismatch')
      if (matches[0] && !['active', 'inactive'].includes(matches[0].status)) throw toolError('plugin_state_unsupported')
    }
  }
  checkVersions(await readInventory())
  return withSiteLock(statePath, async () => {
    await tools.status(scope, handle)
    const before = await readInventory()
    checkVersions(before)
    const plugins: DemoPluginsReport['plugins'] = []
    for (const plugin of config.plugins) {
      const existing = before.find((entry) => entry.name === plugin.slug)
      const action = !existing ? 'installed' : existing.status === 'active' ? 'unchanged' : 'activated'
      if (!existing) {
        const archive = archives.find((entry) => entry.plugin.slug === plugin.slug)
        if (!archive) throw toolError('archive_staging_missing')
        const timeoutMs = Math.min(config.timeoutMs ?? 180_000, 180_000)
        await withPrivateArchive(plugin.slug, archive.bytes, timeoutMs, (url) => wp(['plugin', 'install', url, `--exec=${archiveHttpPolicyPhp(url)}`], timeoutMs))
        const installed = (await readInventory()).find((entry) => entry.name === plugin.slug)
        if (!installed || installed.version !== plugin.version) throw toolError('plugin_install_unconfirmed')
      }
      if (action !== 'unchanged') await wp(['plugin', 'activate', plugin.slug])
      const verified = (await readInventory()).find((entry) => entry.name === plugin.slug)
      if (!verified || verified.version !== plugin.version || verified.status !== 'active') throw toolError('plugin_activation_unconfirmed')
      plugins.push({ slug: plugin.slug, version: plugin.version, sha256: plugin.sha256, status: 'active', action })
    }
    const publicValue = (await wp(['option', 'get', 'blog_public'])).stdout.trim()
    if (!['0', '1'].includes(publicValue)) throw toolError('noindex_state_unknown')
    const noindexChanged = publicValue !== '0'
    if (noindexChanged) await wp(['option', 'update', 'blog_public', '0'])
    if ((await wp(['option', 'get', 'blog_public'])).stdout.trim() !== '0') throw toolError('noindex_unconfirmed')
    return { schemaVersion: 1, provenance: dependencies.runner ? 'fixture' : 'live', siteId: handle.siteId, plugins, noindex: true, noindexChanged }
  })
}

export async function provisionDemoPlugins(scope: Scope, handle: SiteHandle, config: DemoPluginsConfig, dependencies: { runner?: CommandRunner } = {}): Promise<DemoPluginsReport> {
  try {
    return await provision(scope, handle, config, dependencies)
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    const known = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown',
      'site_busy_or_reconciliation_required', 'archive_inside_served_root', 'archive_not_private', 'archive_size_limit',
      'archive_hash_mismatch', 'invalid_plugin_archive', 'archive_preflight_failed', 'plugin_version_mismatch', 'plugin_state_unsupported',
      'archive_staging_missing', 'archive_transport_unavailable', 'archive_transport_expired', 'archive_transport_url_invalid', 'plugin_install_unconfirmed', 'plugin_activation_unconfirmed', 'noindex_state_unknown', 'noindex_unconfirmed',
      'COMMAND_FAILED', 'COMMAND_INTERRUPTED', 'COMMAND_OUTPUT_LIMIT', 'INVALID_STUDIO_JSON', 'UNSAFE_PATH'])
    throw toolError(known.has(code) ? code : 'plugin_provision_failed')
  }
}
