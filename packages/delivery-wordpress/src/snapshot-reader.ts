import { constants, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { recordSchema, requestHashFor, siteIdFor } from './ownership.ts'
import { assertRegularFile, assertSafeDirectory } from './paths.ts'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const themePathSchema = z.string().min(1).max(512).refine((value) => {
  const segments = value.split('/')
  return segments.length <= 21 && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !/[\u0000-\u001f\u007f\\:]/.test(segment) && segment === segment.trim())
})
const themeFilesSchema = z.record(themePathSchema, hashSchema).refine((files) => Object.keys(files).length > 0 && Object.keys(files).length <= 2048)
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), provenance: z.enum(['live', 'fixture']), siteId: siteHandleSchema.shape.siteId,
  creationAttemptId: z.uuid(), toolExecutionId: z.uuid(),
  sourceRevision: z.object({ kind: z.literal('snapshot'), contentHash: hashSchema, externalWorkspaceId: siteHandleSchema.shape.siteId }).strict(),
  themeFiles: themeFilesSchema, databaseHash: hashSchema, capturedAt: z.iso.datetime({ offset: true }),
}).strict()
const manifestSchema = z.object({
  schemaVersion: z.literal(1), algorithm: z.literal('sha256'), contentHash: hashSchema,
  databaseHash: hashSchema, themeFiles: themeFilesSchema,
}).strict()
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema, snapshot: snapshotSchema,
  snapshotId: z.string().regex(/^snapshot-[A-Za-z0-9]{6}$/),
  config: z.object({ stateRoot: z.string().refine(path.isAbsolute) }).strict(),
}).strict()
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const canonical = (snapshot: { databaseHash: string; themeFiles: Record<string, string> }) => JSON.stringify({
  schemaVersion: 1, databaseHash: snapshot.databaseHash,
  themeFiles: Object.fromEntries(Object.entries(snapshot.themeFiles).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
})

async function privateDirectory(directory: string) {
  await assertSafeDirectory(directory)
  if ((await fs.stat(directory)).mode & 0o077) throw toolError('snapshot_reader_private_state_required')
}
async function noOperationLock(statePath: string) {
  try { await fs.lstat(path.join(statePath, 'operation.lock')) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  throw toolError('snapshot_reader_site_busy')
}
async function readBounded(filename: string, maximumBytes: number) {
  await assertRegularFile(filename)
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > maximumBytes || (before.mode & 0o077)) throw toolError('snapshot_reader_unsafe_file')
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, Math.min(bytes.length - offset, 64 * 1024), offset)
      if (read.bytesRead === 0) throw toolError('snapshot_reader_changed')
      offset += read.bytesRead
    }
    const after = await file.stat()
    const identity = [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs].join(':')
    if ([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(':') !== identity) throw toolError('snapshot_reader_changed')
    return { bytes, filename, identity }
  } finally { await file.close() }
}
async function verifyIdentity(entry: { filename: string; identity: string }) {
  await assertRegularFile(entry.filename)
  const current = await fs.lstat(entry.filename)
  if ([current.dev, current.ino, current.size, current.mtimeMs, current.ctimeMs].join(':') !== entry.identity) throw toolError('snapshot_reader_changed')
}

export async function readOwnedSnapshotArtifacts(value: unknown) {
  try {
    const input = parseInput(inputSchema, value)
    const statePath = path.join(input.config.stateRoot, input.handle.siteId)
    await privateDirectory(input.config.stateRoot)
    await privateDirectory(statePath)
    await noOperationLock(statePath)
    const ownerBytes = await readBounded(path.join(statePath, 'record.json'), 64 * 1024)
    const owner = parseInput(recordSchema, JSON.parse(ownerBytes.bytes.toString('utf8')))
    if (siteIdFor(input.scope) !== input.handle.siteId || siteIdFor(owner.request.scope) !== input.handle.siteId || owner.requestHash !== requestHashFor(owner.request) || owner.status !== 'ready' || !owner.result || owner.result.siteId !== input.handle.siteId || siteIdFor(owner.result.scope) !== input.handle.siteId || owner.result.attemptId !== owner.request.attemptId) throw toolError('snapshot_reader_ownership_mismatch')
    const snapshot = input.snapshot
    if (snapshot.siteId !== input.handle.siteId || snapshot.sourceRevision.externalWorkspaceId !== input.handle.siteId || snapshot.creationAttemptId !== owner.result.attemptId || snapshot.provenance !== owner.result.provenance) throw toolError('snapshot_reader_binding_mismatch')
    const snapshotsRoot = path.join(statePath, 'snapshots')
    const directory = path.join(snapshotsRoot, input.snapshotId)
    await privateDirectory(snapshotsRoot)
    await privateDirectory(directory)
    const manifestBytes = await readBounded(path.join(directory, 'manifest.json'), 2 * 1024 * 1024)
    const manifest = parseInput(manifestSchema, JSON.parse(manifestBytes.bytes.toString('utf8')))
    if (canonical(manifest) !== canonical(snapshot) || digest(canonical(manifest)) !== manifest.contentHash || manifest.contentHash !== snapshot.sourceRevision.contentHash) throw toolError('snapshot_reader_manifest_mismatch')
    const expectedFiles = new Set(['manifest.json', 'database.sqlite', ...Object.keys(snapshot.themeFiles).map((name) => `theme/${name}`)])
    const seen = new Set<string>()
    let entriesVisited = 0
    async function inventory(relative: string, depth: number): Promise<void> {
      if (depth > 22) throw toolError('snapshot_reader_inventory_limit')
      const current = path.join(directory, relative)
      await privateDirectory(current)
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        entriesVisited += 1
        if (entriesVisited > 4098) throw toolError('snapshot_reader_inventory_limit')
        const name = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.isSymbolicLink()) throw toolError('snapshot_reader_unsafe_file')
        if (entry.isDirectory()) {
          if (![...expectedFiles].some((file) => file.startsWith(`${name}/`))) throw toolError('snapshot_reader_inventory_mismatch')
          await inventory(name, depth + 1)
        } else if (entry.isFile() && expectedFiles.has(name)) seen.add(name)
        else throw toolError('snapshot_reader_inventory_mismatch')
      }
    }
    await inventory('', 0)
    if (seen.size !== expectedFiles.size) throw toolError('snapshot_reader_inventory_mismatch')
    const checked = [ownerBytes, manifestBytes]
    const database = await readBounded(path.join(directory, 'database.sqlite'), 512 * 1024 * 1024)
    if (digest(database.bytes) !== snapshot.databaseHash) throw toolError('snapshot_reader_hash_mismatch')
    checked.push(database)
    const artifactPrefix = `snapshots/${input.snapshotId}`
    const theme: Record<string, { path: string; bytes: Buffer }> = {}
    let themeBytes = 0
    for (const [name, sha256] of Object.entries(snapshot.themeFiles)) {
      const file = await readBounded(path.join(directory, 'theme', name), Math.min(16 * 1024 * 1024, 64 * 1024 * 1024 - themeBytes))
      themeBytes += file.bytes.length
      if (digest(file.bytes) !== sha256) throw toolError('snapshot_reader_hash_mismatch')
      theme[name] = { path: `${artifactPrefix}/theme/${name}`, bytes: file.bytes }
      checked.push(file)
    }
    for (const entry of checked) await verifyIdentity(entry)
    await noOperationLock(statePath)
    return { scope: input.scope, snapshot, database: { path: `${artifactPrefix}/database.sqlite`, bytes: database.bytes }, theme }
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('snapshot_reader_') ? error.code : 'snapshot_reader_failed'
    throw toolError(code)
  }
}
