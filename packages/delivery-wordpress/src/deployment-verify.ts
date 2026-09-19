import { constants, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { assertRegularFile, assertSafeDirectory } from './paths.ts'
import { readRecord, requestHashFor, siteIdFor } from './ownership.ts'

const MAX_FILES = 30_000
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_DATABASE_BYTES = 512 * 1024 * 1024
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024
const DATABASE = 'wp-content/database/.ht.sqlite'
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const relativePath = z.string().max(8192).refine((value) => {
  const segments = value.split('/')
  return segments.length > 1 && segments.length <= 35 && segments[0] === 'wp-content' &&
    segments.every((segment) => segment.length > 0 && segment.length <= 255 && segment !== '.' && segment !== '..' && !/[\u0000-\u001f\u007f\\:]/.test(segment) && !/[ .]$/.test(segment))
})
const fileSchema = z.object({ path: relativePath, sizeBytes: z.number().int().nonnegative().max(MAX_DATABASE_BYTES), sha256: hashSchema }).strict()
const excludedSchema = z.object({ path: z.string().max(8192), reason: z.string().max(128) }).strict()
const runtimeVersion = z.string().max(64).regex(/^[0-9][A-Za-z0-9.+_-]{0,63}$/)
const manifestSchema = z.object({
  schemaVersion: z.literal(1), siteId: siteHandleSchema.shape.siteId,
  files: z.array(fileSchema).min(1).max(MAX_FILES),
  database: z.object({ backupPath: z.literal(DATABASE), sha256: hashSchema }).strict(),
  sourceManifestHash: hashSchema, sourceFiles: z.array(fileSchema).min(1).max(MAX_FILES),
  excluded: z.array(excludedSchema).max(MAX_FILES + 1),
  runtimeIdentity: z.object({ wordpressVersion: runtimeVersion, phpVersion: runtimeVersion, studioVersion: runtimeVersion, verification: z.literal('operator_declared') }).strict(),
  configPolicy: z.object({ wpConfig: z.literal('omitted'), coreRuntime: z.literal('host_provided'), hostSubstitution: z.literal('requires_verification') }).strict(),
  checks: z.object({ databaseSecrets: z.literal('not_evaluated'), publicContentApproval: z.literal('not_evaluated'), pluginLicensing: z.literal('not_evaluated') }).strict(),
  packageHash: hashSchema,
}).strict()
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema, packageId: z.uuid(), expectedPackageHash: hashSchema,
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute) }).strict(),
}).strict()
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

async function privateDirectory(directory: string) {
  await assertSafeDirectory(directory)
  if ((await fs.stat(directory)).mode & 0o077) throw toolError('deployment_verify_private_state_required')
}

async function readFile(filename: string, limit: number, collect = false) {
  await assertRegularFile(filename)
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > limit || (before.mode & 0o077)) throw toolError('deployment_verify_unsafe_file')
    const hash = createHash('sha256')
    const chunks: Buffer[] = []
    const buffer = Buffer.alloc(64 * 1024)
    let sizeBytes = 0
    while (true) {
      const result = await file.read(buffer, 0, buffer.length, null)
      if (!result.bytesRead) break
      sizeBytes += result.bytesRead
      if (sizeBytes > limit) throw toolError('deployment_verify_limit')
      const bytes = buffer.subarray(0, result.bytesRead)
      hash.update(bytes)
      if (collect) chunks.push(Buffer.from(bytes))
    }
    const after = await file.stat()
    const current = await fs.lstat(filename)
    if (sizeBytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== current.ino || before.dev !== current.dev || current.isSymbolicLink()) throw toolError('deployment_verify_changed')
    return { sizeBytes, sha256: hash.digest('hex'), bytes: collect ? Buffer.concat(chunks) : undefined,
      identity: [after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(':') }
  } finally { await file.close() }
}

function validateInventory(files: z.infer<typeof fileSchema>[], source = false) {
  const paths = new Set<string>()
  const aliases = new Map<string, string>()
  const directories = new Set<string>(['wp-content'])
  let totalBytes = 0
  let previous = ''
  for (const file of files) {
    if (file.path <= previous) throw toolError('deployment_verify_inventory_invalid')
    previous = file.path
    const database = file.path === DATABASE || (source && [DATABASE + '-wal', DATABASE + '-journal'].includes(file.path))
    if (file.sizeBytes > (database ? MAX_DATABASE_BYTES : MAX_FILE_BYTES)) throw toolError('deployment_verify_limit')
    if (!source && [DATABASE + '-wal', DATABASE + '-journal', DATABASE + '-shm'].includes(file.path)) throw toolError('deployment_verify_inventory_invalid')
    totalBytes += file.sizeBytes
    if (totalBytes > MAX_TOTAL_BYTES) throw toolError('deployment_verify_limit')
    paths.add(file.path)
    const segments = file.path.split('/')
    for (let length = 1; length <= segments.length; length++) {
      const candidate = segments.slice(0, length).join('/')
      const alias = candidate.normalize('NFC').toLowerCase()
      if (aliases.has(alias) && aliases.get(alias) !== candidate) throw toolError('deployment_verify_path_collision')
      aliases.set(alias, candidate)
      if (length < segments.length) directories.add(candidate)
    }
  }
  if ([...paths].some((filename) => directories.has(filename))) throw toolError('deployment_verify_path_collision')
  return { paths, directories, totalBytes }
}

export async function verifyOwnedDeploymentPackage(value: unknown) {
  try {
    const input = parseInput(inputSchema, value)
    if (siteIdFor(input.scope) !== input.handle.siteId) throw toolError('ownership_mismatch')
    const sitesRoot = path.resolve(input.config.sitesRoot)
    const stateRoot = path.resolve(input.config.stateRoot)
    for (const [parent, child] of [[sitesRoot, stateRoot], [stateRoot, sitesRoot]]) {
      const relative = path.relative(parent!, child!)
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw toolError('deployment_verify_unsafe_roots')
    }
    await privateDirectory(stateRoot)
    const statePath = path.join(stateRoot, input.handle.siteId)
    await privateDirectory(statePath)
    const owner = await readRecord(statePath)
    if (owner.status !== 'ready' || !owner.result || owner.requestHash !== requestHashFor(owner.request) || siteIdFor(owner.request.scope) !== input.handle.siteId || owner.result.siteId !== input.handle.siteId || siteIdFor(owner.result.scope) !== input.handle.siteId) throw toolError('ownership_mismatch')
    const root = path.join(statePath, 'deployment-packages')
    await privateDirectory(root)
    const directory = path.join(root, input.packageId)
    await privateDirectory(directory)
    if (JSON.stringify((await fs.readdir(directory)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) !== JSON.stringify(['manifest.json', 'site'])) throw toolError('deployment_verify_inventory_mismatch')
    const filename = path.join(directory, 'manifest.json')
    const raw = await readFile(filename, MAX_MANIFEST_BYTES, true)
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.bytes))
    const manifest = parseInput(manifestSchema, parsed)
    const { packageHash, ...hashInput } = parsed as z.infer<typeof manifestSchema>
    if (manifest.siteId !== input.handle.siteId || packageHash !== input.expectedPackageHash || digest(JSON.stringify(hashInput)) !== packageHash) throw toolError('deployment_verify_hash_mismatch')
    const inventory = validateInventory(manifest.files)
    validateInventory(manifest.sourceFiles, true)
    const database = manifest.files.find((file) => file.path === DATABASE)
    if (!database || database.sha256 !== manifest.database.sha256 || !manifest.files.some((file) => file.path.startsWith(`wp-content/themes/${owner.request.themeSlug}/`))) throw toolError('deployment_verify_inventory_invalid')
    const configExclusions = manifest.excluded.filter((entry) => entry.path === 'wp-config.php')
    if (configExclusions.length !== 1 || configExclusions[0]?.reason !== 'private_configuration_omitted') throw toolError('deployment_verify_inventory_invalid')
    const sourceExcluded = manifest.excluded.filter((entry) => entry.path !== 'wp-config.php')
    for (const entry of sourceExcluded) parseInput(relativePath, entry.path)
    if (digest(JSON.stringify({ schemaVersion: 1, files: manifest.sourceFiles, excluded: sourceExcluded })) !== manifest.sourceManifestHash) throw toolError('deployment_verify_hash_mismatch')
    const sourceContent = manifest.sourceFiles.filter((file) => ![DATABASE, DATABASE + '-wal', DATABASE + '-journal'].includes(file.path))
    if (JSON.stringify(sourceContent) !== JSON.stringify(manifest.files.filter((file) => file.path !== DATABASE))) throw toolError('deployment_verify_inventory_invalid')
    const site = path.join(directory, 'site')
    await privateDirectory(site)
    const observed = new Set<string>()
    let entries = 0
    const walk = async (folder: string, relative: string, depth: number): Promise<void> => {
      if (depth > 35) throw toolError('deployment_verify_limit')
      await privateDirectory(folder)
      const names = (await fs.readdir(folder)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      for (const name of names) {
        if (++entries > MAX_FILES) throw toolError('deployment_verify_limit')
        const candidate = relative ? `${relative}/${name}` : name
        const full = path.join(folder, name)
        const stat = await fs.lstat(full)
        if (stat.isSymbolicLink()) throw toolError('deployment_verify_unsafe_file')
        if (stat.isDirectory() && inventory.directories.has(candidate)) await walk(full, candidate, depth + 1)
        else if (stat.isFile() && inventory.paths.has(candidate)) observed.add(candidate)
        else throw toolError('deployment_verify_inventory_mismatch')
      }
      if (JSON.stringify((await fs.readdir(folder)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) !== JSON.stringify(names)) throw toolError('deployment_verify_changed')
    }
    await walk(site, '', 0)
    if (observed.size !== manifest.files.length) throw toolError('deployment_verify_inventory_mismatch')
    const identities = new Map<string, string>()
    for (const expected of manifest.files) {
      const actual = await readFile(path.join(site, expected.path), expected.path === DATABASE ? MAX_DATABASE_BYTES : MAX_FILE_BYTES)
      if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) throw toolError('deployment_verify_bytes_mismatch')
      identities.set(expected.path, actual.identity)
    }
    entries = 0
    await walk(site, '', 0)
    for (const [relative, identity] of identities) {
      const current = await fs.lstat(path.join(site, relative))
      if (!current.isFile() || current.isSymbolicLink() || [current.dev, current.ino, current.size, current.mtimeMs, current.ctimeMs].join(':') !== identity) throw toolError('deployment_verify_changed')
    }
    if (JSON.stringify((await fs.readdir(directory)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) !== JSON.stringify(['manifest.json', 'site'])) throw toolError('deployment_verify_inventory_mismatch')
    if ((await readFile(filename, MAX_MANIFEST_BYTES)).sha256 !== raw.sha256) throw toolError('deployment_verify_changed')
    return { schemaVersion: 1, status: 'passed', provenance: owner.result.provenance === 'fixture' ? 'fixture' : 'local', siteId: input.handle.siteId, packageId: input.packageId,
      packageHash, fileCount: manifest.files.length, totalBytes: inventory.totalBytes, verification: 'saved_package_bytes_only', publication: 'not_authorized', remoteRevision: 'not_verified',
      runtimeIdentity: manifest.runtimeIdentity, checks: manifest.checks, configPolicy: manifest.configPolicy }
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    throw toolError(code === 'ownership_mismatch' || code === 'invalid_input' || code === 'UNSAFE_PATH' || code.startsWith('deployment_verify_') ? code : 'deployment_verify_failed')
  }
}

export type DeploymentVerification = Awaited<ReturnType<typeof verifyOwnedDeploymentPackage>>
