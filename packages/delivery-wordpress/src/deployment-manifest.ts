import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { assertRegularFile, assertSafeDirectory, ensurePrivateRoot } from './paths.ts'
import { readRecord, withSiteLock } from './ownership.ts'
import type { CommandRunner } from './runner.ts'
import { createWordPressStudioTools } from './tools.ts'

const MAX_FILES = 30_000
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_CONTENT_BYTES = 1024 * 1024 * 1024
const MAX_DATABASE_BYTES = 512 * 1024 * 1024
const DATABASE = 'database/.ht.sqlite'
const runtimeVersion = z.string().max(64).regex(/^[0-9][A-Za-z0-9.+_-]{0,63}$/).refine((value) => !/[\r\n]/.test(value))
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema,
  runtimeIdentity: z.object({ wordpressVersion: runtimeVersion, phpVersion: runtimeVersion, studioVersion: runtimeVersion }).strict(),
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute) }).strict(),
}).strict()
type FileEvidence = { path: string; sizeBytes: number; sha256: string }
type Excluded = { path: string; reason: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const sortPaths = <Entry extends { path: string }>(entries: Entry[]) => entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)

function exclusion(relative: string, directory: boolean): string | undefined {
  const segments = relative.split('/')
  const name = segments.at(-1)!
  if (segments.some((segment) => ['.git', '.svn', '.hg'].includes(segment))) return 'version_control'
  if (['cache', 'upgrade', 'upgrade-temp-backup', 'backups', 'backup', 'logs'].includes(segments[0]!)) return 'operational_directory'
  if (name === '.DS_Store' || name === '.deployignore') return 'operator_metadata'
  if (name === '.env' || name.startsWith('.env.')) return 'private_environment'
  if (!directory && /\.(?:log|bak|tmp|old)$/i.test(name)) return 'operational_file'
  if (!directory && /\.(?:zip|tar|tgz|7z)$/i.test(name)) {
    if (segments[0] === 'uploads') throw toolError('deployment_media_archive_requires_review')
    if (['plugins', 'themes', 'mu-plugins'].includes(segments[0]!) && segments.length > 2) throw toolError('deployment_runtime_archive_requires_review')
    return 'source_archive_or_backup'
  }
  if (!directory && segments.length === 1 && /\.(?:sql|gz)$/i.test(name)) return 'source_archive_or_backup'
  if (!directory && /\.(?:pem|key|p12|pfx)$/i.test(name)) throw toolError('deployment_sensitive_file_requires_review')
  if (relative === DATABASE + '-shm') return 'sqlite_shared_memory'
  return undefined
}

async function readOrCopy(filename: string, relative: string, limit: number, target?: string): Promise<FileEvidence> {
  await assertRegularFile(filename)
  const source = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  let output: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const before = await source.stat()
    if (!before.isFile() || before.size > limit) throw toolError('deployment_package_limit')
    if (target) {
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      await assertSafeDirectory(path.dirname(target))
      output = await fs.open(target, 'wx', 0o600)
    }
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    let sizeBytes = 0
    while (true) {
      const read = await source.read(buffer, 0, buffer.length, null)
      if (!read.bytesRead) break
      sizeBytes += read.bytesRead
      if (sizeBytes > limit) throw toolError('deployment_package_limit')
      const bytes = buffer.subarray(0, read.bytesRead)
      hash.update(bytes)
      if (output) {
        let written = 0
        while (written < bytes.length) {
          const result = await output.write(bytes, written, bytes.length - written)
          if (!result.bytesWritten) throw toolError('deployment_package_write_failed')
          written += result.bytesWritten
        }
      }
    }
    const after = await source.stat()
    if (sizeBytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw toolError('deployment_source_changed')
    return { path: relative, sizeBytes, sha256: hash.digest('hex') }
  } finally { await output?.close(); await source.close() }
}

async function scanContent(contentRoot: string, stagingRoot?: string) {
  await assertSafeDirectory(contentRoot)
  const files: FileEvidence[] = []
  const excluded: Excluded[] = []
  let count = 0
  let totalBytes = 0
  async function visit(directory: string, relativeDirectory: string, depth: number): Promise<void> {
    if (depth > 32) throw toolError('deployment_package_limit')
    await assertSafeDirectory(directory)
    for (const name of (await fs.readdir(directory)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
      if (++count > MAX_FILES || name.length > 255) throw toolError('deployment_package_limit')
      if (/[\u0000-\u001f\u007f\\:]/.test(name)) throw toolError('deployment_unsafe_path')
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name
      const filename = path.join(directory, name)
      const info = await fs.lstat(filename)
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw toolError('UNSAFE_PATH')
      const reason = exclusion(relative, info.isDirectory())
      if (reason) { excluded.push({ path: `wp-content/${relative}`, reason }); continue }
      if (info.isDirectory()) { await visit(filename, relative, depth + 1); continue }
      const database = relative === DATABASE || relative === DATABASE + '-wal' || relative === DATABASE + '-journal'
      const target = stagingRoot && !database ? path.join(stagingRoot, relative) : undefined
      const evidence = await readOrCopy(filename, `wp-content/${relative}`, database ? MAX_DATABASE_BYTES : MAX_FILE_BYTES, target)
      totalBytes += evidence.sizeBytes
      if (totalBytes > MAX_CONTENT_BYTES) throw toolError('deployment_package_limit')
      files.push(evidence)
    }
  }
  await visit(contentRoot, '', 0)
  if (!files.some((file) => file.path === `wp-content/${DATABASE}`)) throw toolError('deployment_database_missing')
  return { files: sortPaths(files), excluded: sortPaths(excluded) }
}

async function backupDatabase(source: string, target: string) {
  await assertRegularFile(source)
  const database = new DatabaseSync(source, { readOnly: true })
  try {
    const count = database.prepare('PRAGMA page_count').get()?.page_count
    const size = database.prepare('PRAGMA page_size').get()?.page_size
    if (typeof count !== 'number' || typeof size !== 'number' || count * size > MAX_DATABASE_BYTES) throw toolError('deployment_package_limit')
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await backup(database, target)
    await fs.chmod(target, 0o600)
  } finally { database.close() }
  return readOrCopy(target, `wp-content/${DATABASE}`, MAX_DATABASE_BYTES)
}

export async function captureOwnedDeploymentPackage(value: unknown, dependencies: { runner?: CommandRunner } = {}) {
  let packageDirectory: string | undefined
  try {
    const input = parseInput(inputSchema, value)
    const tools = createWordPressStudioTools(input.config, dependencies)
    const initial = await tools.status(input.scope, input.handle)
    if (initial.running) throw toolError('deployment_site_must_be_stopped')
    const statePath = path.join(input.config.stateRoot, input.handle.siteId)
    return await withSiteLock(statePath, async () => {
      const current = await tools.status(input.scope, input.handle)
      if (current.running) throw toolError('deployment_site_must_be_stopped')
      const owner = await readRecord(statePath)
      const sitePath = path.join(input.config.sitesRoot, input.handle.siteId)
      const contentRoot = path.join(sitePath, 'wp-content')
      const root = await ensurePrivateRoot(path.join(statePath, 'deployment-packages'))
      const packageId = randomUUID()
      packageDirectory = path.join(root, packageId)
      await fs.mkdir(packageDirectory, { mode: 0o700 })
      const stagedContent = path.join(packageDirectory, 'site/wp-content')
      await fs.mkdir(stagedContent, { recursive: true, mode: 0o700 })
      const captured = await scanContent(contentRoot, stagedContent)
      if (!captured.files.some((entry) => entry.path.startsWith(`wp-content/themes/${owner.request.themeSlug}/`))) throw toolError('deployment_owned_theme_missing')
      const database = await backupDatabase(path.join(contentRoot, DATABASE), path.join(stagedContent, DATABASE))
      const after = await scanContent(contentRoot)
      if (JSON.stringify(after) !== JSON.stringify(captured)) throw toolError('deployment_source_changed')
      const finalState = await tools.status(input.scope, input.handle)
      if (finalState.running) throw toolError('deployment_site_must_be_stopped')
      const files = sortPaths([...captured.files.filter((entry) => ![DATABASE, DATABASE + '-wal', DATABASE + '-journal'].some((suffix) => entry.path === `wp-content/${suffix}`)), database])
      for (const expected of files) {
        const actual = await readOrCopy(path.join(packageDirectory, 'site', expected.path), expected.path, expected.path === database.path ? MAX_DATABASE_BYTES : MAX_FILE_BYTES)
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw toolError('deployment_staging_changed')
      }
      const sourceManifestHash = digest(JSON.stringify({ schemaVersion: 1, ...captured }))
      const manifest = {
        schemaVersion: 1 as const, siteId: input.handle.siteId, files, database: { backupPath: database.path, sha256: database.sha256 },
        sourceManifestHash, sourceFiles: captured.files,
        excluded: [...captured.excluded, { path: 'wp-config.php', reason: 'private_configuration_omitted' }],
        runtimeIdentity: { ...input.runtimeIdentity, verification: 'operator_declared' as const },
        configPolicy: { wpConfig: 'omitted' as const, coreRuntime: 'host_provided' as const, hostSubstitution: 'requires_verification' as const },
        checks: { databaseSecrets: 'not_evaluated' as const, publicContentApproval: 'not_evaluated' as const, pluginLicensing: 'not_evaluated' as const },
      }
      const packageHash = digest(JSON.stringify(manifest))
      await fs.writeFile(path.join(packageDirectory, 'manifest.json'), JSON.stringify({ ...manifest, packageHash }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      return {
        schemaVersion: 1 as const, provenance: dependencies.runner || owner.result?.provenance === 'fixture' ? 'fixture' as const : 'local' as const,
        siteId: input.handle.siteId, packageId, packageHash, sourceManifestHash, manifest,
        completeness: 'captured_inventory_only' as const,
        publication: 'not_authorized' as const, upload: 'not_run' as const,
      }
    })
  } catch (error) {
    if (packageDirectory) {
      try { await fs.rm(packageDirectory, { recursive: true, force: true }) } catch { throw toolError('deployment_cleanup_required') }
    }
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    const known = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH',
      'deployment_site_must_be_stopped', 'deployment_package_limit', 'deployment_unsafe_path', 'deployment_database_missing', 'deployment_owned_theme_missing', 'deployment_source_changed', 'deployment_staging_changed',
      'deployment_media_archive_requires_review', 'deployment_runtime_archive_requires_review', 'deployment_sensitive_file_requires_review', 'deployment_package_write_failed'])
    throw toolError(known.has(code) ? code : 'deployment_package_failed')
  }
}

export type DeploymentPackageReport = Awaited<ReturnType<typeof captureOwnedDeploymentPackage>>
