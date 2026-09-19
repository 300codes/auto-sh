import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryCommentReply, DeliveryCommentThread, DeliveryProject } from '../data/entities'
import { commentThreadListQuerySchema } from '../data/validators'
import { buildDeliveryError, commentThreadListResponseSchema, commentThreadSchema, type CommentThread, type CommentThreadListResponse, type FlowStageId, type StaffLink } from '../lib/contracts'
import { deliveryHttpError, parseDeliveryInput, resolveDeliveryScope, type DeliveryScope } from './shared'
import { loadStaffLink, toStaffLink } from './staffLink'

async function requireProjectIncludingArchived(em: EntityManager, projectId: string, scope: DeliveryScope): Promise<void> {
  if (!scope?.tenantId || !scope.organizationId) throw new Error('[internal] deliveryOsCommentQueries requires tenant and organization')
  const row = await findOneWithDecryption(em, DeliveryProject, { id: projectId, tenantId: scope.tenantId, organizationId: scope.organizationId }, undefined, scope)
  if (!row) throw deliveryHttpError(buildDeliveryError('not_found', 'Not found'))
}

const MAX_SNAPSHOT_ROWS = 5000
function assertBounded(count: number) {
  if (count > MAX_SNAPSHOT_ROWS) throw deliveryHttpError(buildDeliveryError('validation_failed', 'Comment snapshot exceeds the bounded read limit', [{ path: 'threads', code: 'payload_too_large' }]))
}
function latestReplies(rows: DeliveryCommentReply[]): DeliveryCommentReply[] {
  const latest = new Map<string, DeliveryCommentReply>()
  for (const row of rows) {
    const key = `${row.threadId}:${row.commentKey}`
    if ((latest.get(key)?.revision ?? 0) < row.revision) latest.set(key, row)
  }
  return [...latest.values()].sort((left, right) => left.sourceCreatedAt.getTime() - right.sourceCreatedAt.getTime() || left.commentKey.localeCompare(right.commentKey))
}
async function readReplies(em: EntityManager, ids: string[], scope: DeliveryScope): Promise<DeliveryCommentReply[]> {
  if (ids.length === 0) return []
  const rows = await findWithDecryption(em, DeliveryCommentReply, { threadId: { $in: ids }, ...scope }, { limit: MAX_SNAPSHOT_ROWS + 1, orderBy: { id: 'asc' } }, scope)
  assertBounded(rows.length)
  return latestReplies(rows)
}
function serializeThread(row: DeliveryCommentThread, replies: DeliveryCommentReply[]) {
  return {
    threadId: row.id, threadKey: row.threadKey, source: row.source, fileKey: row.fileKey, stageId: row.stageId,
    artifactId: row.artifactId ?? null, nodeId: row.nodeId ?? null, sourceUrl: row.sourceUrl, author: row.author, body: row.body,
    sourceCreatedAt: row.sourceCreatedAt.toISOString(), sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    sourceStatus: row.sourceStatus, figmaVersion: row.figmaVersion ?? null, versionConfirmed: row.versionConfirmed,
    fetchedAt: row.fetchedAt.toISOString(), staffTaskId: row.staffTaskId ?? null, triageStatus: row.triageStatus,
    deferral: row.deferral ?? null, linkedDeliveryTaskId: row.linkedDeliveryTaskId ?? null, updatedAt: row.updatedAt.toISOString(),
    replies: replies.filter((reply) => reply.threadId === row.id).map((reply) => ({
      replyId: reply.id, commentKey: reply.commentKey, revision: reply.revision, author: reply.author, body: reply.body,
      sourceCreatedAt: reply.sourceCreatedAt.toISOString(), editedAt: reply.editedAt?.toISOString() ?? null,
      deleted: reply.deleted, staffCommentId: reply.staffCommentId ?? null, fetchedAt: reply.fetchedAt.toISOString(),
    })),
  }
}
export type DeliveryOsCommentQueries = {
  staffLink(projectId: string, scope: DeliveryScope): Promise<StaffLink | null>
  list(projectId: string, query: unknown, scope: DeliveryScope): Promise<CommentThreadListResponse>
  syncSnapshot(ctx: CommandRuntimeContext, input: { projectId: string; fileKey: string; stageId: FlowStageId }): Promise<{ threads: CommentThread[]; cursor: string | null }>
}
export function createDeliveryOsCommentQueries(rootEm: EntityManager): DeliveryOsCommentQueries {
  return {
    async staffLink(projectId, scope) {
      const em = rootEm.fork()
      await requireProjectIncludingArchived(em, projectId, scope)
      const row = await loadStaffLink(em, projectId, scope)
      return row ? toStaffLink(row) : null
    },
    async list(projectId, rawQuery, scope) {
      const em = rootEm.fork()
      await requireProjectIncludingArchived(em, projectId, scope)
      const query = parseDeliveryInput(commentThreadListQuerySchema, rawQuery)
      const where = { projectId, ...scope,
        ...(query.stageId ? { stageId: query.stageId } : {}),
        ...(query.status ? { sourceStatus: query.status } : {}),
        ...(query.triage ? { triageStatus: query.triage } : {}),
      }
      const rows = await findWithDecryption(em, DeliveryCommentThread, where, { limit: query.pageSize, offset: (query.page - 1) * query.pageSize, orderBy: { updatedAt: 'desc', id: 'desc' } }, scope)
      const replies = await readReplies(em, rows.map((row) => row.id), scope)
      return commentThreadListResponseSchema.parse({ items: rows.map((row) => serializeThread(row, replies)), total: await em.count(DeliveryCommentThread, where) })
    },
    async syncSnapshot(ctx, { projectId, fileKey, stageId }) {
      const scope = resolveDeliveryScope(ctx)
      const em = rootEm.fork()
      await requireProjectIncludingArchived(em, projectId, scope)
      const rows = await findWithDecryption(em, DeliveryCommentThread, { projectId, fileKey, stageId, source: 'figma', ...scope }, { limit: MAX_SNAPSHOT_ROWS + 1, orderBy: { id: 'asc' } }, scope)
      assertBounded(rows.length)
      const replies = await readReplies(em, rows.map((row) => row.id), scope)
      assertBounded(rows.length + replies.length)
      const link = await loadStaffLink(em, projectId, scope)
      const threads = rows.map((row) => commentThreadSchema.parse({
        threadKey: row.threadKey, nodeId: row.nodeId ?? null, sourceUrl: row.sourceUrl, author: row.author, body: row.body,
        createdAt: row.sourceCreatedAt.toISOString(), updatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
        status: row.sourceStatus, figmaVersion: row.figmaVersion ?? null,
        replies: replies.filter((reply) => reply.threadId === row.id).map((reply) => ({
          commentKey: reply.commentKey, author: reply.author, body: reply.body, createdAt: reply.sourceCreatedAt.toISOString(),
          editedAt: reply.editedAt?.toISOString() ?? null, deleted: reply.deleted,
        })),
      }))
      return { threads, cursor: link?.syncCursors?.[fileKey]?.cursor ?? null }
    },
  }
}
