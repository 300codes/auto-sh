import { commentImportBatchV1Schema, deliveryFlowErrorFromZod, type CommentImportBatchV1, type CommentThread } from '../contracts'
import {
  STAFF_COMMENT_MAX,
  STAFF_DESCRIPTION_MAX,
  STAFF_EMPTY_TEXT,
  STAFF_TITLE_MAX,
  STAFF_TRUNCATION_MARKER,
  advanceSyncCursor,
  asCommentThreadRecord,
  bindThreadVersion,
  buildCommentImportResult,
  checkCommentImportBatch,
  hashCommentImportBatch,
  latestReplyRevisions,
  planCommentImport,
  renderStaffComment,
  renderStaffTask,
  sameInstant,
  truncateForStaff,
  type ArtifactFigmaBinding,
  type CommentThreadPlan,
  type StoredCommentReply,
  type StoredCommentThread,
} from '../commentImport'
import { blockingThreadsFor } from '../stageDecisions'
import {
  loadCommentImportFixture,
  loadCommentImportResultFixture,
  loadNegativeFlowFixtures,
  loadStaffLinkFixture,
  loadStageArtifactFixture,
} from '../fixtures/flow/index'

const NOW = '2026-09-19T10:10:00.000Z'
const BATCH_KEY = 'import-FIGFILE0001-0001'
const UX_V1_ID = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const uuid = (char: string) => `${char.repeat(8)}-${char.repeat(4)}-4${char.repeat(3)}-8${char.repeat(3)}-${char.repeat(12)}`

function first<TItem>(items: readonly TItem[]): TItem {
  const item = items[0]
  if (item === undefined) throw new Error('[internal] expected at least one item')
  return item
}

function uxFigmaRefs() {
  const ux = loadStageArtifactFixture('ux')
  if (ux.stageId !== 'ux') throw new Error('[internal] fixture is not a ux artifact')
  return ux.content.figmaRefs
}

const uxV1: ArtifactFigmaBinding = { id: UX_V1_ID, stageId: 'ux', version: 1, figmaRefs: uxFigmaRefs() }

function fixtureThread(): CommentThread {
  return first(loadCommentImportFixture().threads)
}

function fixtureCursor() {
  const stored = loadStaffLinkFixture().syncCursors.FIGFILE0001
  if (!stored) throw new Error('[internal] staff link fixture has no FIGFILE0001 cursor')
  return stored
}

function batchWith(thread: CommentThread, overrides: Partial<CommentImportBatchV1> = {}): CommentImportBatchV1 {
  return { ...loadCommentImportFixture(), ...overrides, threads: [thread] }
}

type Stored = { thread: StoredCommentThread; replies: StoredCommentReply[] }

function persist(plan: CommentThreadPlan, previous: Stored | null): Stored {
  if (plan.outcome === 'skipped') throw new Error('[internal] cannot persist a skipped plan')
  const threadId = previous?.thread.threadId ?? uuid('c')
  const staffTaskId = previous?.thread.staffTaskId ?? uuid('e')
  const thread: StoredCommentThread = plan.draft
    ? { ...plan.draft, threadId, staffTaskId, deferral: null, linkedDeliveryTaskId: null, replies: [], updatedAt: NOW }
    : { ...(previous?.thread ?? failMissing()), triageStatus: plan.triageStatus }
  const created = plan.replies.flatMap((reply) => (reply.draft ? [{ ...reply.draft, replyId: uuid(String(reply.revision)), staffCommentId: uuid('d') }] : []))
  return { thread, replies: [...(previous?.replies ?? []), ...created] }
}

function failMissing(): never {
  throw new Error('[internal] unchanged plan without a stored thread')
}

function planOne(batch: CommentImportBatchV1, stored: Stored | null, artifacts: readonly ArtifactFigmaBinding[] = [uxV1]) {
  const plan = planCommentImport({
    batch,
    existingThreads: stored ? [stored.thread] : [],
    existingRepliesByThreadId: new Map<string, readonly StoredCommentReply[]>(stored ? [[stored.thread.threadId, stored.replies]] : []),
    artifacts,
  })[0]
  if (!plan) throw new Error('[internal] no plan produced')
  return plan
}

function expectPlanned(plan: CommentThreadPlan): Extract<CommentThreadPlan, { draft: unknown }> {
  if (plan.outcome === 'skipped') throw new Error(`[internal] unexpected skipped plan for ${plan.threadKey}`)
  return plan
}

describe('fixture happy path', () => {
  const batch = loadCommentImportFixture()
  const batchHash = hashCommentImportBatch(batch)
  const result = loadCommentImportResultFixture()

  it('proceeds on a link without a cursor for the file', () => {
    expect(checkCommentImportBatch({ stored: null, batch, idempotencyKey: BATCH_KEY, batchHash })).toEqual({ kind: 'proceed' })
  })

  it('plans one created thread bound to the ux v1 artifact with one created reply', () => {
    const plans = planCommentImport({ batch, existingThreads: [], existingRepliesByThreadId: new Map(), artifacts: [uxV1] })
    expect(plans).toHaveLength(1)
    const plan = expectPlanned(first(plans))
    expect(plan.outcome).toBe('created')
    expect(plan.versionConfirmed).toBe(true)
    expect(plan.artifactId).toBe(UX_V1_ID)
    expect(plan.triageStatus).toBe('new')
    expect(plan.draft?.fetchedAt).toBe(batch.fetchedAt)
    expect(plan.replies.map((reply) => [reply.outcome, reply.revision])).toEqual([['created', 1]])
    expect(plan.staff.title).toBe('The booking button is hard to find on mobile.')
    expect(plan.staff.description).toContain(`Artifact: ${UX_V1_ID} · version confirmed`)
  })

  it('reproduces the result fixture and the post-import cursor entry', () => {
    const plans = planCommentImport({ batch, existingThreads: [], existingRepliesByThreadId: new Map(), artifacts: [uxV1] })
    const ids = new Map(
      result.threads.map((thread) => [
        thread.threadKey,
        { threadId: thread.threadId, staffTaskId: thread.staffTaskId, replies: new Map(thread.replies.map((reply) => [reply.commentKey, reply.staffCommentId])) },
      ]),
    )
    expect(buildCommentImportResult({ batch, plans, ids, replayed: false })).toEqual(result)
    const expected = fixtureCursor()
    expect(expected.lastBatchHash).toBe(batchHash)
    expect(advanceSyncCursor({ stored: null, batch, idempotencyKey: BATCH_KEY, batchHash, plans, now: NOW })).toEqual(expected)
    expect(expected.cursor).toBe('page-2')
    expect(expected.lastError).toBeNull()
  })

  it('answers replay, idempotency and cursor conflicts against the post-import cursor', () => {
    const stored = fixtureCursor()
    expect(checkCommentImportBatch({ stored, batch, idempotencyKey: 'import-FIGFILE0001-0002', batchHash })).toEqual({ kind: 'sync_cursor_conflict', expected: 'page-2' })
    expect(checkCommentImportBatch({ stored, batch, idempotencyKey: BATCH_KEY, batchHash })).toEqual({ kind: 'replay' })
    expect(checkCommentImportBatch({ stored, batch, idempotencyKey: BATCH_KEY, batchHash: 'f'.repeat(64) })).toEqual({ kind: 'idempotency_conflict' })
  })

  it('advances past a stage-mismatch skip and names the skipped thread', () => {
    const stored = { cursor: null, lastBatchKey: 'older', lastBatchHash: 'a'.repeat(64), lastSyncAt: null, lastError: null }
    const moved = persist(planOne(batchWith(fixtureThread(), { stageId: 'key_visual' }), null, []), null)
    const plans = planCommentImport({ batch, existingThreads: [moved.thread], existingRepliesByThreadId: new Map(), artifacts: [uxV1] })
    expect(plans[0]).toMatchObject({ outcome: 'skipped', reason: 'stage_mismatch' })
    expect(advanceSyncCursor({ stored, batch, idempotencyKey: BATCH_KEY, batchHash, plans, now: NOW })).toEqual({
      cursor: batch.cursor.next,
      lastBatchKey: BATCH_KEY,
      lastBatchHash: batchHash,
      lastSyncAt: NOW,
      lastError: `1 thread(s) skipped (stage mismatch): ${moved.thread.threadKey}`,
    })
    const built = buildCommentImportResult({ batch, plans, ids: new Map(), replayed: false })
    expect(built.threads[0]).toMatchObject({ outcome: 'skipped', threadId: moved.thread.threadId })
    expect(built.counts.skipped).toBe(1)
  })

  it('keeps the cursor and forgets the batch key when a thread write failed', () => {
    const stored = { cursor: 'page-1', lastBatchKey: 'older', lastBatchHash: 'a'.repeat(64), lastSyncAt: null, lastError: null }
    const plans = planCommentImport({ batch, existingThreads: [], existingRepliesByThreadId: new Map(), artifacts: [uxV1] })
    const failedThreadKeys = [first(plans).threadKey]
    expect(advanceSyncCursor({ stored, batch, idempotencyKey: BATCH_KEY, batchHash, plans, failedThreadKeys, now: NOW })).toEqual({
      cursor: 'page-1',
      lastBatchKey: null,
      lastBatchHash: null,
      lastSyncAt: NOW,
      lastError: `1 thread(s) failed: ${failedThreadKeys[0]}`,
    })
    const built = buildCommentImportResult({ batch, plans, ids: new Map(), failedThreadKeys, replayed: false })
    expect(built.threads).toEqual([])
    expect(built.counts).toEqual({ threadsCreated: 0, threadsUpdated: 0, repliesCreated: 0, repliesUpdated: 0, skipped: 1 })
  })

  it('treats equal instants in another notation as unchanged', () => {
    const thread = { ...fixtureThread(), updatedAt: '2026-09-19T09:00:00.000Z' }
    const edited = { ...thread, replies: thread.replies.map((reply) => ({ ...reply, editedAt: '2026-09-19T09:30:00.000Z' })) }
    const stored = persist(planOne(batchWith(edited), null), null)
    const renotated = { ...edited, updatedAt: '2026-09-19T11:00:00+02:00', replies: edited.replies.map((reply) => ({ ...reply, editedAt: '2026-09-19T09:30:00Z' })) }
    const plan = expectPlanned(planOne(batchWith(renotated), stored))
    expect(plan.outcome).toBe('unchanged')
    expect(plan.replies.map((reply) => reply.outcome)).toEqual(['unchanged'])
    expect(sameInstant(undefined, null)).toBe(true)
    expect(sameInstant(null, '2026-09-19T09:30:00Z')).toBe(false)
  })

  it('never cuts a surrogate pair when truncating', () => {
    const text = `${'a'.repeat(STAFF_TITLE_MAX - STAFF_TRUNCATION_MARKER.length - 1)}😀${'b'.repeat(40)}`
    const cut = truncateForStaff(text, STAFF_TITLE_MAX)
    expect(cut.length).toBeLessThanOrEqual(STAFF_TITLE_MAX)
    expect(cut.endsWith(STAFF_TRUNCATION_MARKER)).toBe(true)
    expect(cut).toBe(`${'a'.repeat(STAFF_TITLE_MAX - STAFF_TRUNCATION_MARKER.length - 1)}${STAFF_TRUNCATION_MARKER}`)
  })

  it('rejects the comment-import negative fixtures with their published codes', () => {
    const negatives = loadNegativeFlowFixtures().filter((fixture) => fixture.name.startsWith('comment-import.'))
    expect(negatives).toHaveLength(3)
    for (const fixture of negatives) {
      const parsed = commentImportBatchV1Schema.safeParse(fixture.document)
      expect(parsed.success).toBe(false)
      if (parsed.success) continue
      expect(deliveryFlowErrorFromZod(parsed.error).body.code).toBe(fixture.expected.code)
    }
  })
})

describe('bindThreadVersion', () => {
  const batch = { fileKey: 'FIGFILE0001', stageId: 'ux' as const, artifactId: UX_V1_ID }
  const withVersion = (figmaVersion: string | null): CommentThread => ({ ...fixtureThread(), figmaVersion })
  const uxV2: ArtifactFigmaBinding = { id: uuid('2'), stageId: 'ux', version: 2, figmaRefs: uxFigmaRefs() }
  const uxV3Approved: ArtifactFigmaBinding = { id: uuid('3'), stageId: 'ux', version: 3, figmaRefs: [{ ...first(uxFigmaRefs()), figmaVersion: '999' }] }

  it('keeps the batch artifact unconfirmed without a figma version or without a carrying artifact', () => {
    expect(bindThreadVersion({ thread: withVersion(null), batch, artifacts: [uxV1] })).toEqual({ artifactId: UX_V1_ID, versionConfirmed: false })
    expect(bindThreadVersion({ thread: withVersion('other'), batch, artifacts: [uxV1, uxV2] })).toEqual({ artifactId: UX_V1_ID, versionConfirmed: false })
  })

  it('binds to the highest version carrying the figma version and ignores other stages and the latest artifact', () => {
    expect(bindThreadVersion({ thread: withVersion('1234567890'), batch, artifacts: [uxV1, uxV2, uxV3Approved] })).toEqual({ artifactId: uxV2.id, versionConfirmed: true })
    expect(bindThreadVersion({ thread: withVersion('1234567890'), batch, artifacts: [{ ...uxV2, stageId: 'key_visual' }] })).toEqual({ artifactId: UX_V1_ID, versionConfirmed: false })
    expect(bindThreadVersion({ thread: withVersion('1234567890'), batch, artifacts: [uxV3Approved] })).toEqual({ artifactId: UX_V1_ID, versionConfirmed: false })
  })
})

describe('create → reply → edit → delete → resolve → reopen sequence', () => {
  const base = fixtureThread()
  const reply = first(base.replies)
  const triaged = (stored: Stored): Stored => ({ ...stored, thread: { ...stored.thread, triageStatus: 'triaged' } })

  it('walks the sequence with revisions, triage resets and preserved rows', () => {
    const created = expectPlanned(planOne(batchWith({ ...base, replies: [] }), null))
    expect(created).toMatchObject({ outcome: 'created', triageStatus: 'new', replies: [] })
    const afterCreate = triaged(persist(created, null))

    const replied = expectPlanned(planOne(batchWith(base), afterCreate))
    expect(replied).toMatchObject({ outcome: 'updated', triageStatus: 'new' })
    expect(replied.replies).toMatchObject([{ outcome: 'created', revision: 1 }])
    const afterReply = triaged(persist(replied, afterCreate))

    const editedReply = { ...reply, body: 'Moved it above the fold.', editedAt: '2026-09-19T10:20:00.000Z' }
    const edited = expectPlanned(planOne(batchWith({ ...base, replies: [editedReply] }), afterReply))
    expect(edited).toMatchObject({ outcome: 'updated', triageStatus: 'triaged' })
    expect(edited.replies).toMatchObject([{ outcome: 'updated', revision: 2, draft: { body: 'Moved it above the fold.' } }])
    const afterEdit = persist(edited, afterReply)

    const deletedReply = { ...editedReply, deleted: true }
    const deleted = expectPlanned(planOne(batchWith({ ...base, replies: [deletedReply] }), afterEdit))
    expect(deleted).toMatchObject({ outcome: 'updated', triageStatus: 'triaged' })
    expect(deleted.replies).toMatchObject([{ outcome: 'updated', revision: 3, draft: { deleted: true } }])
    expect(deleted.replies[0]?.staffBody).toContain('[deleted at source]')
    const afterDelete = persist(deleted, afterEdit)
    expect(afterDelete.replies.map((row) => row.revision)).toEqual([1, 2, 3])
    expect(latestReplyRevisions(afterDelete.replies).get(reply.commentKey)?.revision).toBe(3)

    const resolved = expectPlanned(planOne(batchWith({ ...base, status: 'resolved', replies: [deletedReply] }), afterDelete))
    expect(resolved).toMatchObject({ outcome: 'updated', triageStatus: 'triaged' })
    expect(resolved.replies).toMatchObject([{ outcome: 'unchanged', revision: 3, draft: null }])
    const afterResolve = persist(resolved, afterDelete)
    expect(afterResolve.thread.sourceStatus).toBe('resolved')

    const reopened = expectPlanned(planOne(batchWith({ ...base, status: 'open', replies: [deletedReply] }), afterResolve))
    expect(reopened).toMatchObject({ outcome: 'updated', triageStatus: 'new' })
    const afterReopen = persist(reopened, afterResolve)

    const same = expectPlanned(planOne(batchWith({ ...base, status: 'open', replies: [deletedReply] }), afterReopen))
    expect(same).toMatchObject({ outcome: 'unchanged', draft: null, triageStatus: 'new' })
    expect(same.replies).toMatchObject([{ outcome: 'unchanged', draft: null }])
    expect(afterReopen.replies).toHaveLength(3)
  })

  it('skips a thread whose stored row belongs to another stage', () => {
    const stored = persist(planOne(batchWith(base, { stageId: 'key_visual' }), null, []), null)
    expect(planOne(batchWith(base), stored)).toEqual({ threadKey: base.threadKey, outcome: 'skipped', reason: 'stage_mismatch', existing: stored.thread })
  })

  it('feeds the F8 blocking rule with stored threads', () => {
    const stored = persist(planOne(batchWith(base), null), null)
    const blocking = blockingThreadsFor([stored.thread], 'ux', { artifactId: UX_V1_ID, contentHash: '1'.repeat(64) })
    expect(blocking.map((thread) => thread.threadKey)).toEqual([base.threadKey])
    expect(asCommentThreadRecord(stored.thread)).toBe(stored.thread)
  })
})

describe('staff rendering', () => {
  const thread = fixtureThread()
  const batch = { stageId: 'ux' as const, fileKey: 'FIGFILE0001' }

  it('uses the first non-empty line as title and truncates with the marker', () => {
    const rendered = renderStaffTask({ thread: { ...thread, body: '\n\n  Headline  \nSecond line' }, batch, artifactId: null, versionConfirmed: false })
    expect(rendered.title).toBe('Headline')
    expect(rendered.description).toContain('Artifact: none · version unconfirmed')
    expect(rendered.description.endsWith('Headline  \nSecond line')).toBe(true)
    const long = renderStaffTask({ thread: { ...thread, body: 'x'.repeat(400) }, batch, artifactId: UX_V1_ID, versionConfirmed: true })
    expect(long.title).toHaveLength(STAFF_TITLE_MAX)
    expect(long.title.endsWith(STAFF_TRUNCATION_MARKER)).toBe(true)
  })

  it('caps the description and the comment body with the marker', () => {
    const description = renderStaffTask({ thread: { ...thread, body: 'y'.repeat(9000) }, batch, artifactId: null, versionConfirmed: false }).description
    expect(description.length).toBeLessThanOrEqual(STAFF_DESCRIPTION_MAX)
    expect(description.endsWith(STAFF_TRUNCATION_MARKER)).toBe(true)
    const comment = renderStaffComment({ ...first(thread.replies), body: 'z'.repeat(6000) })
    expect(comment.length).toBeLessThanOrEqual(STAFF_COMMENT_MAX)
    expect(comment.endsWith(STAFF_TRUNCATION_MARKER)).toBe(true)
    expect(truncateForStaff('abc', 3)).toBe('abc')
    expect(truncateForStaff('abcdefghijklmnopqrstuvwxyz', 20)).toHaveLength(20)
  })

  it('falls back to the empty marker and flags edits and deletions', () => {
    expect(truncateForStaff('   ', 10)).toBe(STAFF_EMPTY_TEXT)
    const blank = renderStaffTask({ thread: { ...thread, body: '   \n  ' }, batch, artifactId: null, versionConfirmed: false })
    expect(blank.title).toBe(STAFF_EMPTY_TEXT)
    expect(blank.description.endsWith(`\n\n${STAFF_EMPTY_TEXT}`)).toBe(true)
    const reply = first(thread.replies)
    expect(renderStaffComment(reply)).toBe(`${reply.author.name} · ${reply.createdAt}\n${reply.body}`)
    expect(renderStaffComment({ ...reply, editedAt: '2026-09-19T10:20:00.000Z' })).toContain('· edited 2026-09-19T10:20:00.000Z')
    expect(renderStaffComment({ ...reply, deleted: true, body: '  ' })).toBe(`${reply.author.name} · ${reply.createdAt} · [deleted at source]\n${STAFF_EMPTY_TEXT}`)
  })
})
