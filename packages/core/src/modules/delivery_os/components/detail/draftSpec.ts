import { draftSpecV1Schema, type DraftSpecV1 } from '@open-mercato/core/modules/delivery_os/data/validators'
import type { ScreenRef } from '@open-mercato/core/modules/delivery_os/lib/contracts'

export type DraftComment = DraftSpecV1['comments'][number]

/**
 * `PUT /api/delivery_os/projects` replaces the whole `draftSpec`, so every edit
 * is read → parse → mutate → write. A draft that does not parse must NOT be
 * overwritten with a clean object: that would delete fields this UI does not
 * understand. It blocks the edit and says why instead.
 */
export type DraftSpecRead = { ok: true; draft: DraftSpecV1 } | { ok: false; reason: 'unparsable' }

export function readDraftSpec(value: unknown): DraftSpecRead {
  const parsed = draftSpecV1Schema.safeParse(value ?? {})
  return parsed.success ? { ok: true, draft: parsed.data } : { ok: false, reason: 'unparsable' }
}

export function appendScreen(draft: DraftSpecV1, screen: ScreenRef): DraftSpecV1 {
  // One attachment is one screen. Re-adding the same render replaces the entry
  // rather than duplicating it — the server rejects duplicate attachment ids.
  const withoutSameAttachment = draft.screens.filter((existing) => existing.attachmentId !== screen.attachmentId)
  return { ...draft, screens: [...withoutSameAttachment, screen] }
}

export function removeScreen(draft: DraftSpecV1, attachmentId: string): DraftSpecV1 {
  return {
    ...draft,
    screens: draft.screens.filter((screen) => screen.attachmentId !== attachmentId),
    comments: draft.comments.filter((comment) => comment.screenAttachmentId !== attachmentId),
  }
}

export type NewComment = { id: string; screenAttachmentId: string; body: string }

export type CommentAppendResult = { ok: true; draft: DraftSpecV1 } | { ok: false; reason: 'unknown_screen' | 'duplicate_id' }

export function appendComment(draft: DraftSpecV1, comment: NewComment): CommentAppendResult {
  if (!draft.screens.some((screen) => screen.attachmentId === comment.screenAttachmentId)) {
    return { ok: false, reason: 'unknown_screen' }
  }
  if (draft.comments.some((existing) => existing.id === comment.id)) return { ok: false, reason: 'duplicate_id' }
  return {
    ok: true,
    draft: {
      ...draft,
      comments: [...draft.comments, {
        id: comment.id,
        screenAttachmentId: comment.screenAttachmentId,
        anchor: null,
        body: comment.body,
        status: 'open',
      }],
    },
  }
}

export function resolveComment(draft: DraftSpecV1, commentId: string, resolution: string): DraftSpecV1 {
  return {
    ...draft,
    comments: draft.comments.map((comment) => (
      comment.id === commentId ? { ...comment, status: 'resolved' as const, resolution } : comment
    )),
  }
}

export function countOpenComments(draft: DraftSpecV1): number {
  return draft.comments.filter((comment) => comment.status === 'open').length
}

/**
 * Comment ids are stable ids (`^[A-Za-z][A-Za-z0-9._-]{0,63}$`), so a raw UUID
 * would be refused for starting with a digit. The prefix also makes the origin
 * of the id readable in the frozen baseline.
 */
export function nextCommentId(draft: DraftSpecV1): string {
  const used = new Set(draft.comments.map((comment) => comment.id))
  let index = draft.comments.length + 1
  while (used.has(`C-${index}`)) index += 1
  return `C-${index}`
}
