'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { baselineCreateResponseSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

export type FreezeBaselineActionProps = {
  projectId: string
  projectUpdatedAt: string | null
  onFrozen: (projectUpdatedAt: string) => void
}

const CONTEXT_ID = 'delivery-project-freeze-baseline'

/**
 * The client declares each render's sha256; the server re-reads the stored bytes
 * when freezing. A mismatch is therefore a statement about the render, not about
 * the write — showing it as a generic save error would turn that verification
 * into decoration.
 */
const RENDER_MISMATCH_CODES = new Set([
  'attachment_hash_mismatch',
  'hash_mismatch',
  'attachment_scope_mismatch',
])

const FREEZE_ERROR_KEYS: Record<string, string> = {
  missing_render: 'delivery_os.project.freeze.error.missingRender',
  temporary_url_only: 'delivery_os.project.freeze.error.temporaryUrlOnly',
  missing_acceptance_criteria: 'delivery_os.project.freeze.error.missingAcceptanceCriteria',
  invalid_comment_anchor: 'delivery_os.project.freeze.error.invalidCommentAnchor',
  payload_too_large: 'delivery_os.project.freeze.error.payloadTooLarge',
  forbidden: 'delivery_os.project.freeze.error.forbidden',
  not_found: 'delivery_os.project.freeze.error.notFound',
  validation_failed: 'delivery_os.project.freeze.error.validationFailed',
  optimistic_lock_required: 'delivery_os.project.freeze.error.lockRequired',
}

export function FreezeBaselineAction({ projectId, projectUpdatedAt, onFrozen }: FreezeBaselineActionProps) {
  const t = useT()
  const [problem, setProblem] = React.useState<string | null>(null)
  const [freezing, setFreezing] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: CONTEXT_ID })

  const freeze = React.useCallback(async () => {
    setProblem(null)
    setFreezing(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(projectUpdatedAt),
            () => apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(projectId)}/baselines`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ source: 'manual' }),
            }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] delivery_os.baselines.create failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: {
          formId: CONTEXT_ID,
          resourceKind: 'delivery_os.project',
          resourceId: projectId,
          retryLastMutation,
        },
        mutationPayload: { id: projectId },
      })
      const body = baselineCreateResponseSchema.safeParse(call.result)
      if (!body.success) {
        setProblem(t('delivery_os.project.freeze.error.unreadableResponse'))
        return
      }
      const { duplicate, version, openCommentIds, projectUpdatedAt: nextVersion } = body.data
      // Four disjoint outcomes: identical content, a clean freeze, a freeze that
      // carried unresolved comments forward, and a refusal. The third one is a
      // success that must still name what it left behind.
      flash(
        duplicate
          ? t('delivery_os.project.freeze.duplicate', { version })
          : openCommentIds.length > 0
            ? t('delivery_os.project.freeze.createdWithOpenComments', { version, count: openCommentIds.length })
            : t('delivery_os.project.freeze.created', { version }),
        duplicate ? 'info' : openCommentIds.length > 0 ? 'warning' : 'success',
      )
      onFrozen(nextVersion)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { title: t('delivery_os.project.freeze.error.conflictTitle') })) return
      const code = (error as { code?: unknown } | null)?.code
      if (typeof code === 'string' && RENDER_MISMATCH_CODES.has(code)) {
        setProblem(t('delivery_os.project.freeze.error.renderMismatch'))
        return
      }
      const key = typeof code === 'string' ? FREEZE_ERROR_KEYS[code] : undefined
      setProblem(key ? t(key) : t('delivery_os.project.freeze.error.unnamed'))
    } finally {
      setFreezing(false)
    }
  }, [onFrozen, projectId, projectUpdatedAt, retryLastMutation, runMutation, t])

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={freezing}
        data-testid="delivery-freeze-baseline"
        onClick={() => void freeze()}
      >
        {t('delivery_os.project.freeze.action')}
      </Button>
      {problem ? (
        <span data-testid="freeze-baseline-problem" className="text-xs text-status-error-text">{problem}</span>
      ) : null}
    </span>
  )
}
