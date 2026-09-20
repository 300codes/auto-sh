'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { CollapsibleSection, SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { extensionPoints } from '../../extension-points'
import { DELIVERY_FLOW_SCHEMA_VERSIONS, scopingProposalV1Schema, stageArtifactV1Schema, type IntakeResponse, type ScopingProposalV1 } from '../../lib/contracts'
import { HashValue, StageArtifactContent } from '../stages/StageArtifactContent'

const proposalStatusMap: StatusMap<'proposed' | 'accepted' | 'discarded'> = {
  proposed: 'info',
  accepted: 'success',
  discarded: 'neutral',
}

function parseProposalDocument(raw: string, projectId: string): { ok: true; proposal: ScopingProposalV1 } | { ok: false; reason: 'json' | 'document' } {
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'json' }
  }
  const parsed = scopingProposalV1Schema.safeParse(document)
  if (!parsed.success || parsed.data.projectId !== projectId) return { ok: false, reason: 'document' }
  return { ok: true, proposal: parsed.data }
}

function ProposalPreview({ proposal }: { proposal: ScopingProposalV1 }) {
  const t = useT()
  return <div className="space-y-3" data-testid="delivery-scoping-preview">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
      <div>
        <dt className="font-medium">{t('delivery_os.flow.proposal.preview.kind')}</dt>
        <dd>{t(`delivery_os.flow.proposal.kind.${proposal.kind}`)}</dd>
      </div>
      <div>
        <dt className="font-medium">{t('delivery_os.flow.proposal.preview.questions')}</dt>
        <dd>{proposal.questions.length}</dd>
      </div>
      <div>
        <dt className="font-medium">{t('delivery_os.flow.proposal.preview.requirements')}</dt>
        <dd>{proposal.scope?.requirements.length ?? 0}</dd>
      </div>
      <div>
        <dt className="font-medium">{t('delivery_os.flow.proposal.preview.producedBy')}</dt>
        <dd>{proposal.producedBy.tool}</dd>
      </div>
    </dl>
    {proposal.scope ? <StageArtifactContent content={proposal.scope} /> : null}
    {proposal.platform ? <p className="text-sm">
      <span className="font-medium">{proposal.platform.profileId}</span>
      <span className="text-muted-foreground"> — {proposal.platform.rationale}</span>
    </p> : null}
  </div>
}

export function ScopingConversation({ response, projectUpdatedAt, canManage, canImport, onSaved }: { response: IntakeResponse; projectUpdatedAt: string; canManage: boolean; canImport: boolean; onSaved: () => Promise<void> }) {
  const t = useT()
  const [pendingDraft, setPendingDraft] = React.useState(false)
  const [raw, setRaw] = React.useState('')
  const [reason, setReason] = React.useState<'json' | 'document' | null>(null)
  const [proposal, setProposal] = React.useState<ScopingProposalV1 | null>(null)
  const fields = React.useMemo<CrudField[]>(() => canManage
    ? [{ id: 'createScopeDraft', type: 'checkbox', label: t('delivery_os.flow.proposal.createDraft') }]
    : [], [canManage, t])
  const check = () => {
    const result = parseProposalDocument(raw, response.intake.projectId)
    if (!result.ok) {
      setProposal(null)
      setReason(result.reason)
      return
    }
    setReason(null)
    setProposal(result.proposal)
  }
  const importProposal = async (values: Record<string, unknown>) => {
    const parsed = scopingProposalV1Schema.safeParse(proposal)
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
    setRaw('')
    setProposal(null)
    await onSaved()
  }
  return <section className="space-y-3" data-testid="delivery-scoping">
    <SectionHeader title={t('delivery_os.flow.proposal.title')} count={response.intake.proposals.length} />
    <p className="text-sm text-muted-foreground">{t('delivery_os.flow.proposal.hint')}</p>
    <InjectionSpot spotId={extensionPoints.hosts.projectScoping.spotId} context={{ schemaVersion: 'delivery-scoping-context.v1', projectId: response.intake.projectId, intakeUpdatedAt: response.updatedAt, refresh: onSaved }} />
    {pendingDraft ? <Alert status="warning" style="lighter" size="sm">{t('delivery_os.flow.proposal.draftPending')}</Alert> : null}
    {response.intake.proposals.length === 0
      ? <EmptyState title={t('delivery_os.flow.proposal.empty.title')} description={t('delivery_os.flow.proposal.empty.description')} />
      : <ul className="space-y-2">{response.intake.proposals.map((entry) => <li key={entry.proposalId} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
        <span className="text-sm font-medium">{entry.proposalId}</span>
        <StatusBadge variant={proposalStatusMap[entry.status]} dot>{t(`delivery_os.flow.proposal.${entry.status}`)}</StatusBadge>
        <time className="text-xs text-muted-foreground" dateTime={entry.proposedAt}>{new Date(entry.proposedAt).toLocaleString()}</time>
        <HashValue hash={entry.contentHash} label={t('delivery_os.flow.artifact.contentHash')} />
      </li>)}</ul>}
    {canImport ? <div className="space-y-3">
      <CollapsibleSection title={t('delivery_os.flow.proposal.technicalDocument')} defaultCollapsed>
        <div className="space-y-2">
          <Label htmlFor="delivery-scoping-document">{t('delivery_os.flow.proposal.document')}</Label>
          <Textarea id="delivery-scoping-document" rows={10} value={raw} onChange={(event) => { setRaw(event.target.value); setReason(null); setProposal(null) }} />
          {reason ? <Alert status="error" style="lighter" size="sm">{t(reason === 'json' ? 'delivery_os.flow.proposal.invalidJson' : 'delivery_os.flow.proposal.invalidDocument')}</Alert> : null}
          <Button type="button" variant="outline" disabled={raw.trim().length === 0} onClick={check}>{t('delivery_os.flow.proposal.check')}</Button>
        </div>
      </CollapsibleSection>
      {proposal ? <div className="space-y-3">
        <ProposalPreview proposal={proposal} />
        <CrudForm embedded fields={fields} initialValues={{ updatedAt: response.updatedAt }} entityId="delivery_os:intake" submitLabel={t('delivery_os.flow.proposal.import')} onSubmit={importProposal} />
      </div> : null}
    </div> : null}
  </section>
}
