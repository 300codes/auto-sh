'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { ExecutionWidgetContextV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { taskDtoSchema, type TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { findActiveAttempt } from '@open-mercato/core/modules/delivery_os/components/task/attemptRegister'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ProjectExecutionActionWidget({
  context,
}: InjectionWidgetComponentProps<ExecutionWidgetContextV1, undefined>) {
  const { taskId, projectId } = context
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [task, setTask] = React.useState<TaskDto | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [problem, setProblem] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const pending = React.useRef(false)
  const requestSequence = React.useRef(0)
  const loadedScope = React.useRef<number | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: `delivery_agents.execute.${taskId}` })

  const loadTask = React.useCallback(async () => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setProblem(false)
    try {
      if (!taskId) return
      const response = await apiCall<unknown>(`/api/delivery_os/tasks/${encodeURIComponent(taskId)}`)
      if (sequence !== requestSequence.current) return
      const parsed = taskDtoSchema.safeParse(response.result)
      if (!response.ok || !parsed.success || parsed.data.id !== taskId || parsed.data.projectId !== projectId) {
        setProblem(true)
        return
      }
      loadedScope.current = scopeVersion
      setTask(parsed.data)
    } catch {
      if (sequence === requestSequence.current) setProblem(true)
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [taskId, projectId, scopeVersion])

  React.useEffect(() => { setTask(null) }, [loadTask])

  React.useEffect(() => {
    void loadTask()
    return () => { requestSequence.current += 1 }
  }, [loadTask, context.updatedAt])

  useAppEvent('delivery_os.task.updated', (event) => {
    if (event.payload.taskId === taskId) void loadTask()
  })

  const currentTask = loadedScope.current === scopeVersion && task?.id === taskId && task?.projectId === projectId ? task : null
  const activeAttempt = currentTask ? findActiveAttempt(currentTask) : null
  const isRunning = activeAttempt !== null
  const isCancelPending = activeAttempt?.stopConfirmation === 'stop_unconfirmed'
  const unavailable = loading || problem || !currentTask || !currentTask.attemptRegisterReadable || currentTask.archivedAt !== null

  const mutate = React.useCallback(async (cancel: boolean) => {
    if (!taskId || !task || unavailable || pending.current || (cancel && !activeAttempt)) return
    pending.current = true
    setBusy(true)
    const payload = cancel
      ? { attemptId: activeAttempt!.attemptId }
      : { idempotencyKey: `exec-${taskId}-${crypto.randomUUID()}` }
    try {
      await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(task.updatedAt),
            () => apiCall<unknown>(`/api/delivery_agents/tasks/${encodeURIComponent(taskId)}/execute${cancel ? '/cancel' : ''}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] Delivery execution mutation failed'), {
              status: response.status,
              ...(typeof response.result === 'object' && response.result !== null ? response.result : {}),
            })
          }
          await loadTask()
          await context.refresh()
          flash(t(cancel ? 'delivery_agents.widget.cancel.requested' : 'delivery_agents.widget.execute.started'), 'success')
        },
        context: { resourceKind: 'delivery_os.task', resourceId: taskId, retryLastMutation },
        mutationPayload: payload,
      })
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        flash(t(cancel ? 'delivery_agents.widget.cancel.failed' : 'delivery_agents.widget.execute.failed'), 'error')
      }
      await loadTask()
    } finally {
      pending.current = false
      setBusy(false)
    }
  }, [activeAttempt, context, loadTask, retryLastMutation, runMutation, t, task, taskId, unavailable])

  if (!taskId) return null

  return (
    <div
      data-testid="delivery-execution-action"
      data-project-id={context.projectId}
      data-task-id={taskId}
      className="flex items-center gap-2"
    >
      {problem ? <ErrorMessage label={t('delivery_os.task.loadError')} action={<Button type="button" variant="outline" onClick={() => void loadTask()}>{t('delivery_os.project.retry')}</Button>} /> : null}
      {loading ? <LoadingMessage label={t('delivery_os.task.loading')} /> : null}
      {!isRunning && !isCancelPending && (
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => void mutate(false)}
          disabled={busy || unavailable || (task?.status !== 'ready' && task?.status !== 'changes_requested')}
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
          onClick={() => void mutate(true)}
          disabled={isCancelPending || busy || unavailable}
          aria-label={t('delivery_agents.widget.cancel.ariaLabel')}
        >
          {isCancelPending ? t('delivery_agents.widget.cancel.cancelling') : t('delivery_agents.widget.cancel.label')}
        </Button>
      )}
    </div>
  )
}
