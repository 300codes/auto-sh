import {
  commentImportResultSchema,
  type CommentImportBatchV1,
  type CommentImportResult,
  type CommentReply,
  type CommentThread,
  type CommentThreadListItem,
  type CommentThreadReplyItem,
  type FigmaRef,
  type FlowStageId,
  type StaffSyncCursor,
} from './contracts'
import { hashCanonical } from './hash'
import type { CommentThreadRecord } from './stageDecisions'

export type StoredCommentThread = CommentThreadListItem
export type StoredCommentReply = CommentThreadReplyItem
export type StoredSyncCursor = StaffSyncCursor
export type ArtifactFigmaBinding = { id: string; stageId: FlowStageId; version: number; figmaRefs: readonly FigmaRef[] }

export type CommentThreadDraft = Omit<StoredCommentThread, 'threadId' | 'staffTaskId' | 'updatedAt' | 'deferral' | 'linkedDeliveryTaskId' | 'replies'>
export type CommentReplyDraft = Omit<StoredCommentReply, 'replyId' | 'staffCommentId'>
export type CommentThreadTriage = StoredCommentThread['triageStatus']
export type ThreadVersionBinding = { artifactId: string | null; versionConfirmed: boolean }
export type StaffTaskText = { title: string; description: string }
export type CommentImportChange = 'created' | 'updated' | 'unchanged'

export type CommentReplyPlan = {
  commentKey: string
  outcome: CommentImportChange
  revision: number
  draft: CommentReplyDraft | null
  existing: StoredCommentReply | null
  staffBody: string
}

export type CommentThreadPlan =
  | {
      threadKey: string
      outcome: CommentImportChange
      existing: StoredCommentThread | null
      draft: CommentThreadDraft | null
      triageStatus: CommentThreadTriage
      versionConfirmed: boolean
      artifactId: string | null
      staff: StaffTaskText
      replies: CommentReplyPlan[]
    }
  | { threadKey: string; outcome: 'skipped'; reason: 'stage_mismatch'; existing: StoredCommentThread }

export type CommentImportCheck =
  | { kind: 'replay' }
  | { kind: 'idempotency_conflict' }
  | { kind: 'sync_cursor_conflict'; expected: string | null }
  | { kind: 'proceed' }

export type CommentImportCounts = CommentImportResult['counts']
export type CommentImportIds = ReadonlyMap<string, { threadId: string; staffTaskId: string; replies: ReadonlyMap<string, string | null> }>

export const STAFF_TRUNCATION_MARKER = '… [truncated]'
export const STAFF_TITLE_MAX = 255
export const STAFF_DESCRIPTION_MAX = 8000
export const STAFF_COMMENT_MAX = 5000
export const STAFF_EMPTY_TEXT = '(no text)'

/** The F8 blocking rule consumes the stored thread shape unchanged; this is the single mapping point. */
export function asCommentThreadRecord(thread: StoredCommentThread): CommentThreadRecord {
  return thread
}

export function hashCommentImportBatch(batch: CommentImportBatchV1): string {
  return hashCanonical(batch)
}

/** Replay (same key, same hash) wins over the cursor check so a retried batch is answered even after the cursor moved. */
export function checkCommentImportBatch(input: { stored: StoredSyncCursor | null; batch: CommentImportBatchV1; idempotencyKey: string; batchHash: string }): CommentImportCheck {
  const { stored, batch } = input
  if (stored && stored.lastBatchKey === input.idempotencyKey) {
    return stored.lastBatchHash === input.batchHash ? { kind: 'replay' } : { kind: 'idempotency_conflict' }
  }
  const expected = stored?.cursor ?? null
  if (expected !== batch.cursor.after) return { kind: 'sync_cursor_conflict', expected }
  return { kind: 'proceed' }
}

/** Binds to the highest artifact version of the batch stage that carries the thread's Figma version; never the latest approved. */
export function bindThreadVersion(input: {
  thread: CommentThread
  batch: Pick<CommentImportBatchV1, 'fileKey' | 'stageId' | 'artifactId'>
  artifacts: readonly ArtifactFigmaBinding[]
}): ThreadVersionBinding {
  const { thread, batch } = input
  const unconfirmed = { artifactId: batch.artifactId, versionConfirmed: false }
  if (thread.figmaVersion === null) return unconfirmed
  let match: ArtifactFigmaBinding | null = null
  for (const artifact of input.artifacts) {
    if (artifact.stageId !== batch.stageId) continue
    const carries = artifact.figmaRefs.some((ref) => ref.fileKey === batch.fileKey && ref.figmaVersion === thread.figmaVersion)
    if (carries && (!match || artifact.version > match.version)) match = artifact
  }
  return match ? { artifactId: match.id, versionConfirmed: true } : unconfirmed
}

export function latestReplyRevisions(replies: readonly StoredCommentReply[]): Map<string, StoredCommentReply> {
  const latest = new Map<string, StoredCommentReply>()
  for (const reply of replies) {
    const current = latest.get(reply.commentKey)
    if (!current || reply.revision > current.revision) latest.set(reply.commentKey, reply)
  }
  return latest
}

export function truncateForStaff(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return STAFF_EMPTY_TEXT
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, Math.max(0, max - STAFF_TRUNCATION_MARKER.length))
  const lastUnit = cut.charCodeAt(cut.length - 1)
  const whole = lastUnit >= 0xd800 && lastUnit <= 0xdbff ? cut.slice(0, -1) : cut
  return whole.trimEnd() + STAFF_TRUNCATION_MARKER
}

/** Stored timestamps come back as `toISOString()`, the source may send an offset or no milliseconds; only the instant counts. */
export function sameInstant(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftValue = left ?? null
  const rightValue = right ?? null
  if (leftValue === null || rightValue === null) return leftValue === rightValue
  return Date.parse(leftValue) === Date.parse(rightValue)
}

function bodyText(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > 0 ? trimmed : STAFF_EMPTY_TEXT
}

export function renderStaffTask(input: {
  thread: CommentThread
  batch: Pick<CommentImportBatchV1, 'stageId' | 'fileKey'>
  artifactId: string | null
  versionConfirmed: boolean
}): StaffTaskText {
  const { thread, batch } = input
  const firstLine = thread.body.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  const header = [
    `Source: ${thread.sourceUrl}`,
    `Author: ${thread.author.name}`,
    `Date: ${thread.createdAt}`,
    `Stage: ${batch.stageId}`,
    `Artifact: ${input.artifactId ?? 'none'} · ${input.versionConfirmed ? 'version confirmed' : 'version unconfirmed'}`,
    `Figma version: ${thread.figmaVersion ?? 'unknown'}`,
  ]
  return {
    title: truncateForStaff(firstLine, STAFF_TITLE_MAX),
    description: truncateForStaff(`${header.join('\n')}\n\n${bodyText(thread.body)}`, STAFF_DESCRIPTION_MAX),
  }
}

export function renderStaffComment(reply: CommentReply): string {
  const state = reply.deleted ? ' · [deleted at source]' : reply.editedAt ? ` · edited ${reply.editedAt}` : ''
  return truncateForStaff(`${reply.author.name} · ${reply.createdAt}${state}\n${bodyText(reply.body)}`, STAFF_COMMENT_MAX)
}

/** A changed body, edit time or deletion flag is a new revision; a deletion keeps every row and only flags the latest. */
export function planCommentReply(incoming: CommentReply, latest: StoredCommentReply | null, fetchedAt: string): CommentReplyPlan {
  const staffBody = renderStaffComment(incoming)
  const changed = !latest || latest.body !== incoming.body || !sameInstant(latest.editedAt, incoming.editedAt) || latest.deleted !== incoming.deleted
  if (latest && !changed) {
    return { commentKey: incoming.commentKey, outcome: 'unchanged', revision: latest.revision, draft: null, existing: latest, staffBody }
  }
  const revision = latest ? latest.revision + 1 : 1
  const draft: CommentReplyDraft = {
    commentKey: incoming.commentKey,
    revision,
    author: incoming.author,
    body: incoming.body,
    sourceCreatedAt: incoming.createdAt,
    editedAt: incoming.editedAt,
    deleted: incoming.deleted,
    fetchedAt,
  }
  return { commentKey: incoming.commentKey, outcome: latest ? 'updated' : 'created', revision, draft, existing: latest, staffBody }
}

function threadContentChanged(thread: CommentThread, existing: StoredCommentThread, binding: ThreadVersionBinding): boolean {
  return (
    existing.body !== thread.body ||
    existing.sourceStatus !== thread.status ||
    !sameInstant(existing.sourceUpdatedAt, thread.updatedAt) ||
    existing.author.name !== thread.author.name ||
    existing.author.externalId !== thread.author.externalId ||
    existing.author.email !== thread.author.email ||
    existing.nodeId !== thread.nodeId ||
    existing.sourceUrl !== thread.sourceUrl ||
    existing.figmaVersion !== thread.figmaVersion ||
    existing.artifactId !== binding.artifactId ||
    existing.versionConfirmed !== binding.versionConfirmed
  )
}

function nextTriageStatus(thread: CommentThread, existing: StoredCommentThread | null, replies: readonly CommentReplyPlan[]): CommentThreadTriage {
  if (!existing) return 'new'
  const reopened = existing.sourceStatus !== 'open' && thread.status === 'open'
  if (reopened || replies.some((reply) => reply.outcome === 'created')) return 'new'
  return existing.triageStatus
}

/** Source `resolved`/`deleted` never changes triage; only creation, a reopen or a new reply resets it to `new`. */
export function planCommentThread(input: {
  thread: CommentThread
  batch: CommentImportBatchV1
  existing: StoredCommentThread | null
  existingReplies: readonly StoredCommentReply[]
  binding: ThreadVersionBinding
}): CommentThreadPlan {
  const { thread, batch, existing, binding } = input
  if (existing && existing.stageId !== batch.stageId) {
    return { threadKey: thread.threadKey, outcome: 'skipped', reason: 'stage_mismatch', existing }
  }
  const latest = latestReplyRevisions(input.existingReplies)
  const replies = thread.replies.map((reply) => planCommentReply(reply, latest.get(reply.commentKey) ?? null, batch.fetchedAt))
  const changed = !existing || threadContentChanged(thread, existing, binding) || replies.some((reply) => reply.outcome !== 'unchanged')
  const triageStatus = nextTriageStatus(thread, existing, replies)
  const staff = renderStaffTask({ thread, batch, artifactId: binding.artifactId, versionConfirmed: binding.versionConfirmed })
  const shared = { threadKey: thread.threadKey, existing, triageStatus, versionConfirmed: binding.versionConfirmed, artifactId: binding.artifactId, staff, replies }
  if (existing && !changed) return { ...shared, outcome: 'unchanged', draft: null }
  const draft: CommentThreadDraft = {
    threadKey: thread.threadKey,
    source: batch.source,
    fileKey: batch.fileKey,
    stageId: batch.stageId,
    artifactId: binding.artifactId,
    nodeId: thread.nodeId,
    sourceUrl: thread.sourceUrl,
    author: thread.author,
    body: thread.body,
    sourceCreatedAt: thread.createdAt,
    sourceUpdatedAt: thread.updatedAt,
    sourceStatus: thread.status,
    figmaVersion: thread.figmaVersion,
    versionConfirmed: binding.versionConfirmed,
    fetchedAt: batch.fetchedAt,
    triageStatus,
  }
  return { ...shared, outcome: existing ? 'updated' : 'created', draft }
}

/** `existingThreads` are the caller's rows of the same project; identity is `(source, fileKey, threadKey)`. */
export function planCommentImport(input: {
  batch: CommentImportBatchV1
  existingThreads: readonly StoredCommentThread[]
  existingRepliesByThreadId: ReadonlyMap<string, readonly StoredCommentReply[]>
  artifacts: readonly ArtifactFigmaBinding[]
}): CommentThreadPlan[] {
  const { batch } = input
  const existingByKey = new Map<string, StoredCommentThread>()
  for (const candidate of input.existingThreads) {
    if (candidate.fileKey === batch.fileKey && candidate.source === batch.source) existingByKey.set(candidate.threadKey, candidate)
  }
  return batch.threads.map((thread) => {
    const existing = existingByKey.get(thread.threadKey) ?? null
    const existingReplies = existing ? (input.existingRepliesByThreadId.get(existing.threadId) ?? []) : []
    const binding = bindThreadVersion({ thread, batch, artifacts: input.artifacts })
    return planCommentThread({ thread, batch, existing, existingReplies, binding })
  })
}

const SYNC_ERROR_KEYS_MAX = 20

function syncError(label: string, keys: readonly string[]): string {
  const listed = keys.slice(0, SYNC_ERROR_KEYS_MAX).join(', ')
  return `${keys.length} thread(s) ${label}: ${listed}${keys.length > SYNC_ERROR_KEYS_MAX ? ', …' : ''}`
}

/**
 * A failed thread write (`failedThreadKeys`, reported by the command) keeps the cursor and forgets the key so a retry is a fresh import.
 * A `stage_mismatch` skip is deterministic, so it never blocks the file: the cursor moves and `lastError` names the skipped threads.
 */
export function advanceSyncCursor(input: {
  stored: StoredSyncCursor | null
  batch: CommentImportBatchV1
  idempotencyKey: string
  batchHash: string
  plans: readonly CommentThreadPlan[]
  failedThreadKeys?: readonly string[]
  now: string
}): StoredSyncCursor {
  const failed = input.failedThreadKeys ?? []
  if (failed.length > 0) {
    return { cursor: input.stored?.cursor ?? null, lastBatchKey: null, lastBatchHash: null, lastSyncAt: input.now, lastError: syncError('failed', failed) }
  }
  const skipped = input.plans.filter((plan) => plan.outcome === 'skipped').map((plan) => plan.threadKey)
  return {
    cursor: input.batch.cursor.next,
    lastBatchKey: input.idempotencyKey,
    lastBatchHash: input.batchHash,
    lastSyncAt: input.now,
    lastError: skipped.length > 0 ? syncError('skipped (stage mismatch)', skipped) : null,
  }
}

export function summarizeCommentImport(plans: readonly CommentThreadPlan[], failedThreadKeys: readonly string[] = []): CommentImportCounts {
  const counts: CommentImportCounts = { threadsCreated: 0, threadsUpdated: 0, repliesCreated: 0, repliesUpdated: 0, skipped: 0 }
  const failed = new Set(failedThreadKeys)
  for (const plan of plans) {
    if (plan.outcome === 'skipped' || failed.has(plan.threadKey)) {
      counts.skipped += 1
      continue
    }
    if (plan.outcome === 'created') counts.threadsCreated += 1
    if (plan.outcome === 'updated') counts.threadsUpdated += 1
    for (const reply of plan.replies) {
      if (reply.outcome === 'created') counts.repliesCreated += 1
      if (reply.outcome === 'updated') counts.repliesUpdated += 1
    }
  }
  return counts
}

/** A skipped or failed thread is listed only when it already has a card (the frozen result needs both ids); otherwise it is only counted. */
export function buildCommentImportResult(input: {
  batch: CommentImportBatchV1
  plans: readonly CommentThreadPlan[]
  ids: CommentImportIds
  failedThreadKeys?: readonly string[]
  replayed: boolean
}): CommentImportResult {
  const { batch } = input
  const failed = new Set(input.failedThreadKeys ?? [])
  const threads = input.plans.flatMap((plan): CommentImportResult['threads'] => {
    if (plan.outcome === 'skipped' || failed.has(plan.threadKey)) {
      const stored = plan.existing
      if (!stored || stored.staffTaskId === null) return []
      return [{ threadKey: plan.threadKey, threadId: stored.threadId, staffTaskId: stored.staffTaskId, versionConfirmed: stored.versionConfirmed, outcome: 'skipped', replies: [] }]
    }
    const ids = input.ids.get(plan.threadKey)
    if (!ids) throw new Error(`[internal] no persisted ids for thread ${plan.threadKey}`)
    return [{
      threadKey: plan.threadKey,
      threadId: ids.threadId,
      staffTaskId: ids.staffTaskId,
      versionConfirmed: plan.versionConfirmed,
      outcome: plan.outcome,
      replies: plan.replies.map((reply) => ({
        commentKey: reply.commentKey,
        staffCommentId: ids.replies.get(reply.commentKey) ?? reply.existing?.staffCommentId ?? null,
        outcome: reply.outcome,
      })),
    }]
  })
  return commentImportResultSchema.parse({
    projectId: batch.projectId,
    fileKey: batch.fileKey,
    stageId: batch.stageId,
    cursor: batch.cursor,
    counts: summarizeCommentImport(input.plans, input.failedThreadKeys),
    threads,
    replayed: input.replayed,
  })
}
