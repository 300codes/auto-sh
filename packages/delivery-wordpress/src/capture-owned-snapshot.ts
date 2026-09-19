import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { assertRegularFile, assertSafeDirectory, ensurePrivateRoot } from './paths.ts'
import { readRecord, requestHashFor, withSiteLock } from './ownership.ts'
import { createCommandRunner, type CommandRunner } from './runner.ts'
import { captureSiteSnapshot } from './snapshot.ts'
import { readOwnedSnapshotArtifacts } from './snapshot-reader.ts'
import { createWordPressStudioTools } from './tools.ts'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), provenance: z.enum(['live', 'fixture']), siteId: siteHandleSchema.shape.siteId,
  creationAttemptId: z.uuid(), toolExecutionId: z.uuid(), capturedAt: z.iso.datetime({ offset: true }),
  sourceRevision: z.object({ kind: z.literal('snapshot'), contentHash: hashSchema, externalWorkspaceId: siteHandleSchema.shape.siteId }).strict(),
  themeFiles: z.record(z.string(), hashSchema), databaseHash: hashSchema,
}).strict()
const receiptSchema = z.object({
  schemaVersion: z.literal(1), receiptId: z.uuid(), scope: scopeSchema,
  siteId: siteHandleSchema.shape.siteId, snapshotId: z.string().regex(/^snapshot-[A-Za-z0-9]{6}$/),
  snapshot: snapshotSchema, receiptHash: hashSchema,
}).strict()
const captureSchema = z.object({ scope: scopeSchema, handle: siteHandleSchema,
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute), timeoutMs: z.number().int().positive().max(600_000).optional() }).strict(),
}).strict()
const readSchema = z.object({ scope: scopeSchema, handle: siteHandleSchema, receiptId: z.uuid(), expectedReceiptHash: hashSchema,
  config: z.object({ stateRoot: z.string().refine(path.isAbsolute) }).strict(),
}).strict()
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function writeReceipt(directory: string, receipt: z.infer<typeof receiptSchema>) {
  const temporary = path.join(directory, `${receipt.receiptId}.${randomUUID()}.tmp`)
  const filename = path.join(directory, `${receipt.receiptId}.json`)
  const file = await fs.open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(receipt) + '\n'); await file.sync() } finally { await file.close() }
  await fs.link(temporary, filename)
  await fs.unlink(temporary)
  const parent = await fs.open(directory, constants.O_RDONLY)
  try { await parent.sync() } finally { await parent.close() }
}

export async function captureOwnedSnapshot(value: unknown, dependencies: { runner?: CommandRunner } = {}) {
  try {
    const input = parseInput(captureSchema, value)
    const runner = dependencies.runner ?? createCommandRunner({ timeoutMs: input.config.timeoutMs })
    const tools = createWordPressStudioTools(input.config, { runner })
    await tools.status(input.scope, input.handle)
    const statePath = path.join(input.config.stateRoot, input.handle.siteId)
    return await withSiteLock(statePath, async () => {
      const initial = await tools.status(input.scope, input.handle)
      const owner = await readRecord(statePath)
      if (!owner.result || owner.requestHash !== requestHashFor(owner.request) || owner.result.attemptId !== owner.request.attemptId) throw toolError('capture_snapshot_owner_invalid')
      const sitePath = path.join(input.config.sitesRoot, input.handle.siteId)
      let snapshot: z.infer<typeof snapshotSchema> | undefined
      let snapshotId: string | undefined
      try {
        if (initial.running) await runner('studio', ['site', 'stop', '--path', sitePath])
        if ((await tools.status(input.scope, input.handle)).running) throw toolError('capture_snapshot_stop_unconfirmed')
        const captured = await captureSiteSnapshot({ sitePath, themeSlug: owner.request.themeSlug, artifactRoot: await ensurePrivateRoot(path.join(statePath, 'snapshots')) })
        snapshotId = path.basename(captured.artifactDirectory)
        snapshot = {
          schemaVersion: 1, provenance: dependencies.runner || owner.result.provenance === 'fixture' ? 'fixture' : 'live',
          siteId: input.handle.siteId, creationAttemptId: owner.result.attemptId, toolExecutionId: randomUUID(), capturedAt: new Date().toISOString(),
          sourceRevision: { kind: 'snapshot', contentHash: captured.contentHash, externalWorkspaceId: input.handle.siteId },
          themeFiles: captured.themeFiles, databaseHash: captured.databaseHash,
        }
      } finally {
        if (initial.running) {
          await runner('studio', ['site', 'start', '--path', sitePath, '--skip-browser'])
          if (!(await tools.status(input.scope, input.handle)).running) throw toolError('capture_snapshot_restore_unconfirmed')
        } else if ((await tools.status(input.scope, input.handle)).running) throw toolError('capture_snapshot_state_changed')
      }
      if (!snapshot || !snapshotId) throw toolError('capture_snapshot_missing')
      const finalOwner = await readRecord(statePath)
      if (JSON.stringify(finalOwner) !== JSON.stringify(owner)) throw toolError('capture_snapshot_owner_changed')
      const receiptId = randomUUID()
      const content = receiptSchema.omit({ receiptHash: true }).parse({ schemaVersion: 1, receiptId, scope: input.scope, siteId: input.handle.siteId, snapshotId, snapshot })
      const receiptHash = hash(content)
      const receipt = parseInput(receiptSchema, { ...content, receiptHash })
      await writeReceipt(await ensurePrivateRoot(path.join(statePath, 'snapshot-receipts')), receipt)
      return { receiptId, receiptHash, snapshotId, snapshot }
    })
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && /^(capture_snapshot_|ownership_mismatch|site_|reconciliation_required)/.test(error.code) ? error.code : 'capture_snapshot_failed'
    throw toolError(code)
  }
}

export async function readCapturedOwnedSnapshot(value: unknown) {
  try {
    const input = parseInput(readSchema, value)
    const directory = path.join(input.config.stateRoot, input.handle.siteId, 'snapshot-receipts')
    await assertSafeDirectory(directory)
    if ((await fs.stat(directory)).mode & 0o077) throw toolError('capture_snapshot_receipt_unsafe')
    const filename = path.join(directory, `${input.receiptId}.json`)
    await assertRegularFile(filename)
    const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
    let raw: unknown
    try {
      const before = await file.stat()
      if (!before.isFile() || before.nlink !== 1 || before.size > 2 * 1024 * 1024 || (before.mode & 0o077)) throw toolError('capture_snapshot_receipt_unsafe')
      const bytes = Buffer.alloc(before.size)
      let offset = 0
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, offset)
        if (!read.bytesRead) throw toolError('capture_snapshot_receipt_changed')
        offset += read.bytesRead
      }
      const after = await file.stat()
      const current = await fs.lstat(filename)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== current.ino || before.dev !== current.dev || current.isSymbolicLink()) throw toolError('capture_snapshot_receipt_changed')
      raw = JSON.parse(bytes.toString('utf8'))
    } finally { await file.close() }
    const receipt = parseInput(receiptSchema, raw)
    const { receiptHash, ...content } = receipt
    if (receiptHash !== input.expectedReceiptHash || hash(content) !== receiptHash || receipt.receiptId !== input.receiptId || receipt.siteId !== input.handle.siteId || Object.keys(input.scope).some((key) => receipt.scope[key as keyof typeof input.scope] !== input.scope[key as keyof typeof input.scope])) throw toolError('capture_snapshot_receipt_mismatch')
    const artifacts = await readOwnedSnapshotArtifacts({ scope: input.scope, handle: input.handle, snapshotId: receipt.snapshotId, snapshot: receipt.snapshot, config: input.config })
    return { receiptId: receipt.receiptId, receiptHash, artifacts }
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && /^(capture_snapshot_|snapshot_reader_)/.test(error.code) ? error.code : 'capture_snapshot_read_failed'
    throw toolError(code)
  }
}
