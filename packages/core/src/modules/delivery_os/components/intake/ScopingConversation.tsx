'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '../../extension-points'
import { DELIVERY_FLOW_SCHEMA_VERSIONS, scopingProposalV1Schema, stageArtifactV1Schema, type IntakeResponse } from '../../lib/contracts'

export function ScopingConversation({ response, projectUpdatedAt, canManage, canImport, onSaved }: { response: IntakeResponse; projectUpdatedAt: string; canManage: boolean; canImport: boolean; onSaved: () => Promise<void> }) {
  const t = useT()
  const [pendingDraft, setPendingDraft] = React.useState(false)
  const fields = React.useMemo<CrudField[]>(() => [{ id: 'proposal', type: 'textarea', rows: 10, label: t('delivery_os.flow.proposal.document'), required: true }, ...(canManage ? [{ id: 'createScopeDraft', type: 'checkbox' as const, label: t('delivery_os.flow.proposal.createDraft') }] : [])], [canManage, t])
  const importProposal = async (values: Record<string, unknown>) => {
    let raw: unknown
    try { raw = JSON.parse(String(values.proposal ?? '')) } catch { throw createCrudFormError(t('delivery_os.flow.invalid')) }
    const parsed = scopingProposalV1Schema.safeParse(raw)
    if (!parsed.success || parsed.data.projectId !== response.intake.projectId) throw createCrudFormError(t('delivery_os.flow.invalid'))
    await withScopedApiRequestHeaders(buildOptimisticLockHeader(response.updatedAt), () => apiCallOrThrow(`/api/delivery_os/projects/${response.intake.projectId}/intake/proposals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data) }))
    if (values.createScopeDraft === true && canManage && parsed.data.scope) {
      const artifact = stageArtifactV1Schema.parse({ schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.stageArtifact, projectId: response.intake.projectId, stageId: 'scope', source: 'intake', content: parsed.data.scope, dependsOn: [], attachments: [], producedBy: parsed.data.producedBy })
      setPendingDraft(true)
      try {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(projectUpdatedAt), () => apiCallOrThrow(`/api/delivery_os/projects/${response.intake.projectId}/stages/scope/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(artifact) }))
        setPendingDraft(false)
      } catch (error) {
        if (surfaceRecordConflict(error, t)) throw error
        throw createCrudFormError(t('delivery_os.flow.proposal.draftPending'))
      }
    }
    await onSaved()
  }
  return <section className="space-y-3" data-testid="delivery-scoping">
    <h3 className="text-sm font-semibold">{t('delivery_os.flow.proposal.title')}</h3>
    <p className="text-sm text-muted-foreground">{t('delivery_os.flow.proposal.hint')}</p>
    <InjectionSpot spotId={extensionPoints.hosts.projectScoping.spotId} context={{ schemaVersion: 'delivery-scoping-context.v1', projectId: response.intake.projectId, intakeUpdatedAt: response.updatedAt, refresh: onSaved }} />
    {pendingDraft ? <p role="status" className="text-sm text-status-warning-text">{t('delivery_os.flow.proposal.draftPending')}</p> : null}
    <ul className="space-y-2">{response.intake.proposals.map((proposal) => <li key={proposal.proposalId}><span>{proposal.proposalId}</span> <span>{t(`delivery_os.flow.proposal.${proposal.status}`)}</span><p className="break-all font-mono text-xs">{proposal.contentHash}</p></li>)}</ul>
    {canImport ? <CrudForm embedded fields={fields} initialValues={{ proposal: '', updatedAt: response.updatedAt }} entityId="delivery_os:intake" submitLabel={t('delivery_os.flow.proposal.import')} onSubmit={importProposal} /> : null}
  </section>
}
