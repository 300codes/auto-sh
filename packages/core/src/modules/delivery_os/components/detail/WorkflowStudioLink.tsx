'use client'
import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { uuidSchema } from '../../lib/contracts'
const schema = z.object({ schemaVersion: z.literal('delivery-workflow-binding.v1'), projectId: uuidSchema, binding: z.object({ definitionId: uuidSchema, version: z.number().int().positive(), workflowId: z.string(), workflowInstanceId: uuidSchema.nullable(), studioHref: z.string() }).nullable() })
export function WorkflowStudioLink({ projectId }: { projectId: string }) {
  const t = useT()
  const { payload } = useBackendChrome()
  const scopeVersion = useOrganizationScopeVersion()
  const allowed = hasFeature(payload?.grantedFeatures, 'workflows.definitions.view')
  const key = `${projectId}:${scopeVersion}:${allowed}`
  const [state, setState] = React.useState<{ key: string; binding: z.infer<typeof schema>['binding']; failed: boolean } | null>(null)
  const [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    let cancelled = false
    if (!allowed) return
    void (async () => {
      try {
        const response = await apiCall<unknown>(`/api/delivery_workflows/projects/${projectId}/binding`)
        if (cancelled) return
        if (response.status === 404) { setState({ key, binding: null, failed: false }); return }
        const parsed = schema.safeParse(response.result)
        if (!response.ok || !parsed.success || parsed.data.projectId !== projectId || (parsed.data.binding && parsed.data.binding.studioHref !== `/backend/definitions/visual-editor?id=${parsed.data.binding.definitionId}`)) { setState({ key, binding: null, failed: true }); return }
        setState({ key, binding: parsed.data.binding, failed: false })
      } catch { if (!cancelled) setState({ key, binding: null, failed: true }) }
    })()
    return () => { cancelled = true }
  }, [allowed, key, projectId, reload])
  if (!allowed || state?.key !== key) return null
  if (state.failed) return <ErrorMessage label={t('delivery_os.flow.workflowBindingError')} action={<Button type="button" variant="outline" onClick={() => setReload((value) => value + 1)}>{t('delivery_os.task.retry')}</Button>} />
  if (!state.binding) return null
  return <Button asChild variant="outline"><Link href={state.binding.studioHref}>{t('delivery_os.flow.workflowStudio', { version: state.binding.version })}</Link></Button>
}
