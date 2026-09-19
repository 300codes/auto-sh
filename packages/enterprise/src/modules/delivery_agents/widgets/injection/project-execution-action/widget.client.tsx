'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { ExecutionWidgetContextV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AttemptState = {
  attemptId: string | null
  state: string | null
  stopConfirmation: string | null
}

const INITIAL_ATTEMPT_STATE: AttemptState = { attemptId: null, state: null, stopConfirmation: null }

export default function ProjectExecutionActionWidget({
  context,
}: InjectionWidgetComponentProps<ExecutionWidgetContextV1, undefined>) {
  const { taskId } = context
  const t = useT()
  const [attempt, setAttempt] = React.useState<AttemptState>(INITIAL_ATTEMPT_STATE)
  const [busy, setBusy] = React.useState(false)

  useAppEvent('delivery_os.task.updated', (payload: Record<string, unknown>) => {
    if (payload.taskId !== taskId) return
    if (payload.status && payload.status !== 'executing') {
      setAttempt(INITIAL_ATTEMPT_STATE)
    }
  })

  const handleExecute = React.useCallback(async () => {
    if (!taskId || busy) return
    setBusy(true)
    try {
      const idempotencyKey = `exec-${taskId}-${Date.now()}`
      const res = await apiCall<{ attemptId?: string; state?: string }>(
        `/api/delivery_agents/tasks/${taskId}/execute`,
        { method: 'POST', body: JSON.stringify({ idempotencyKey }) },
      )
      if (!res.ok) {
        flash(`[internal] Execution failed (${res.status})`, 'error')
        return
      }
      const data = res.result
      setAttempt({ attemptId: data?.attemptId ?? null, state: data?.state ?? 'reserved', stopConfirmation: null })
      flash(t('delivery_agents.widget.execute.started'), 'success')
      await context.refresh()
    } finally {
      setBusy(false)
    }
  }, [taskId, busy])

  const handleCancel = React.useCallback(async () => {
    if (!taskId || !attempt.attemptId || busy) return
    setBusy(true)
    try {
      const res = await apiCall<{ stopConfirmation?: string; state?: string }>(
        `/api/delivery_agents/tasks/${taskId}/execute/cancel`,
        { method: 'POST', body: JSON.stringify({ attemptId: attempt.attemptId }) },
      )
      if (!res.ok) {
        flash(`[internal] Cancel failed (${res.status})`, 'error')
        return
      }
      setAttempt((prev) => ({ ...prev, stopConfirmation: 'stop_unconfirmed' }))
      flash(t('delivery_agents.widget.cancel.requested'), 'success')
      await context.refresh()
    } finally {
      setBusy(false)
    }
  }, [taskId, attempt.attemptId, busy])

  if (!taskId) return null

  const isRunning = !!attempt.attemptId && attempt.stopConfirmation !== 'stop_unconfirmed'
  const isCancelPending = attempt.stopConfirmation === 'stop_unconfirmed'

  return (
    <div
      data-testid="delivery-execution-action"
      data-project-id={context.projectId}
      data-task-id={taskId}
      className="flex items-center gap-2"
    >
      {!isRunning && !isCancelPending && (
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleExecute}
          disabled={busy}
          aria-label={t('delivery_agents.widget.execute.ariaLabel')}
        >
          {busy ? t('delivery_agents.widget.execute.starting') : t('delivery_agents.widget.execute.label')}
        </Button>
      )}
      {(isRunning || isCancelPending) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={isCancelPending || busy}
          aria-label={t('delivery_agents.widget.cancel.ariaLabel')}
        >
          {isCancelPending ? t('delivery_agents.widget.cancel.cancelling') : t('delivery_agents.widget.cancel.label')}
        </Button>
      )}
    </div>
  )
}
