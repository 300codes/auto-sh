'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { taskDtoSchema, type TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { deliveryTaskStatusMap } from '@open-mercato/core/modules/delivery_os/components/detail/TasksSection'
import { readAttemptRegister } from '@open-mercato/core/modules/delivery_os/components/task/attemptRegister'
import { TaskFacts } from '@open-mercato/core/modules/delivery_os/components/task/TaskFacts'
import { TaskExecutionPanel } from '@open-mercato/core/modules/delivery_os/components/task/TaskExecutionPanel'

const MANAGE_ATTEMPTS_FEATURE = 'delivery_os.attempts.manage'
const RECONCILE_ATTEMPTS_FEATURE = 'delivery_os.attempts.reconcile'
const IMPORT_RESULTS_FEATURE = 'delivery_os.results.import'

type TaskState =
  | { status: 'loading' | 'notFound' | 'error' }
  | { status: 'ready'; task: TaskDto }

export function DeliveryTaskDetailClient({ params }: { params: { id: string; taskId: string } }) {
  const t = useT()
  const [state, setState] = React.useState<TaskState>({ status: 'loading' })
  // Every execution endpoint answers with `taskUpdatedAt`. Holding it here and
  // handing it to the next mutation keeps a back-to-back sequence current
  // without waiting for a refetch that has not landed yet.
  const [taskVersion, setTaskVersion] = React.useState<string | null>(null)
  const requestSequence = React.useRef(0)
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chrome } = useBackendChrome()
  const canManageAttempts = hasFeature(chrome?.grantedFeatures, MANAGE_ATTEMPTS_FEATURE)
  const canReconcile = hasFeature(chrome?.grantedFeatures, RECONCILE_ATTEMPTS_FEATURE)
  const canImportResults = hasFeature(chrome?.grantedFeatures, IMPORT_RESULTS_FEATURE)

  const refreshTask = React.useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    setState({ status: 'loading' })
    try {
      const response = await apiCall<unknown>(`/api/delivery_os/tasks/${encodeURIComponent(params.taskId)}`)
      if (sequence !== requestSequence.current) return
      if (response.status === 404) {
        setState({ status: 'notFound' })
        return
      }
      const parsed = taskDtoSchema.safeParse(response.result)
      if (!response.ok || !parsed.success || parsed.data.id !== params.taskId) {
        setState({ status: 'error' })
        return
      }
      setTaskVersion(parsed.data.updatedAt)
      setState({ status: 'ready', task: parsed.data })
    } catch {
      if (sequence === requestSequence.current) setState({ status: 'error' })
    }
  }, [params.taskId, scopeVersion])

  React.useEffect(() => {
    void refreshTask()
    return () => { requestSequence.current += 1 }
  }, [refreshTask])

  // The mutation response is the authority on the new version; the reload that
  // follows only brings the register up to date.
  const onMutated = React.useCallback((nextVersion: string) => {
    setTaskVersion(nextVersion)
    void refreshTask()
  }, [refreshTask])

  const register = React.useMemo(
    () => (state.status === 'ready'
      ? readAttemptRegister(state.task)
      : { kind: 'empty' as const }),
    [state],
  )

  if (state.status === 'loading') {
    return <Page><PageBody><LoadingMessage label={t('delivery_os.task.loading')} /></PageBody></Page>
  }
  if (state.status === 'notFound' || state.status === 'error') {
    return (
      <Page><PageBody>
        <ErrorMessage
          label={t(state.status === 'notFound' ? 'delivery_os.task.notFound' : 'delivery_os.task.loadError')}
          action={<Button type="button" variant="outline" onClick={() => void refreshTask()}>{t('delivery_os.task.retry')}</Button>}
        />
      </PageBody></Page>
    )
  }

  if (state.status !== 'ready') return null

  const { task } = state
  return (
    <Page>
      <FormHeader
        mode="detail"
        title={task.title}
        entityTypeLabel={t('delivery_os.task.title')}
        statusBadge={
          <StatusBadge variant={deliveryTaskStatusMap[task.status] ?? 'neutral'} dot>
            {t(`delivery_os.project.sections.tasks.status.${task.status}`)}
          </StatusBadge>
        }
      />
      <PageBody>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`/backend/delivery/projects/${encodeURIComponent(params.id)}?taskId=${encodeURIComponent(task.id)}`}>
                {t('delivery_os.task.backToProject')}
              </a>
            </Button>
            {task.statusReason ? (
              <span data-testid="delivery-task-status-reason">
                <StatusBadge variant="warning">
                  {t(`delivery_os.task.statusReason.${task.statusReason}`)}
                </StatusBadge>
              </span>
            ) : null}
            {task.archivedAt ? (
              <span data-testid="delivery-task-archived">
                <StatusBadge variant="neutral">{t('delivery_os.task.archived')}</StatusBadge>
              </span>
            ) : null}
          </div>
          <TaskFacts task={task} />
          <TaskExecutionPanel
            task={task}
            register={register}
            taskVersion={taskVersion}
            canManageAttempts={canManageAttempts}
            canReconcile={canReconcile}
            canImportResults={canImportResults}
            onMutated={onMutated}
          />
        </div>
      </PageBody>
    </Page>
  )
}
