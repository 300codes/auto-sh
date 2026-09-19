import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DeliveryCommentThread, DeliveryFlowStageArtifact, DeliveryTask } from '../data/entities'
import { commentThreadTriageCommandSchema, type CommentThreadTriageCommandInput } from '../data/validators'
import { buildDeliveryError, type CommentThreadTriageRequest, type CommentThreadTriageStatus } from '../lib/contracts'
import {
  DELIVERY_PROJECT_RESOURCE_KIND,
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
