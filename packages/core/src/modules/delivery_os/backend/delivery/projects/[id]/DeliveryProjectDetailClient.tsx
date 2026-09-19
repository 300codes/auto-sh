'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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

type DetailState =
  | { status: 'loading' | 'notFound' | 'error' }
  | { status: 'ready'; project: ProjectDetail; context: ExecutionWidgetContextV1 }

export function DeliveryProjectDetailClient({ params }: { params: { id: string } }) {
  const t = useT()
  const [state, setState] = React.useState<DetailState>({ status: 'loading' })
  const requestSequence = React.useRef(0)
  const { retryLastMutation } = useGuardedMutation({ contextId: `delivery_os.project.${params.id}` })

  const refresh = React.useCallback(async (): Promise<void> => {
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
        refresh,
      })
      if (!context.success) {
        setState({ status: 'error' })
        return
      }
      setState({ status: 'ready', project: parsed.data, context: context.data })
    } catch {
      if (sequence === requestSequence.current) setState({ status: 'error' })
    }
  }, [params.id, retryLastMutation])

  React.useEffect(() => {
    void refresh()
    return () => { requestSequence.current += 1 }
  }, [refresh])

  if (state.status === 'loading' || (state.status === 'ready' && state.project.id !== params.id)) {
    return <Page><PageBody><LoadingMessage label={t('delivery_os.project.loading')} /></PageBody></Page>
  }
  if (state.status === 'notFound' || state.status === 'error') {
    return (
      <Page><PageBody>
        <ErrorMessage
          label={t(state.status === 'notFound' ? 'delivery_os.project.notFound' : 'delivery_os.project.loadError')}
          action={<Button type="button" variant="outline" onClick={() => void refresh()}>{t('delivery_os.project.retry')}</Button>}
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
        <InjectionSpot spotId={extensionPoints.hosts.projectExecution.spotId} context={state.context} />
      </PageBody>
    </Page>
  )
}
