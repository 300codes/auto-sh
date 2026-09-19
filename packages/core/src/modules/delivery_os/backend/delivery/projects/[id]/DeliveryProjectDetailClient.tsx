'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { projectDetailSchema, type ProjectDetail } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { extensionPoints } from '@open-mercato/core/modules/delivery_os/extension-points'
import {
  DELIVERY_SCHEMA_VERSIONS,
  executionWidgetContextV1Schema,
  type ExecutionWidgetContextV1,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { useProjectSections } from '@open-mercato/core/modules/delivery_os/components/detail/useProjectSections'
import { resolveActiveBaseline } from '@open-mercato/core/modules/delivery_os/components/detail/baselineContent'
import { RequirementsSection } from '@open-mercato/core/modules/delivery_os/components/detail/RequirementsSection'
import { DesignSection } from '@open-mercato/core/modules/delivery_os/components/detail/DesignSection'
import { TasksSection } from '@open-mercato/core/modules/delivery_os/components/detail/TasksSection'
import { EvidenceSection } from '@open-mercato/core/modules/delivery_os/components/detail/EvidenceSection'

const TASK_QUERY_PARAM = 'taskId'

type DetailState =
  | { status: 'loading' | 'notFound' | 'error' }
  | { status: 'ready'; project: ProjectDetail; context: ExecutionWidgetContextV1 }

function readSelectedTaskFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(TASK_QUERY_PARAM)
}

function writeSelectedTaskToUrl(taskId: string | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (taskId) url.searchParams.set(TASK_QUERY_PARAM, taskId)
  else url.searchParams.delete(TASK_QUERY_PARAM)
  window.history.replaceState(window.history.state, '', url.toString())
}

export function DeliveryProjectDetailClient({ params }: { params: { id: string } }) {
  const t = useT()
  const [state, setState] = React.useState<DetailState>({ status: 'loading' })
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(() => readSelectedTaskFromUrl())
  const requestSequence = React.useRef(0)
  const { retryLastMutation } = useGuardedMutation({ contextId: `delivery_os.project.${params.id}` })
  const scopeVersion = useOrganizationScopeVersion()

  // The widget's `refresh` has to reload the project AND the sections, because an
  // execution result changes task status. It is held in a ref so the context the
  // project fetch builds can reference it without the two callbacks depending on
  // each other.
  const refreshAllRef = React.useRef<() => Promise<void>>(async () => {})
  const widgetRefresh = React.useCallback((): Promise<void> => refreshAllRef.current(), [])

  const refreshProject = React.useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    setState({ status: 'loading' })
    try {
      const response = await apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(params.id)}`)
      if (sequence !== requestSequence.current) return
      if (response.status === 404) {
        setState({ status: 'notFound' })
        return
      }
      const parsed = projectDetailSchema.safeParse(response.result)
      if (!response.ok || !parsed.success || parsed.data.id !== params.id) {
        setState({ status: 'error' })
        return
      }
      const context = executionWidgetContextV1Schema.safeParse({
        schemaVersion: DELIVERY_SCHEMA_VERSIONS.executionWidgetContext,
        projectId: parsed.data.id,
        taskId: null,
        baselineId: parsed.data.activeBaselineId,
        updatedAt: parsed.data.updatedAt,
        retryLastMutation,
        refresh: widgetRefresh,
      })
      if (!context.success) {
        setState({ status: 'error' })
        return
      }
      setState({ status: 'ready', project: parsed.data, context: context.data })
    } catch {
      if (sequence === requestSequence.current) setState({ status: 'error' })
    }
  }, [params.id, retryLastMutation, widgetRefresh, scopeVersion])

  // Declared before the section sources so the project request — the one that
  // gates the whole page — is the first one this component issues on mount.
  React.useEffect(() => {
    void refreshProject()
    return () => { requestSequence.current += 1 }
  }, [refreshProject])

  const sections = useProjectSections(params.id)
  const reloadSections = sections.reloadSections

  const selectTask = React.useCallback((taskId: string | null) => {
    setSelectedTaskId(taskId)
    writeSelectedTaskToUrl(taskId)
  }, [])

  // A task archived elsewhere disappears from the refetched list; keeping its id
  // would mount the extension host against a record that no longer exists.
  React.useEffect(() => {
    if (sections.tasks.status !== 'ready' || selectedTaskId === null) return
    if (sections.tasks.data.some((task) => task.id === selectedTaskId)) return
    selectTask(null)
  }, [sections.tasks, selectedTaskId, selectTask])

  React.useEffect(() => {
    refreshAllRef.current = async () => { await Promise.all([refreshProject(), reloadSections()]) }
  }, [refreshProject, reloadSections])

  const activeBaselineKind = sections.baselines.status === 'ready'
    ? resolveActiveBaseline(sections.baselines.data).kind
    : null

  const widgetContext = React.useMemo<ExecutionWidgetContextV1 | null>(() => {
    if (state.status !== 'ready') return null
    const parsed = executionWidgetContextV1Schema.safeParse({ ...state.context, taskId: selectedTaskId })
    return parsed.success ? parsed.data : state.context
  }, [state, selectedTaskId])

  if (state.status === 'loading' || (state.status === 'ready' && state.project.id !== params.id)) {
    return <Page><PageBody><LoadingMessage label={t('delivery_os.project.loading')} /></PageBody></Page>
  }
  if (state.status === 'notFound' || state.status === 'error') {
    return (
      <Page><PageBody>
        <ErrorMessage
          label={t(state.status === 'notFound' ? 'delivery_os.project.notFound' : 'delivery_os.project.loadError')}
          action={<Button type="button" variant="outline" onClick={() => void refreshProject()}>{t('delivery_os.project.retry')}</Button>}
        />
      </PageBody></Page>
    )
  }
  if (state.status !== 'ready') return null

  return (
    <Page>
      <FormHeader
        mode="detail"
        title={state.project.name}
        entityTypeLabel={t('delivery_os.project.title')}
        statusBadge={<Badge variant="secondary">{t(`delivery_os.project.status.${state.project.status}`)}</Badge>}
      />
      <PageBody>
        {state.project.brief ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{state.project.brief}</p> : null}
        <InjectionSpot
          spotId={extensionPoints.hosts.projectExecution.spotId}
          context={widgetContext ?? state.context}
        />
        <div className="space-y-6">
          <RequirementsSection state={sections.baselines} onRetry={() => void sections.reloadBaselines()} />
          <DesignSection state={sections.baselines} onRetry={() => void sections.reloadBaselines()} />
          <TasksSection
            state={sections.tasks}
            attention={state.project.attention}
            hasActiveBaseline={activeBaselineKind === null ? null : activeBaselineKind !== 'none'}
            selectedTaskId={selectedTaskId}
            onSelectTask={selectTask}
            onRetry={() => void sections.reloadTasks()}
          />
          <EvidenceSection
            progress={state.project.progress}
            taskCounts={state.project.taskCounts}
            attention={state.project.attention}
            baselines={sections.baselines}
            onRetry={() => void sections.reloadBaselines()}
          />
        </div>
      </PageBody>
    </Page>
  )
}
