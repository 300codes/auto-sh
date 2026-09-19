import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory, ensurePrivateRoot } from './paths.ts'
import { withSiteLock } from './ownership.ts'
import { verifyOwnedDeploymentPackage } from './deployment-verify.ts'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema, packageId: z.uuid(), expectedPackageHash: hashSchema,
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute) }).strict(),
}).strict()
const fileSchema = z.object({
  path: z.string().max(8192).refine((value) => value.startsWith('wp-content/') && value.split('/').length <= 35 && value.split('/').every((segment) => segment.length > 0 && segment.length <= 255 && segment !== '.' && segment !== '..' && !/[\\:\u0000-\u001f\u007f]/.test(segment) && !/[ .]$/.test(segment))),
  sizeBytes: z.number().int().nonnegative().max(512 * 1024 * 1024), sha256: hashSchema,
}).strict()
const filesSchema = z.array(fileSchema).min(1).max(30_000)
const stageSchema = z.object({
  schemaVersion: z.literal(1), siteId: siteHandleSchema.shape.siteId, packageId: z.uuid(),
  parentPackageHash: hashSchema, files: filesSchema, stageHash: hashSchema,
}).strict()
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const identity = (value: Awaited<ReturnType<typeof fs.lstat>>) => [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(':')

async function privateDirectory(directory: string) {
  await assertSafeDirectory(directory)
  if ((await fs.lstat(directory)).mode & 0o077) throw toolError('preview_staging_unsafe_permissions')
}

async function readPrivate(filename: string, limit: number) {
  await assertRegularFile(filename)
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > limit || (before.mode & 0o077)) throw toolError('preview_staging_unsafe_file')
    const bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    if (offset !== before.size || identity(before) !== identity(await handle.stat()) || identity(before) !== identity(await fs.lstat(filename))) throw toolError('preview_staging_changed')
    return bytes.subarray(0, offset)
  } finally { await handle.close() }
}

async function transfer(filename: string, expected: z.infer<typeof fileSchema>, target?: string) {
  await assertRegularFile(filename)
  const source = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  let output: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const before = await source.stat()
    const limit = expected.path === 'wp-content/database/.ht.sqlite' ? 512 * 1024 * 1024 : 64 * 1024 * 1024
    if (!before.isFile() || before.nlink !== 1 || before.size !== expected.sizeBytes || before.size > limit || (before.mode & 0o077)) throw toolError('preview_staging_unsafe_file')
    if (target) output = await fs.open(target, 'wx', 0o600)
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    let size = 0
    for (;;) {
      const read = await source.read(buffer, 0, buffer.length, null)
      if (!read.bytesRead) break
      size += read.bytesRead
      if (size > expected.sizeBytes) throw toolError('preview_staging_changed')
      const bytes = buffer.subarray(0, read.bytesRead)
      hash.update(bytes)
      if (output) {
        let offset = 0
        while (offset < bytes.length) {
          const written = await output.write(bytes, offset, bytes.length - offset)
          if (!written.bytesWritten) throw toolError('preview_staging_write_failed')
          offset += written.bytesWritten
        }
      }
    }
    if (size !== expected.sizeBytes || hash.digest('hex') !== expected.sha256 || identity(before) !== identity(await source.stat()) || identity(before) !== identity(await fs.lstat(filename))) throw toolError('preview_staging_changed')
    if (output) await output.sync()
    return identity(before)
  } finally { await output?.close(); await source.close() }
}

async function verifyStage(directory: string, expected: z.infer<typeof stageSchema>) {
  await privateDirectory(directory)
  if (JSON.stringify((await fs.readdir(directory)).sort()) !== JSON.stringify(['site', 'stage.json'])) throw toolError('preview_staging_inventory_mismatch')
  const record = await readPrivate(path.join(directory, 'stage.json'), 16 * 1024 * 1024)
  const parsed = parseInput(stageSchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(record)))
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) throw toolError('preview_staging_binding_mismatch')
  const files = new Map(expected.files.map((entry) => [entry.path, entry]))
  const directories = new Set<string>()
  for (const entry of expected.files) {
    const segments = entry.path.split('/')
    for (let count = 1; count < segments.length; count++) directories.add(segments.slice(0, count).join('/'))
  }
  const observed = new Map<string, string>()
  let count = 0
  const walk = async (folder: string, relative: string): Promise<void> => {
    await privateDirectory(folder)
    const names = (await fs.readdir(folder)).sort()
    for (const name of names) {
      if (++count > 30_000) throw toolError('preview_staging_limit')
      const candidate = relative ? `${relative}/${name}` : name
      const full = path.join(folder, name)
      const stat = await fs.lstat(full)
      if (stat.isDirectory() && directories.has(candidate)) await walk(full, candidate)
      else if (stat.isFile() && files.has(candidate)) observed.set(candidate, await transfer(full, files.get(candidate)!))
      else throw toolError('preview_staging_inventory_mismatch')
    }
    if (JSON.stringify((await fs.readdir(folder)).sort()) !== JSON.stringify(names)) throw toolError('preview_staging_changed')
  }
  await walk(path.join(directory, 'site'), '')
  if (observed.size !== files.size) throw toolError('preview_staging_inventory_mismatch')
  for (const [relative, fingerprint] of observed) if (identity(await fs.lstat(path.join(directory, 'site', relative))) !== fingerprint) throw toolError('preview_staging_changed')
  if (!record.equals(await readPrivate(path.join(directory, 'stage.json'), 16 * 1024 * 1024)) || JSON.stringify((await fs.readdir(directory)).sort()) !== JSON.stringify(['site', 'stage.json'])) throw toolError('preview_staging_changed')
}

export async function prepareOwnedPreviewStaging(value: unknown) {
  try {
    const input = parseInput(inputSchema, value)
    await verifyOwnedDeploymentPackage(input)
    const statePath = path.join(input.config.stateRoot, input.handle.siteId)
    return await withSiteLock(statePath, async () => {
      const verified = await verifyOwnedDeploymentPackage(input)
      const source = path.join(statePath, 'deployment-packages', input.packageId)
      const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPrivate(path.join(source, 'manifest.json'), 16 * 1024 * 1024)))
      const manifest = parseInput(z.object({ packageHash: hashSchema, files: filesSchema }).passthrough(), decoded)
      const packageHash = manifest.packageHash
      const content = Object.fromEntries(Object.entries(decoded as Record<string, unknown>).filter(([key]) => key !== 'packageHash'))
      if (packageHash !== input.expectedPackageHash || digest(JSON.stringify(content)) !== packageHash) throw toolError('preview_staging_binding_mismatch')
      const totalBytes = manifest.files.reduce((total, file) => total + file.sizeBytes, 0)
      if (totalBytes > 1024 * 1024 * 1024) throw toolError('preview_staging_limit')
      const body = { schemaVersion: 1 as const, siteId: input.handle.siteId, packageId: input.packageId, parentPackageHash: packageHash, files: manifest.files }
      const expected = { ...body, stageHash: digest(JSON.stringify(body)) }
      const root = await ensurePrivateRoot(path.join(statePath, 'preview-staging'))
      const directory = path.join(root, input.packageId)
      await assertContainedPath(root, directory)
      let exists = true
      try { await fs.lstat(directory) } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') exists = false; else throw error }
      if (!exists) {
        const temporary = path.join(root, `.pending-${randomUUID()}`)
        await fs.mkdir(temporary, { mode: 0o700 })
        for (const file of manifest.files) {
          const target = path.join(temporary, 'site', file.path)
          await assertContainedPath(temporary, target)
          await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
          await transfer(path.join(source, 'site', file.path), file, target)
        }
        const record = await fs.open(path.join(temporary, 'stage.json'), 'wx', 0o600)
        try { await record.writeFile(JSON.stringify(expected) + '\n'); await record.sync() } finally { await record.close() }
        await verifyOwnedDeploymentPackage(input)
        await verifyStage(temporary, expected)
        await assertContainedPath(root, directory)
        try { await fs.lstat(directory); throw toolError('preview_staging_conflict') } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
        await fs.rename(temporary, directory)
        const parent = await fs.open(root, constants.O_RDONLY)
        try { await parent.sync() } finally { await parent.close() }
      }
      await verifyOwnedDeploymentPackage(input)
      await verifyStage(directory, expected)
      return { schemaVersion: 1, status: 'passed', provenance: verified.provenance, siteId: input.handle.siteId, packageId: input.packageId,
        packageHash, stageHash: expected.stageHash, fileCount: manifest.files.length, totalBytes,
        verification: 'private_frozen_staging_bytes_only', publication: 'not_authorized', remoteRevision: 'not_verified',
        upload: 'not_run', frozenPackageUpload: 'requires_host_integration', registeredSiteBinding: 'not_established',
        configSafety: 'requires_prepared_config', checks: verified.checks }
    })
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    throw toolError(code === 'ownership_mismatch' || code === 'invalid_input' || code === 'UNSAFE_PATH' || code === 'site_busy_or_reconciliation_required' || code.startsWith('deployment_verify_') || code.startsWith('preview_staging_') ? code : 'preview_staging_failed')
  }
}
