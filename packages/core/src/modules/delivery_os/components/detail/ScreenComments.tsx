'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { DraftSpecV1 } from '@open-mercato/core/modules/delivery_os/data/validators'
import { appendComment, nextCommentId, resolveComment } from './draftSpec'
import { useDraftMutation } from './useDraftMutation'

export type ScreenCommentsProps = {
  projectId: string
  projectUpdatedAt: string | null
  draft: DraftSpecV1 | null
  screenAttachmentId: string
  onSaved: (projectUpdatedAt: string) => void
}

const CONTEXT_ID = 'delivery-project-screen-comments'

/**
 * A comment belongs to the draft, not to the frozen baseline. Freezing moves the
 * resolved ones into `content.resolvedComments` and returns the open ones as
 * `openCommentIds` — so an open comment is a state the operator has to see, not
 * a blocker the UI can hide.
 */
export function ScreenComments({ projectId, projectUpdatedAt, draft, screenAttachmentId, onSaved }: ScreenCommentsProps) {
  const t = useT()
  const [body, setBody] = React.useState('')
  const [resolutionFor, setResolutionFor] = React.useState<string | null>(null)
  const [resolution, setResolution] = React.useState('')
  const [problem, setProblem] = React.useState<string | null>(null)
  const { applyDraftMutation } = useDraftMutation(projectId, projectUpdatedAt, CONTEXT_ID)

  const comments = React.useMemo(
    () => (draft?.comments ?? []).filter((comment) => comment.screenAttachmentId === screenAttachmentId),
    [draft, screenAttachmentId],
  )

  const reportFailure = React.useCallback((reason: string, cause?: string) => {
    setProblem(
      reason === 'unparsable' ? t('delivery_os.project.draft.unparsable')
        : reason === 'load_failed' ? t('delivery_os.project.draft.loadFailed')
        : reason === 'unreadable_response' ? t('delivery_os.project.draft.unreadableResponse')
        : reason === 'rejected' && cause === 'unknown_screen' ? t('delivery_os.project.comments.error.unknownScreen')
        : reason === 'rejected' && cause === 'duplicate_id' ? t('delivery_os.project.comments.error.duplicateId')
        : t('delivery_os.project.draft.writeFailed'),
    )
  }, [t])

  const addComment = React.useCallback(async () => {
    setProblem(null)
    if (body.trim().length === 0) {
      setProblem(t('delivery_os.project.comments.error.bodyRequired'))
      return
    }
    const outcome = await applyDraftMutation((current) =>
      appendComment(current, { id: nextCommentId(current), screenAttachmentId, body: body.trim() }))
    if (outcome.ok) {
      setBody('')
      flash(t('delivery_os.project.comments.added'), 'success')
      onSaved(outcome.projectUpdatedAt)
      return
    }
    if (outcome.reason === 'conflict_surfaced') return
    reportFailure(outcome.reason, outcome.reason === 'rejected' ? outcome.cause : undefined)
  }, [applyDraftMutation, body, onSaved, reportFailure, screenAttachmentId, t])

  const submitResolution = React.useCallback(async (commentId: string) => {
    setProblem(null)
    if (resolution.trim().length === 0) {
      setProblem(t('delivery_os.project.comments.error.resolutionRequired'))
      return
    }
    const outcome = await applyDraftMutation((current) => ({ ok: true, draft: resolveComment(current, commentId, resolution.trim()) }))
    if (outcome.ok) {
      setResolutionFor(null)
      setResolution('')
      flash(t('delivery_os.project.comments.resolved'), 'success')
      onSaved(outcome.projectUpdatedAt)
      return
    }
    if (outcome.reason === 'conflict_surfaced') return
    reportFailure(outcome.reason)
  }, [applyDraftMutation, onSaved, reportFailure, resolution, t])

  return (
    <div className="mt-3 space-y-2" data-testid={`screen-comments-${screenAttachmentId}`}>
      <p className="text-xs font-medium">{t('delivery_os.project.comments.title')}</p>
      {comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('delivery_os.project.comments.none')}</p>
      ) : (
        <ul className="space-y-1">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded border border-border p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-muted-foreground">{comment.id}</span>
                <StatusBadge variant={comment.status === 'resolved' ? 'success' : 'warning'} dot>
                  {t(`delivery_os.project.comments.status.${comment.status}`)}
                </StatusBadge>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
              {comment.resolution ? (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{comment.resolution}</p>
              ) : null}
              {comment.status === 'open' && resolutionFor !== comment.id ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  data-testid={`screen-comment-resolve-${comment.id}`}
                  onClick={() => { setResolutionFor(comment.id); setResolution('') }}
                >
                  {t('delivery_os.project.comments.resolve')}
                </Button>
              ) : null}
              {resolutionFor === comment.id ? (
                <div className="mt-2 space-y-1">
                  <Textarea
                    aria-label={t('delivery_os.project.comments.resolutionLabel')}
                    value={resolution}
                    rows={2}
                    onChange={(event) => setResolution(event.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={() => void submitResolution(comment.id)}>
                      {t('delivery_os.project.comments.saveResolution')}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setResolutionFor(null)}>
                      {t('delivery_os.project.comments.cancel')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Textarea
        aria-label={t('delivery_os.project.comments.bodyLabel')}
        data-testid={`screen-comment-body-${screenAttachmentId}`}
        value={body}
        rows={2}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void addComment()
          }
        }}
      />
      <Button type="button" size="sm" data-testid={`screen-comment-add-${screenAttachmentId}`} onClick={() => void addComment()}>
        {t('delivery_os.project.comments.add')}
      </Button>
      {problem ? (
        <p data-testid="screen-comment-problem" className="text-xs text-status-error-text">{problem}</p>
      ) : null}
    </div>
  )
}
