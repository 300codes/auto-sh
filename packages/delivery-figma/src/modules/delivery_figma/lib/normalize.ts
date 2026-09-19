import { commentThreadSchema, type CommentThread, type CommentReply } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { FigmaComment } from './client'
import { FigmaReadError } from './client'

export function normalizeFigmaComments(
  fileKey: string,
  comments: FigmaComment[],
  previous: CommentThread[],
  fetchedAt: string,
): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]))
  if (byId.size !== comments.length) throw new FigmaReadError('figma_response_invalid')
  const oldById = new Map(previous.map((thread) => [thread.threadKey, thread]))
  const roots = comments.filter((comment) => !comment.parent_id)
  for (const comment of comments) {
    if (comment.parent_id && (!byId.has(comment.parent_id) || byId.get(comment.parent_id)?.parent_id)) {
      throw new FigmaReadError('figma_response_invalid')
    }
  }
  const result = roots.map((root): CommentThread => {
    const old = oldById.get(root.id)
    const oldReplies = new Map(old?.replies.map((reply) => [reply.commentKey, reply]) ?? [])
    const replies: CommentReply[] = comments.filter((comment) => comment.parent_id === root.id).map((reply) => {
      const previousReply = oldReplies.get(reply.id)
      return {
        commentKey: reply.id,
        author: { name: reply.user.handle, externalId: reply.user.id, email: null },
        body: reply.message,
        createdAt: new Date(reply.created_at).toISOString(),
        editedAt: previousReply?.body !== undefined && previousReply.body !== reply.message ? fetchedAt : previousReply?.editedAt ?? null,
        deleted: false,
      }
    })
    const present = new Set(replies.map((reply) => reply.commentKey))
    for (const reply of old?.replies ?? []) {
      if (!present.has(reply.commentKey)) replies.push({ ...reply, deleted: true })
    }
    return commentThreadSchema.parse({
      threadKey: root.id,
      nodeId: root.client_meta?.node_id ?? null,
      sourceUrl: `https://www.figma.com/design/${encodeURIComponent(fileKey)}?comment-id=${encodeURIComponent(root.id)}`,
      author: { name: root.user.handle, externalId: root.user.id, email: null },
      body: root.message,
      createdAt: new Date(root.created_at).toISOString(),
      updatedAt: old && old.body !== root.message ? fetchedAt : old?.updatedAt ?? null,
      status: root.resolved_at ? 'resolved' : 'open',
      figmaVersion: null,
      replies: replies.sort((left, right) => left.commentKey.localeCompare(right.commentKey)),
    })
  })
  for (const old of previous) {
    if (!byId.has(old.threadKey)) result.push(commentThreadSchema.parse({ ...old, status: 'deleted', figmaVersion: null,
      replies: old.replies.map((reply) => ({ ...reply, deleted: true })) }))
  }
  return result.sort((left, right) => left.threadKey.localeCompare(right.threadKey))
}
