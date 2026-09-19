import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { z } from 'zod'
import { DeliveryCommentReply, DeliveryCommentThread, DeliveryFlowStageArtifact, DeliveryTask } from '../data/entities'
import {
  commentImportCommandSchema,
  commentThreadTriageCommandSchema,
  type CommentImportCommandInput,
  type CommentThreadTriageCommandInput,
} from '../data/validators'
import {
  buildDeliveryError,
  buildDeliveryFlowError,
  figmaRefSchema,
  type CommentImportBatchV1,
  type CommentImportResult,
  type CommentThread,
  type CommentThreadTriageRequest,
  type CommentThreadTriageStatus,
} from '../lib/contracts'
import {
  advanceSyncCursor,
  bindThreadVersion,
  buildCommentImportResult,
  checkCommentImportBatch,
  hashCommentImportBatch,
  planCommentThread,
  renderStaffTask,
  type ArtifactFigmaBinding,
  type CommentThreadPlan,
  type StoredCommentReply,
  type StoredCommentThread,
} from '../lib/commentImport'
import { emitDeliveryOsEvent } from '../events'
import { requireIdempotencyKey } from './attempts'
import { loadStageArtifactRows } from './flowGate'
import { DELIVERY_STAFF_LINK_RESOURCE_KIND, loadStaffLink } from './staffLink'
import { DELIVERY_STAFF_KANBAN_ADAPTER_KEY, type DeliveryStaffKanbanAdapter, type StaffKanbanSession } from './staffKanbanAdapter'
import { requirePinnedTemplateStage } from './stages'
import {
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryFlowHttpError,
  deliveryHttpError,
  lockScopedProject,
  parseDeliveryInput,
  requireActorUserId,
  requireLockHeader,
  requireScopedProject,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'

export const DELIVERY_COMMENT_THREAD_RESOURCE_KIND = 'delivery_os.comment_thread'

export type CommentThreadTriageCommandResult = {
  threadId: string
  projectId: string
  triageStatus: CommentThreadTriageStatus
  updatedAt: string
}

function threadNotFound(): ReturnType<typeof deliveryHttpError> {
  return deliveryHttpError(buildDeliveryError('not_found', 'Comment thread not found', [{ path: 'threadId', code: 'not_found' }]))
}

function findScopedThread(em: EntityManager, input: { projectId: string; threadId: string }, scope: DeliveryScope, lock: boolean): Promise<DeliveryCommentThread | null> {
  return findOneWithDecryption(
    em,
    DeliveryCommentThread,
    { id: input.threadId, projectId: input.projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    scope,
  )
}

/**
 * A deferral is only meaningful for one artifact version: the artifact must belong to the thread's project and stage and
 * the stated hash must be its content hash, otherwise an approval could be unblocked by a deferral nobody reviewed.
 */
async function assertDeferralBinding(
  em: EntityManager,
  thread: DeliveryCommentThread,
  deferral: NonNullable<CommentThreadTriageRequest['deferral']>,
  scope: DeliveryScope,
): Promise<void> {
  const artifact = await findOneWithDecryption(
    em,
    DeliveryFlowStageArtifact,
    { id: deferral.artifactId, projectId: thread.projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  if (!artifact || artifact.stageId !== thread.stageId) {
    throw deliveryHttpError(
      buildDeliveryError('foreign_reference', 'Deferral artifact does not belong to this stage of the project', [
        { path: 'deferral.artifactId', code: 'foreign_artifact' },
      ]),
    )
  }
  if (artifact.contentHash !== deferral.contentHash) {
    throw deliveryHttpError(
      buildDeliveryError('hash_mismatch', 'Deferral hash does not match the artifact content hash', [
        { path: 'deferral.contentHash', code: 'hash_mismatch' },
      ]),
    )
  }
}

async function assertLinkedTask(em: EntityManager, projectId: string, taskId: string, scope: DeliveryScope): Promise<void> {
  const task = await findOneWithDecryption(
    em,
    DeliveryTask,
    { id: taskId, projectId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (task) return
  throw deliveryHttpError(
    buildDeliveryError('foreign_reference', 'Linked delivery task does not belong to this project', [
      { path: 'linkedDeliveryTaskId', code: 'foreign_task' },
    ]),
  )
}

/**
 * F13: triage is an allowed state mutation of a thread (replies and the imported source fields stay untouched). The
 * project row lock serialises it with a stage decision that reads and defers the same threads. The link
 * to a DeliveryTask is display only — moving the card or the task never verifies anything.
 */
const triageCommand: CommandHandler<CommentThreadTriageCommandInput, CommentThreadTriageCommandResult> = {
  id: 'delivery_os.comments.triage',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(commentThreadTriageCommandSchema, rawInput)
    const actor = requireActorUserId(ctx)
    const { triage } = parsed

    const probeEm = resolveDeliveryEm(ctx)
    await requireScopedProject(probeEm, parsed.projectId, scope)
    if (!(await findScopedThread(probeEm, parsed, scope, false))) throw threadNotFound()
    requireLockHeader(ctx)

    const em = resolveDeliveryEm(ctx)
    return em.transactional(async (tx) => {
      await lockScopedProject(tx, parsed.projectId, scope)
      const thread = await findScopedThread(tx, parsed, scope, true)
      if (!thread) throw threadNotFound()
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: DELIVERY_COMMENT_THREAD_RESOURCE_KIND,
        resourceId: thread.id,
        current: thread.updatedAt,
        request: ctx.request ?? null,
      })
      const deferred = triage.triageStatus === 'deferred' ? (triage.deferral ?? null) : null
      if (deferred) await assertDeferralBinding(tx, thread, deferred, scope)
      if (triage.linkedDeliveryTaskId) await assertLinkedTask(tx, thread.projectId, triage.linkedDeliveryTaskId, scope)

      const now = new Date()
      thread.triageStatus = triage.triageStatus
      thread.deferral = deferred
        ? { artifactId: deferred.artifactId, contentHash: deferred.contentHash, reason: deferred.reason, decidedBy: actor, decidedAt: now.toISOString() }
        : null
      if (triage.linkedDeliveryTaskId !== undefined) thread.linkedDeliveryTaskId = triage.linkedDeliveryTaskId
      thread.updatedAt = now
      return { threadId: thread.id, projectId: thread.projectId, triageStatus: thread.triageStatus, updatedAt: now.toISOString() }
    })
  },
  buildLog: async ({ result, ctx }) => {
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.comments.triage', 'Triage design comment thread'),
      resourceKind: DELIVERY_COMMENT_THREAD_RESOURCE_KIND,
      resourceId: result.threadId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: result,
    }
  },
}

registerCommand(triageCommand)

// --- F11: idempotent comment import -----------------------------------------

export type CommentImportCommandResult = CommentImportResult

type ThreadIds = { threadId: string; staffTaskId: string; replies: Map<string, string | null> }
/** Guards the retry: once a staff card or comment was written, a rollback must not be replayed blindly. */
type ThreadProgress = { staffWritten: boolean }
type ThreadImport = { plan: CommentThreadPlan; ids: ThreadIds | null }
type ThreadImportInput = {
  batch: CommentImportBatchV1
  thread: CommentThread
  staffProjectId: string
  statusId: string
  artifacts: readonly ArtifactFigmaBinding[]
}

const logger = createLogger('delivery_os')
const figmaRefsSchema = z.array(figmaRefSchema)

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toStoredReply(row: DeliveryCommentReply): StoredCommentReply {
  return {
    replyId: row.id,
    commentKey: row.commentKey,
    revision: row.revision,
    author: row.author,
    body: row.body,
    sourceCreatedAt: toIso(row.sourceCreatedAt),
    editedAt: row.editedAt ? toIso(row.editedAt) : null,
    deleted: row.deleted === true,
    staffCommentId: row.staffCommentId ?? null,
    fetchedAt: toIso(row.fetchedAt),
  }
}

function toStoredThread(row: DeliveryCommentThread): StoredCommentThread {
  return {
    threadId: row.id,
    threadKey: row.threadKey,
    source: row.source,
    fileKey: row.fileKey,
    stageId: row.stageId,
    artifactId: row.artifactId ?? null,
    nodeId: row.nodeId ?? null,
    sourceUrl: row.sourceUrl,
    author: row.author,
    body: row.body,
    sourceCreatedAt: toIso(row.sourceCreatedAt),
    sourceUpdatedAt: row.sourceUpdatedAt ? toIso(row.sourceUpdatedAt) : null,
    sourceStatus: row.sourceStatus,
    figmaVersion: row.figmaVersion ?? null,
    versionConfirmed: row.versionConfirmed === true,
    fetchedAt: toIso(row.fetchedAt),
    staffTaskId: row.staffTaskId ?? null,
    triageStatus: row.triageStatus,
    deferral: row.deferral ?? null,
    linkedDeliveryTaskId: row.linkedDeliveryTaskId ?? null,
    replies: [],
    updatedAt: toIso(row.updatedAt),
  }
}

function toArtifactBinding(row: DeliveryFlowStageArtifact): ArtifactFigmaBinding {
  const refs = figmaRefsSchema.safeParse((row.content as { figmaRefs?: unknown } | null)?.figmaRefs)
  return { id: row.id, stageId: row.stageId, version: row.version, figmaRefs: refs.success ? refs.data : [] }
}

/** The card text the stored thread was rendered with, so an import that only adds replies leaves the staff task alone. */
function storedStaffText(stored: StoredCommentThread): ReturnType<typeof renderStaffTask> {
  return renderStaffTask({
    thread: {
      threadKey: stored.threadKey,
      nodeId: stored.nodeId,
      sourceUrl: stored.sourceUrl,
      author: stored.author,
      body: stored.body,
      createdAt: stored.sourceCreatedAt,
      updatedAt: stored.sourceUpdatedAt,
      status: stored.sourceStatus,
      figmaVersion: stored.figmaVersion,
      replies: [],
    },
    batch: { stageId: stored.stageId, fileKey: stored.fileKey },
    artifactId: stored.artifactId,
    versionConfirmed: stored.versionConfirmed,
  })
}

function findThreadRow(tx: EntityManager, projectId: string, batch: CommentImportBatchV1, threadKey: string, scope: DeliveryScope, lock: boolean): Promise<DeliveryCommentThread | null> {
  return findOneWithDecryption(
    tx,
    DeliveryCommentThread,
    { projectId, source: batch.source, fileKey: batch.fileKey, threadKey, tenantId: scope.tenantId, organizationId: scope.organizationId },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    scope,
  )
}

function findReplyRows(tx: EntityManager, threadId: string, scope: DeliveryScope): Promise<DeliveryCommentReply[]> {
  return findWithDecryption(tx, DeliveryCommentReply, { threadId, tenantId: scope.tenantId, organizationId: scope.organizationId }, undefined, scope)
}

function tryResolveKanbanAdapter(ctx: CommandRuntimeContext): DeliveryStaffKanbanAdapter | null {
  try {
    const resolved = ctx.container.resolve(DELIVERY_STAFF_KANBAN_ADAPTER_KEY) as Partial<DeliveryStaffKanbanAdapter> | undefined
    return resolved && typeof resolved.createTask === 'function' ? (resolved as DeliveryStaffKanbanAdapter) : null
  } catch {
    return null
  }
}

function staffLinkRequired(detailCode: 'staff_link_required' | 'staff_module_unavailable', message: string): ReturnType<typeof deliveryFlowHttpError> {
  return deliveryFlowHttpError(buildDeliveryFlowError('staff_link_required', message, [{ path: 'projectId', code: detailCode }]))
}

/**
 * One transaction per thread: the project row lock serialises the import with a re-link and with stage approvals, the
 * thread row is inserted or locked first (a parallel import of the same key then waits or hits the unique index), the
 * staff writes join the same transaction through the adapter session, and the delivery rows are mutated last.
 */
async function importThreadOnce(
  ctx: CommandRuntimeContext,
  scope: DeliveryScope,
  adapter: DeliveryStaffKanbanAdapter,
  input: ThreadImportInput,
  progress: ThreadProgress,
): Promise<ThreadImport> {
  const { batch, thread } = input
  let session: StaffKanbanSession | null = null
  let committed = false
  try {
    const outcome = await resolveDeliveryEm(ctx).transactional(async (tx): Promise<ThreadImport> => {
      const project = await lockScopedProject(tx, batch.projectId, scope)
      const link = await loadStaffLink(tx, project.id, scope)
      if (!link || link.staffProjectId !== input.staffProjectId) throw new Error('[internal] staff link changed during the comment import')

      let row = await findThreadRow(tx, project.id, batch, thread.threadKey, scope, true)
      const replyRows = row ? await findReplyRows(tx, row.id, scope) : []
      const existing = row ? toStoredThread(row) : null
      const plan = planCommentThread({
        thread,
        batch,
        existing,
        existingReplies: replyRows.map(toStoredReply),
        binding: bindThreadVersion({ thread, batch, artifacts: input.artifacts }),
      })
      if (plan.outcome === 'skipped') return { plan, ids: null }

      const now = new Date()
      if (!row) {
        const draft = plan.draft
        if (!draft) throw new Error('[internal] a new comment thread has no draft')
        row = tx.create(DeliveryCommentThread, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          source: draft.source,
          fileKey: draft.fileKey,
          threadKey: draft.threadKey,
          stageId: draft.stageId,
          artifactId: draft.artifactId,
          nodeId: draft.nodeId,
          sourceUrl: draft.sourceUrl,
          author: draft.author,
          body: draft.body,
          sourceCreatedAt: new Date(draft.sourceCreatedAt),
          sourceUpdatedAt: draft.sourceUpdatedAt ? new Date(draft.sourceUpdatedAt) : null,
          sourceStatus: draft.sourceStatus,
          figmaVersion: draft.figmaVersion,
          versionConfirmed: draft.versionConfirmed,
          fetchedAt: new Date(draft.fetchedAt),
          staffTaskId: null,
          triageStatus: 'new',
          deferral: null,
          linkedDeliveryTaskId: null,
          createdAt: now,
          updatedAt: now,
        })
        tx.persist(row)
        await tx.flush()
      }

      session = { ctx, tx, scope }
      let staffTaskId = row.staffTaskId ?? null
      if (!staffTaskId) {
        progress.staffWritten = true
        staffTaskId = (await adapter.createTask({ staffProjectId: input.staffProjectId, statusId: input.statusId, ...plan.staff }, session)).taskId
      } else if (plan.outcome === 'updated' && existing) {
        const previous = storedStaffText(existing)
        if (previous.title !== plan.staff.title || previous.description !== plan.staff.description) {
          progress.staffWritten = true
          await adapter.updateTask({ taskId: staffTaskId, ...plan.staff }, session)
        }
      }

      const replyIds = new Map<string, string | null>()
      for (const reply of plan.replies) {
        if (!reply.draft) continue
        let staffCommentId = reply.existing?.staffCommentId ?? null
        progress.staffWritten = true
        if (staffCommentId) await adapter.updateComment({ commentId: staffCommentId, body: reply.staffBody }, session)
        else staffCommentId = (await adapter.createComment({ taskId: staffTaskId, body: reply.staffBody }, session)).commentId
        replyIds.set(reply.commentKey, staffCommentId)
      }

      for (const reply of plan.replies) {
        if (!reply.draft) continue
        tx.persist(
          tx.create(DeliveryCommentReply, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            threadId: row.id,
            commentKey: reply.draft.commentKey,
            revision: reply.draft.revision,
            author: reply.draft.author,
            body: reply.draft.body,
            sourceCreatedAt: new Date(reply.draft.sourceCreatedAt),
            editedAt: reply.draft.editedAt ? new Date(reply.draft.editedAt) : null,
            deleted: reply.draft.deleted,
            staffCommentId: replyIds.get(reply.commentKey) ?? null,
            fetchedAt: new Date(reply.draft.fetchedAt),
            createdAt: now,
          }),
        )
      }
      if (existing && plan.draft) {
        const draft = plan.draft
        row.artifactId = draft.artifactId
        row.nodeId = draft.nodeId
        row.sourceUrl = draft.sourceUrl
        row.author = draft.author
        row.body = draft.body
        row.sourceUpdatedAt = draft.sourceUpdatedAt ? new Date(draft.sourceUpdatedAt) : null
        row.sourceStatus = draft.sourceStatus
        row.figmaVersion = draft.figmaVersion
        row.versionConfirmed = draft.versionConfirmed
        row.fetchedAt = new Date(draft.fetchedAt)
        if (plan.triageStatus === 'new' && existing.triageStatus !== 'new') row.deferral = null
        row.triageStatus = plan.triageStatus
      }
      if (row.staffTaskId !== staffTaskId) row.staffTaskId = staffTaskId
      if (plan.outcome !== 'unchanged' || !existing?.staffTaskId) row.updatedAt = now
      await tx.flush()
      return { plan, ids: { threadId: row.id, staffTaskId, replies: replyIds } }
    })
    committed = true
    return outcome
  } finally {
    const settled = session as StaffKanbanSession | null
    if (settled && adapter.settle) {
      try {
        await adapter.settle(settled, committed)
      } catch (error) {
        logger.warn('staff side effects of an imported comment thread were not flushed', { err: error })
        getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.comment_import_settle_failed' })
      }
    }
  }
}

/**
 * A lost insert race surfaces as a unique violation that aborts the transaction before any staff write; the retry then
 * locks the winner's row and reports `unchanged`/`updated`. A violation raised after a staff card or comment was already
 * written is NOT retried — replaying it would create a second card — so the thread is reported as failed instead.
 */
async function importThread(
  ctx: CommandRuntimeContext,
  scope: DeliveryScope,
  adapter: DeliveryStaffKanbanAdapter,
  input: ThreadImportInput,
): Promise<ThreadImport> {
  const progress: ThreadProgress = { staffWritten: false }
  try {
    return await importThreadOnce(ctx, scope, adapter, input, progress)
  } catch (error) {
    if (!isUniqueViolation(error) || progress.staffWritten) throw error
    return importThreadOnce(ctx, scope, adapter, input, { staffWritten: false })
  }
}

/** Replay and skipped threads answer from the stored rows; nothing is written. */
async function planStoredThread(em: EntityManager, scope: DeliveryScope, input: Omit<ThreadImportInput, 'staffProjectId' | 'statusId'>): Promise<ThreadImport> {
  const { batch, thread } = input
  const row = await findThreadRow(em, batch.projectId, batch, thread.threadKey, scope, false)
  const replyRows = row ? await findReplyRows(em, row.id, scope) : []
  const plan = planCommentThread({
    thread,
    batch,
    existing: row ? toStoredThread(row) : null,
    existingReplies: replyRows.map(toStoredReply),
    binding: bindThreadVersion({ thread, batch, artifacts: input.artifacts }),
  })
  const ids = row?.staffTaskId ? { threadId: row.id, staffTaskId: row.staffTaskId, replies: new Map<string, string | null>() } : null
  return { plan, ids }
}

function assembleResult(batch: CommentImportBatchV1, imports: readonly ThreadImport[], failedThreadKeys: readonly string[], replayed: boolean): CommentImportResult {
  const ids = new Map<string, ThreadIds>()
  const failed = new Set(failedThreadKeys)
  for (const entry of imports) {
    if (entry.ids) ids.set(entry.plan.threadKey, entry.ids)
    else if (entry.plan.outcome !== 'skipped') failed.add(entry.plan.threadKey)
  }
  return buildCommentImportResult({ batch, plans: imports.map((entry) => entry.plan), ids, failedThreadKeys: [...failed], replayed })
}

async function storeSyncCursor(
  ctx: CommandRuntimeContext,
  scope: DeliveryScope,
  input: { batch: CommentImportBatchV1; idempotencyKey: string; batchHash: string; plans: readonly CommentThreadPlan[]; failedThreadKeys: readonly string[] },
): Promise<void> {
  const { batch } = input
  await resolveDeliveryEm(ctx).transactional(async (tx) => {
    await lockScopedProject(tx, batch.projectId, scope)
    const link = await loadStaffLink(tx, batch.projectId, scope, true)
    if (!link) return
    const now = new Date()
    const cursors = link.syncCursors ?? {}
    link.syncCursors = {
      ...cursors,
      [batch.fileKey]: advanceSyncCursor({
        stored: cursors[batch.fileKey] ?? null,
        batch,
        idempotencyKey: input.idempotencyKey,
        batchHash: input.batchHash,
        plans: input.plans,
        failedThreadKeys: input.failedThreadKeys,
        now: now.toISOString(),
      }),
    }
    link.updatedAt = now
  })
}

/**
 * F11: imports one normalized page of source comments. One thread is one staff card and one reply is one staff comment;
 * every thread commits on its own, the file cursor and the batch key move only when all of them succeeded, and the staff
 * board is reached only through the `deliveryStaffKanbanAdapter` seam.
 */
const importCommand: CommandHandler<CommentImportCommandInput, CommentImportCommandResult> = {
  id: 'delivery_os.comments.import',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    requireIdempotencyKey(rawInput)
    const parsed = parseDeliveryInput(commentImportCommandSchema, rawInput)
    requireActorUserId(ctx)
    const { batch } = parsed

    const probeEm = resolveDeliveryEm(ctx)
    const project = await requireScopedProject(probeEm, parsed.projectId, scope)
    const link = await loadStaffLink(probeEm, project.id, scope)
    if (!link) throw staffLinkRequired('staff_link_required', 'Link the delivery project to a staff project before importing comments')
    requirePinnedTemplateStage(project, batch.stageId)
    const artifactRows = await loadStageArtifactRows(probeEm, project.id, scope)
    if (batch.artifactId && !artifactRows.some((artifact) => artifact.id === batch.artifactId && artifact.stageId === batch.stageId)) {
      throw deliveryHttpError(
        buildDeliveryError('foreign_reference', 'Comment batch artifact does not belong to this stage of the project', [
          { path: 'batch.artifactId', code: 'foreign_artifact' },
        ]),
      )
    }
    const artifacts = artifactRows.map(toArtifactBinding)

    const batchHash = hashCommentImportBatch(batch)
    const check = checkCommentImportBatch({ stored: link.syncCursors?.[batch.fileKey] ?? null, batch, idempotencyKey: parsed.idempotencyKey, batchHash })
    if (check.kind === 'idempotency_conflict') {
      throw deliveryHttpError(
        buildDeliveryError('idempotency_conflict', 'The Idempotency-Key was used with another comment batch', [
          { path: 'idempotencyKey', code: 'idempotency_conflict' },
        ]),
      )
    }
    if (check.kind === 'sync_cursor_conflict') {
      throw deliveryFlowHttpError(
        buildDeliveryFlowError('sync_cursor_conflict', 'The batch does not continue the stored cursor of this file', [
          { path: 'batch.cursor.after', code: 'sync_cursor_conflict', message: check.expected ?? 'null' },
        ]),
      )
    }
    if (check.kind === 'replay') {
      const stored: ThreadImport[] = []
      for (const thread of batch.threads) stored.push(await planStoredThread(probeEm, scope, { batch, thread, artifacts }))
      return assembleResult(batch, stored, [], true)
    }

    const adapter = tryResolveKanbanAdapter(ctx)
    if (!adapter) throw staffLinkRequired('staff_module_unavailable', 'The staff time-tracking module is not available')
    const statusId = await adapter.resolveDefaultStatusId(link.staffProjectId, { ctx, tx: probeEm, scope })

    const imports: ThreadImport[] = []
    const failedThreadKeys: string[] = []
    for (const thread of batch.threads) {
      const input = { batch, thread, artifacts }
      try {
        if (!statusId) throw new Error('[internal] the linked staff project has no task status column')
        imports.push(await importThread(ctx, scope, adapter, { ...input, staffProjectId: link.staffProjectId, statusId }))
      } catch (error) {
        logger.warn('comment thread import failed', { err: error, projectId: project.id, threadKey: thread.threadKey })
        getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.comment_import_thread_failed' })
        failedThreadKeys.push(thread.threadKey)
        imports.push({ ...(await planStoredThread(resolveDeliveryEm(ctx), scope, input)), ids: null })
      }
    }

    const plans = imports.map((entry) => entry.plan)
    await storeSyncCursor(ctx, scope, { batch, idempotencyKey: parsed.idempotencyKey, batchHash, plans, failedThreadKeys })

    for (const entry of imports) {
      if (!entry.ids || (entry.plan.outcome !== 'created' && entry.plan.outcome !== 'updated')) continue
      await emitDeliveryOsEvent(
        'delivery_os.comment_thread.imported',
        {
          projectId: project.id,
          threadId: entry.ids.threadId,
          staffTaskId: entry.ids.staffTaskId,
          outcome: entry.plan.outcome,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
    }
    return assembleResult(batch, imports, failedThreadKeys, false)
  },
  buildLog: async ({ result, ctx }) => {
    if (result.replayed) return null
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.comments.import', 'Import design comments'),
      resourceKind: DELIVERY_STAFF_LINK_RESOURCE_KIND,
      resourceId: result.projectId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: { fileKey: result.fileKey, stageId: result.stageId, cursor: result.cursor, counts: result.counts },
    }
  },
}

registerCommand(importCommand)
