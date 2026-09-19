'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { decisionCreateResponseSchema, type BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'

export type DecisionKind = 'requirements' | 'design'

export type DecisionActionsProps = {
  kind: DecisionKind
  /** The version being looked at — the decision binds to ITS hash and version, not to the active one. */
  baseline: BaselineDto
  projectUpdatedAt: string | null
  onDecided: (projectUpdatedAt: string, activeBaselineId: string | null) => void
}

const DECISION_ERROR_KEYS: Record<string, string> = {
  subject_hash_mismatch: 'delivery_os.project.decisions.error.subjectHashMismatch',
  stored_content_altered: 'delivery_os.project.decisions.error.storedContentAltered',
  reason_required: 'delivery_os.project.decisions.error.reasonRequired',
  forbidden: 'delivery_os.project.decisions.error.forbidden',
  not_found: 'delivery_os.project.decisions.error.notFound',
  validation_failed: 'delivery_os.project.decisions.error.validationFailed',
  optimistic_lock_required: 'delivery_os.project.decisions.error.lockRequired',
}

export function DecisionActions({ kind, baseline, projectUpdatedAt, onDecided }: DecisionActionsProps) {
  const t = useT()
  const [rejecting, setRejecting] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [problem, setProblem] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const contextId = `delivery-project-decision-${kind}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId })

  const decide = React.useCallback(async (verdict: 'approved' | 'rejected') => {
    setProblem(null)
    // The server requires a reason for a rejection too. Catching it here keeps
    // the operator from learning the rule from a 400.
    if (verdict === 'rejected' && reason.trim().length === 0) {
      setProblem(t('delivery_os.project.decisions.error.reasonRequired'))
      return
    }
    setSubmitting(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(projectUpdatedAt),
            () => apiCall<unknown>(`/api/delivery_os/baselines/${encodeURIComponent(baseline.id)}/decisions`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                kind,
                verdict,
                subjectHash: baseline.contentHash,
                subjectVersion: baseline.version,
                ...(verdict === 'rejected' ? { reason: reason.trim() } : {}),
              }),
            }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] delivery_os.decisions.record failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: {
          formId: contextId,
          resourceKind: 'delivery_os.baseline',
          resourceId: baseline.id,
          retryLastMutation,
        },
        mutationPayload: { kind, verdict },
      })
      const body = decisionCreateResponseSchema.safeParse(call.result)
      if (!body.success) {
        setProblem(t('delivery_os.project.decisions.error.unreadableResponse'))
        return
      }
      // Activation is a separate fact from the decision: it happens only once
      // both kinds are approved, so it gets its own message.
      flash(
        body.data.activeBaselineId === baseline.id
          ? t('delivery_os.project.decisions.activated', { version: baseline.version })
          : verdict === 'approved'
            ? t('delivery_os.project.decisions.approved', { version: baseline.version })
            : t('delivery_os.project.decisions.rejected', { version: baseline.version }),
        verdict === 'approved' ? 'success' : 'info',
      )
      setRejecting(false)
      setReason('')
      onDecided(body.data.projectUpdatedAt, body.data.activeBaselineId)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { title: t('delivery_os.project.decisions.error.conflictTitle') })) return
      const code = (error as { code?: unknown } | null)?.code
      const key = typeof code === 'string' ? DECISION_ERROR_KEYS[code] : undefined
      setProblem(key ? t(key) : t('delivery_os.project.decisions.error.unnamed'))
    } finally {
      setSubmitting(false)
    }
  }, [baseline, contextId, kind, onDecided, projectUpdatedAt, reason, retryLastMutation, runMutation, t])

  return (
    <div className="space-y-2" data-testid={`decision-actions-${kind}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={submitting}
          data-testid={`decision-approve-${kind}`}
          onClick={() => void decide('approved')}
        >
          {t('delivery_os.project.decisions.approve')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting}
          data-testid={`decision-reject-${kind}`}
          onClick={() => { if (rejecting) void decide('rejected'); else { setRejecting(true); setProblem(null) } }}
        >
          {t('delivery_os.project.decisions.reject')}
        </Button>
        {rejecting ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => { setRejecting(false); setReason(''); setProblem(null) }}>
            {t('delivery_os.project.decisions.cancel')}
          </Button>
        ) : null}
      </div>
      {rejecting ? (
        <Textarea
          aria-label={t('delivery_os.project.decisions.reasonLabel')}
          data-testid={`decision-reason-${kind}`}
          value={reason}
          rows={2}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void decide('rejected')
            }
          }}
        />
      ) : null}
      {problem ? (
        <p data-testid={`decision-problem-${kind}`} className="text-xs text-status-error-text">{problem}</p>
      ) : null}
    </div>
  )
}
