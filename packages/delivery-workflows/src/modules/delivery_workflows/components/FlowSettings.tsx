'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { settingsResponseSchema } from '../data/validators'
import type { z } from 'zod'

type Settings = z.infer<typeof settingsResponseSchema>['setting']
export function FlowSettings() {
  const t = useT()
  const scope = useOrganizationScopeVersion()
  const [state, setState] = React.useState<{ scope: number; loading: boolean; error: boolean; setting: Settings }>({ scope, loading: true, error: false, setting: null })
  const [retry, setRetry] = React.useState(0)
  React.useEffect(() => {
    let disposed = false
    setState({ scope, loading: true, error: false, setting: null })
    void apiCallOrThrow<unknown>('/api/delivery_workflows/settings').then((response) => {
      const parsed = settingsResponseSchema.parse(response.result)
      if (!disposed) setState({ scope, loading: false, error: false, setting: parsed.setting })
    }).catch(() => { if (!disposed) setState({ scope, loading: false, error: true, setting: null }) })
    return () => { disposed = true }
  }, [scope, retry])
  if (state.scope !== scope || state.loading) return <LoadingMessage label={t('delivery_workflows.settings.loading')} />
  if (state.error) return <><ErrorMessage label={t('delivery_workflows.settings.error')} /><Button type="button" onClick={() => setRetry((value) => value + 1)}>{t('delivery_workflows.settings.retry')}</Button></>
  return <div className="space-y-4">
    <Alert status="information">{t('delivery_workflows.settings.newProjectsOnly')}</Alert>
    {state.setting ? <a href={state.setting.studioHref} className="underline">{t('delivery_workflows.settings.openStudio')}</a> : <a href="/backend/definitions/visual-editor" className="underline">{t('delivery_workflows.settings.openStudio')}</a>}
    <CrudForm key={`${scope}:${state.setting?.updatedAt ?? 'new'}`} title={t('delivery_workflows.settings.title')}
      fields={[{ id: 'workflowId', type: 'text', label: t('delivery_workflows.settings.workflow'), required: true },
        { id: 'version', type: 'number', label: t('delivery_workflows.settings.version'), required: true }]}
      initialValues={state.setting ?? { workflowId: '', version: 1 }}
      submitLabel={t('delivery_workflows.settings.save')}
      onSubmit={async (values) => {
        try {
          const response = await apiCallOrThrow<unknown>('/api/delivery_workflows/settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflowId: values.workflowId, version: Number(values.version) }),
          })
          const parsed = settingsResponseSchema.parse(response.result)
          setState({ scope, loading: false, error: false, setting: parsed.setting })
        } catch (error) { surfaceRecordConflict(error, t); throw error }
      }} />
  </div>
}
