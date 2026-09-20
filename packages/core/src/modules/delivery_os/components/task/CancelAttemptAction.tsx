'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { attemptCancelResponseSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

export type CancelAttemptActionProps = {
  taskId: string
  attemptId: string
  attemptNumber: number
  taskUpdatedAt: string | null
  onRequested: (taskUpdatedAt: string) => void
}

const CONTEXT_ID = 'delivery-task-cancel-attempt'
const MAX_REASON_CHARS = 2000

const CANCEL_ERROR_KEYS: Record<string, string> = {
  attempt_not_active: 'delivery_os.task.cancel.error.attemptNotActive',
  attempt_closed: 'delivery_os.task.cancel.error.attemptClosed',
  attempt_not_found: 'delivery_os.task.cancel.error.attemptNotFound',
  reconciliation_required: 'delivery_os.task.cancel.error.reconciliationRequired',
  not_found: 'delivery_os.task.cancel.error.notFound',
  forbidden: 'delivery_os.task.cancel.error.forbidden',
  validation_failed: 'delivery_os.task.cancel.error.validationFailed',
  optimistic_lock_required: 'delivery_os.task.cancel.error.lockRequired',
}

/**
 * The endpoint records a REQUEST, nothing more: the attempt moves to
 * `cancel_requested` with `stopConfirmation: stop_unconfirmed`, and the external
 * process is not known to have stopped. Saying "cancelled" here would promise a
 * fact the system does not have — the message names the request and points at
 * reconciliation as the way to close the attempt. The reconciliation dialog is
 * deliberately NOT opened: at this moment the operator usually cannot yet state
 * what happened outside.
 */
export function CancelAttemptAction({ taskId, attemptId, attemptNumber, taskUpdatedAt, onRequested }: CancelAttemptActionProps) {
  const t = useT()
  const [reason, setReason] = React.useState('')
  const [problem, setProblem] = React.useState<string | null>(null)
  const [requested, setRequested] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: CONTEXT_ID })

  const requestStop = React.useCallback(async () => {
    setProblem(null)
    if (reason.trim().length > MAX_REASON_CHARS) {
      setProblem(t('delivery_os.task.cancel.error.reasonTooLong', { limit: MAX_REASON_CHARS }))
      return
    }
    setSubmitting(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(taskUpdatedAt),
            () => apiCall<unknown>(
              `/api/delivery_os/tasks/${encodeURIComponent(taskId)}/attempts/${encodeURIComponent(attemptId)}/cancel`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(reason.trim().length === 0 ? {} : { reason: reason.trim() }),
              },
            ),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] delivery_os.attempts.cancel failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: { formId: CONTEXT_ID, resourceKind: 'delivery_os.task', resourceId: taskId, retryLastMutation },
        mutationPayload: { taskId, attemptId },
      })
      const body = attemptCancelResponseSchema.safeParse(call.result)
      if (!body.success) {
        setProblem(t('delivery_os.task.cancel.error.unreadableResponse'))
        return
      }
      setRequested(true)
      flash(t('delivery_os.task.cancel.requested', { number: attemptNumber }), 'warning')
      onRequested(body.data.taskUpdatedAt)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { title: t('delivery_os.task.cancel.error.conflictTitle') })) return
      const code = (error as { code?: unknown } | null)?.code
      const key = typeof code === 'string' ? CANCEL_ERROR_KEYS[code] : undefined
      setProblem(key ? t(key) : t('delivery_os.task.cancel.error.unnamed'))
    } finally {
      setSubmitting(false)
    }
  }, [attemptId, attemptNumber, onRequested, reason, retryLastMutation, runMutation, t, taskId, taskUpdatedAt])

  return (
    <div className="space-y-3 rounded border border-border p-4" data-testid="delivery-cancel-attempt">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t('delivery_os.task.cancel.titleNumbered', { number: attemptNumber })}</h3>
        <p className="text-xs text-muted-foreground">{t('delivery_os.task.cancel.description')}</p>
        <p className="text-xs text-status-warning-text">{t('delivery_os.task.cancel.consequence')}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="cancel-attempt-reason">{t('delivery_os.task.cancel.reasonLabel')}</Label>
        <Textarea
          id="cancel-attempt-reason"
          data-testid="cancel-attempt-reason"
          rows={3}
          value={reason}
          onChange={(event) => { setReason(event.target.value); setProblem(null) }}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={submitting}
        data-testid="cancel-attempt-submit"
        onClick={() => void requestStop()}
      >
        {t('delivery_os.task.cancel.action')}
      </Button>
      {requested ? (
        <p className="text-sm text-status-warning-text" data-testid="cancel-attempt-stop-unconfirmed">
          {t('delivery_os.task.cancel.stopUnconfirmed')}
        </p>
      ) : null}
      {problem ? (
        <p className="text-sm text-status-error-text" data-testid="cancel-attempt-problem">{problem}</p>
      ) : null}
    </div>
  )
}
