'use client'
import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { commentImportResultSchema } from '../../lib/contracts'
const resultSchema = z.object({ schemaVersion: z.literal('delivery.figma-sync/v1'), complete: z.boolean(), results: z.array(commentImportResultSchema) })

export function FigmaSync({ projectId, stageId, artifactId, onChanged }: { projectId: string; stageId: string; artifactId: string | null; onChanged: () => Promise<void> }) {
  const t = useT()
  const { payload } = useBackendChrome()
  const [status, setStatus] = React.useState<'complete' | 'partial' | null>(null)
  if (!hasFeature(payload?.grantedFeatures, 'delivery_os.comments.import')) return null
  return <section className="space-y-2 rounded border border-border p-3" data-testid="delivery-figma-sync">
    <h3 className="text-sm font-semibold">{t('delivery_os.figmaSync.title')}</h3>
    <p className="text-sm text-muted-foreground">{t('delivery_os.figmaSync.description', { stage: t(`delivery_os.flow.stage.${stageId}`) })}</p>
    <CrudForm embedded entityId="delivery_os:comment_import" fields={[{ id: 'fileKey', type: 'text', label: t('delivery_os.project.screens.fields.fileKey'), required: true }]} submitLabel={t('delivery_os.figmaSync.submit')} initialValues={{ fileKey: '' }} onSubmit={async (values) => {
      setStatus(null)
      const fileKey = String(values.fileKey ?? '').trim()
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileKey)) throw createCrudFormError(t('delivery_os.flow.invalid'))
      const response = await apiCall<unknown>(`/api/delivery_figma/projects/${projectId}/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileKey, stageId, artifactId }) })
      if (!response.ok) throw createCrudFormError(t(response.status === 404 ? 'delivery_os.figmaSync.unavailable' : response.status === 422 ? 'delivery_os.figmaSync.unconfigured' : 'delivery_os.figmaSync.failed'))
      const parsed = resultSchema.safeParse(response.result)
      if (!parsed.success) throw createCrudFormError(t('delivery_os.figmaSync.failed'))
      setStatus(parsed.data.complete ? 'complete' : 'partial')
      await onChanged()
    }} />
    {status ? <p role="status" className={status === 'partial' ? 'text-sm text-status-warning-text' : 'text-sm text-status-success-text'}>{t(`delivery_os.figmaSync.${status}`)}</p> : null}
  </section>
}
