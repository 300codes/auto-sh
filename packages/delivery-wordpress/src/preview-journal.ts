import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory } from './paths.ts'
import { readRecord, siteIdFor, withSiteLock } from './ownership.ts'
import { inspectOwnedPreview, transitionPreviewPublication } from './preview.ts'
import type { CommandRunner } from './runner.ts'
import { verifyOwnedDeploymentPackage } from './deployment-verify.ts'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const hostSchema = z.string().max(72).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.wp\.build$/).refine((value) => !/[\s\u0000-\u001f\u007f]/.test(value))
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema, packageId: z.uuid(), expectedPackageHash: hashSchema,
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute) }).strict(),
}).strict()
const createSchema = inputSchema.extend({ targetHost: hostSchema.nullable() }).strict()
const mutationSchema = inputSchema.extend({ expectedJournalHash: hashSchema }).strict()
const publicationSchema = z.object({
  schemaVersion: z.literal(1), siteId: siteHandleSchema.shape.siteId, packageHash: hashSchema,
  state: z.enum(['prepared', 'uploading', 'uncertain', 'uploaded_unverified', 'verified']), host: hostSchema.nullable(),
}).strict()
const observationSchema = z.object({
  host: hostSchema.nullable(), expired: z.boolean(), binding: z.enum(['absent', 'observed_not_adopted']),
}).strict()
const journalSchema = z.object({
  schemaVersion: z.literal(1), scope: scopeSchema, siteId: siteHandleSchema.shape.siteId,
  studioSiteId: z.string().min(1).max(256), packageId: z.uuid(), packageHash: hashSchema,
  targetHost: hostSchema.nullable(), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  previousHash: hashSchema.nullable(), publication: publicationSchema,
  observation: observationSchema.nullable(), journalHash: hashSchema,
}).strict()
type Journal = z.infer<typeof journalSchema>
type Input = z.infer<typeof inputSchema>
type Dependencies = { runner?: CommandRunner; now?: () => number }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function owned(input: Input) {
  if (siteIdFor(input.scope) !== input.handle.siteId) throw toolError('ownership_mismatch')
  const statePath = path.join(input.config.stateRoot, input.handle.siteId)
  await assertSafeDirectory(input.config.stateRoot)
  await assertSafeDirectory(statePath)
  if ((await fs.stat(input.config.stateRoot)).mode & 0o077 || (await fs.stat(statePath)).mode & 0o077) throw toolError('UNSAFE_PATH')
  const owner = await readRecord(statePath)
  if (owner.status !== 'ready' || !owner.result || owner.result.siteId !== input.handle.siteId || siteIdFor(owner.request.scope) !== input.handle.siteId || siteIdFor(owner.result.scope) !== input.handle.siteId) throw toolError('ownership_mismatch')
  return { statePath, owner, studioSiteId: owner.result.studioSiteId, filename: path.join(statePath, `preview-${input.packageId}.json`) }
}

async function readJournal(filename: string): Promise<Journal | null> {
  try { await fs.lstat(filename) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  await assertRegularFile(filename)
  const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > 64 * 1024 || (before.mode & 0o077)) throw toolError('preview_journal_invalid')
    const bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    const after = await file.stat()
    if (offset !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw toolError('preview_journal_changed')
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)))
    const journal = parseInput(journalSchema, decoded)
    const { journalHash, ...content } = decoded as Journal
    if (digest(content) !== journalHash) throw toolError('preview_journal_hash_mismatch')
    if ((journal.revision === 1) !== (journal.previousHash === null) || journal.publication.siteId !== journal.siteId || journal.publication.packageHash !== journal.packageHash || (journal.targetHost !== null && journal.targetHost !== journal.publication.host) || (['uploaded_unverified', 'verified'].includes(journal.publication.state) && journal.publication.host === null)) throw toolError('preview_journal_invalid')
    return journal
  } finally { await file.close() }
}

function bind(input: Input, current: Awaited<ReturnType<typeof owned>>, journal: Journal) {
  if (journal.siteId !== input.handle.siteId || siteIdFor(journal.scope) !== input.handle.siteId || journal.studioSiteId !== current.studioSiteId || journal.packageId !== input.packageId || journal.packageHash !== input.expectedPackageHash) throw toolError('preview_journal_binding_mismatch')
}

async function persist(filename: string, content: Omit<Journal, 'journalHash'>, expected: string | null) {
  const current = await readJournal(filename)
  if ((current?.journalHash ?? null) !== expected) throw toolError('preview_journal_conflict')
  const journal = parseInput(journalSchema, { ...content, journalHash: digest(content) })
  await assertContainedPath(path.dirname(filename), filename)
  const temporary = path.join(path.dirname(filename), `.preview-${randomUUID()}.tmp`)
  try {
    const file = await fs.open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(journal) + '\n'); await file.sync() } finally { await file.close() }
    if ((await readJournal(filename))?.journalHash !== (expected ?? undefined)) throw toolError('preview_journal_conflict')
    await assertContainedPath(path.dirname(filename), filename)
    if (expected === null) await fs.link(temporary, filename)
    else await fs.rename(temporary, filename)
    await fs.rm(temporary, { force: true })
    const directory = await fs.open(path.dirname(filename), constants.O_RDONLY)
    try { await directory.sync() } finally { await directory.close() }
    const confirmed = await readJournal(filename)
    if (confirmed?.journalHash !== journal.journalHash) throw toolError('preview_journal_write_unconfirmed')
    return journal
  } finally { await fs.rm(temporary, { force: true }) }
}

function report(journal: Journal, fixture: boolean) {
  return { schemaVersion: 1, status: 'passed', provenance: fixture ? 'fixture' : 'local', journal,
    effectiveState: journal.publication.state === 'uploading' ? 'uncertain' : journal.publication.state,
    publication: 'not_authorized', remoteRevision: 'not_verified', upload: 'not_run', approvalVerification: 'not_evaluated' }
}

async function safe<Result>(work: () => Promise<Result>): Promise<Result> {
  try { return await work() } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    const allowed = ['invalid_input', 'ownership_mismatch', 'site_busy_or_reconciliation_required', 'UNSAFE_PATH']
    throw toolError(allowed.includes(code) || code.startsWith('preview_') || code.startsWith('deployment_verify_') ? code : 'preview_journal_failed')
  }
}

export async function prepareOwnedPreviewJournal(value: unknown) {
  return safe(async () => {
    const input = parseInput(createSchema, value)
    const initial = await owned(input)
    return withSiteLock(initial.statePath, async () => {
      const current = await owned(input)
      await verifyOwnedDeploymentPackage(inputSchema.strip().parse(input))
      const existing = await readJournal(current.filename)
      if (existing) {
        bind(input, current, existing)
        if (existing.targetHost !== input.targetHost) throw toolError('preview_journal_binding_mismatch')
        return report(existing, current.owner.result?.provenance === 'fixture')
      }
      const journal = await persist(current.filename, { schemaVersion: 1, scope: input.scope, siteId: input.handle.siteId,
        studioSiteId: current.studioSiteId, packageId: input.packageId, packageHash: input.expectedPackageHash, targetHost: input.targetHost,
        revision: 1, previousHash: null, publication: { schemaVersion: 1, siteId: input.handle.siteId, packageHash: input.expectedPackageHash, state: 'prepared', host: input.targetHost }, observation: null }, null)
      return report(journal, current.owner.result?.provenance === 'fixture')
    })
  })
}

export async function readOwnedPreviewJournal(value: unknown) {
  return safe(async () => {
    const input = parseInput(inputSchema, value)
    const current = await owned(input)
    const journal = await readJournal(current.filename)
    if (!journal) throw toolError('preview_journal_missing')
    bind(input, current, journal)
    return report(journal, current.owner.result?.provenance === 'fixture')
  })
}

export async function reconcileOwnedPreviewJournal(value: unknown, dependencies: Dependencies = {}) {
  return safe(async () => {
    const input = parseInput(mutationSchema, value)
    const initial = await owned(input)
    return withSiteLock(initial.statePath, async () => {
      const current = await owned(input)
      await verifyOwnedDeploymentPackage(inputSchema.strip().parse(input))
      const journal = await readJournal(current.filename)
      if (!journal) throw toolError('preview_journal_missing')
      bind(input, current, journal)
      if (journal.journalHash !== input.expectedJournalHash) throw toolError('preview_journal_conflict')
      if (journal.publication.state === 'verified') throw toolError('preview_journal_requires_remote_verifier')
      const inspection = await inspectOwnedPreview({ scope: input.scope, handle: input.handle, config: input.config,
        ...(journal.publication.host ? { savedHost: journal.publication.host } : {}) }, dependencies)
      if (inspection.studioSiteId !== current.studioSiteId) throw toolError('preview_journal_binding_mismatch')
      let publication = journal.publication
      if (publication.state === 'uploading') publication = transitionPreviewPublication(publication, { type: 'interrupted' })
      if (publication.state !== 'prepared' && inspection.host !== null && !inspection.expired) publication = transitionPreviewPublication(publication, { type: 'observed', host: inspection.host })
      const observation = { host: inspection.host, expired: inspection.expired, binding: inspection.binding as 'absent' | 'observed_not_adopted' }
      if (JSON.stringify(publication) === JSON.stringify(journal.publication) && JSON.stringify(observation) === JSON.stringify(journal.observation)) return report(journal, dependencies.runner !== undefined || current.owner.result?.provenance === 'fixture')
      const { journalHash, ...content } = journal
      const updated = await persist(current.filename, { ...content, publication, observation, revision: journal.revision + 1, previousHash: journalHash }, journalHash)
      return report(updated, dependencies.runner !== undefined || current.owner.result?.provenance === 'fixture')
    })
  })
}
