'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { stageArtifactListResponseSchema, stageDecisionListResponseSchema, stageDecisionRequestSchema, stageArtifactV1Schema, type FlowStageStatus, type StageArtifactV1, type StageCurrency } from '../../lib/contracts'
import { useFlowQuery } from '../detail/useFlowQuery'
import { StageHistory } from './StageHistory'
import { FigmaSync } from './FigmaSync'
import { StageArtifactContent, StageArtifactTechnicalDetails } from './StageArtifactContent'
import { StageArtifactImport, RawDocumentDisclosure } from './StageArtifactImport'
import { resolveSubmittableArtifact } from './artifactContent'

type Props = { projectId: string; stage: FlowStageStatus; updatedAt: string; canManage: boolean; canApprove: boolean; onChanged: () => Promise<void> }

type DialogMode = 'draft' | 'import' | 'decision'

const PAGE_SIZE = 20

const currencyStatusMap: StatusMap<StageCurrency> = {
  approved: 'success',
  rejected: 'error',
  stale: 'warning',
  pending: 'info',
  missing: 'neutral',
}

export function StageReview({ projectId, stage, updatedAt, canManage, canApprove, onChanged }: Props) {
  const t = useT()
  const [page, setPage] = React.useState(1)
  const base = `/api/delivery_os/projects/${projectId}/stages/${encodeURIComponent(stage.stageId)}`
  const artifacts = useFlowQuery(`${base}/artifacts?page=${page}&pageSize=${PAGE_SIZE}`, stageArtifactListResponseSchema)
  const decisions = useFlowQuery(`${base}/decisions?page=1&pageSize=100`, stageDecisionListResponseSchema)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<DialogMode | null>(null)
  const [pending, setPending] = React.useState<StageArtifactV1 | null>(null)
  const [drafting, setDrafting] = React.useState(false)
  const [draftError, setDraftError] = React.useState<string | null>(null)
  const idempotencyKey = React.useRef(crypto.randomUUID())
  const pendingDecision = React.useRef<{ signature: string; payload: unknown; key: string } | null>(null)
  const selected = artifacts.data?.items.find((artifact) => artifact.artifactId === (selectedId ?? stage.currentArtifact?.artifactId)) ?? artifacts.data?.items[0]
  const isCurrent = selected?.artifactId === stage.currentArtifact?.artifactId
  const currency = stage.currency ?? 'pending'
  const total = artifacts.data?.total ?? 0
  const generateDraft = async () => {
    setDrafting(true)
    setDraftError(null)
    try {
      const response = await apiCall<unknown>(`${base}/draft`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const parsed = stageArtifactV1Schema.safeParse((response.result as { artifact?: unknown } | null)?.artifact)
      if (!response.ok || !parsed.success) throw new Error('[internal] stage draft unavailable')
      setPending(parsed.data)
      setDialog('draft')
    } catch {
      setDraftError(t('delivery_os.flow.artifact.draftFailed'))
    } finally {
      setDrafting(false)
    }
  }
  const openDialog = (mode: DialogMode) => { setPending(null); setDialog(mode) }
  const changed = async () => { setDialog(null); setPending(null); pendingDecision.current = null; idempotencyKey.current = crypto.randomUUID(); await Promise.all([artifacts.reload(), decisions.reload(), onChanged()]) }
  const fields = React.useMemo<CrudField[]>(() => dialog !== 'decision'
    ? []
    : [
      { id: 'verdict', type: 'select', label: t('delivery_os.flow.decision'), required: true, options: ['approved', 'rejected'].map((value) => ({ value, label: t(`delivery_os.flow.currency.${value}`) })) },
      { id: 'reason', type: 'textarea', label: t('delivery_os.flow.reason') },
      { id: 'approverName', type: 'text', label: t('delivery_os.flow.approver') },
      { id: 'approverRole', type: 'text', label: t('delivery_os.flow.approverRole') },
      { id: 'evidenceKind', type: 'select', label: t('delivery_os.flow.proofKind'), options: ['email', 'meeting', 'signed_document', 'other'].map((value) => ({ value, label: t(`delivery_os.flow.proof.${value}`) })) },
      { id: 'evidenceReference', type: 'textarea', label: t('delivery_os.flow.proofReference') },
    ], [dialog, t])
  const submit = async (values: Record<string, unknown>) => {
    let payload: unknown
    if (dialog !== 'decision') {
      const artifact = resolveSubmittableArtifact(pending, projectId, stage.stageId)
      if (!artifact) throw createCrudFormError(t('delivery_os.flow.invalid'))
      payload = artifact
    } else {
      if (!selected || !isCurrent) throw createCrudFormError(t('delivery_os.flow.historyReadOnly'))
      const approved = values.verdict === 'approved'
      const parsed = stageDecisionRequestSchema.safeParse({
        artifactId: selected.artifactId, subjectHash: selected.contentHash, subjectVersion: selected.version,
        verdict: values.verdict, reason: String(values.reason ?? '').trim() || null,
        clientApproval: approved ? { approverName: String(values.approverName ?? '').trim(), approverRole: String(values.approverRole ?? '').trim() || null, evidence: { kind: values.evidenceKind, reference: String(values.evidenceReference ?? '').trim(), attachment: null, recordedAt: new Date().toISOString() } } : null,
      })
      if (!parsed.success) throw createCrudFormError(t('delivery_os.flow.invalidDecision'))
      const signature = JSON.stringify({ artifactId: selected.artifactId, values })
      if (!pendingDecision.current || pendingDecision.current.signature !== signature) {
        pendingDecision.current = { signature, payload: parsed.data, key: crypto.randomUUID() }
      }
      payload = pendingDecision.current.payload
      idempotencyKey.current = pendingDecision.current.key
    }
    await withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () => apiCallOrThrow(`${base}/${dialog === 'decision' ? 'decisions' : 'artifacts'}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(dialog === 'decision' ? { 'Idempotency-Key': idempotencyKey.current } : {}) }, body: JSON.stringify(payload) }))
    await changed()
  }
  if (artifacts.loading && !artifacts.data) return <LoadingMessage label={t('delivery_os.flow.loading')} />
  if (artifacts.error || decisions.error) return <ErrorMessage label={t('delivery_os.flow.loadError')} action={<Button type="button" onClick={() => { void artifacts.reload(); void decisions.reload() }}>{t('delivery_os.task.retry')}</Button>} />
  return <section id={`delivery-stage-${stage.stageId}`} className="space-y-4" data-testid={`delivery-stage-${stage.stageId}`}>
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-lg font-semibold">{t(`delivery_os.flow.stage.${stage.stageId}`)}</h2>
      <StatusBadge variant={currencyStatusMap[currency]} dot>{t(`delivery_os.flow.currency.${currency}`)}</StatusBadge>
    </div>
    <ContextHelp title={t('delivery_os.flow.stageHelp.title')}>
      <p>{t('delivery_os.flow.stageHelp.body')}</p>
    </ContextHelp>
    {canManage ? <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={() => { void generateDraft() }} disabled={drafting}>{t(drafting ? 'delivery_os.flow.artifact.drafting' : 'delivery_os.flow.artifact.draft')}</Button>
      <Button type="button" variant="outline" onClick={() => openDialog('import')}>{t('delivery_os.flow.artifact.import')}</Button>
    </div> : null}
    {draftError ? <Alert status="error" style="lighter" size="sm">{draftError}</Alert> : null}
    {selected ? <article className="space-y-4 rounded-lg border border-border p-4" data-testid={`delivery-stage-artifact-${stage.stageId}`}>
      {!isCurrent ? <Alert status="information" style="lighter" size="sm">{t('delivery_os.flow.historyReadOnly')}</Alert> : null}
      <SectionHeader
        title={t('delivery_os.flow.version', { version: selected.version })}
        action={<time className="text-xs text-muted-foreground" dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleString()}</time>}
      />
      <StageArtifactContent content={selected.content} />
      <StageArtifactTechnicalDetails artifact={selected} />
      {canApprove && isCurrent && stage.currency !== 'stale' ? <Button type="button" onClick={() => openDialog('decision')}>{t('delivery_os.flow.recordDecision')}</Button> : null}
    </article> : <EmptyState title={t('delivery_os.flow.currency.missing')} description={t('delivery_os.flow.artifact.missingHint')} />}
    {isCurrent ? <FigmaSync projectId={projectId} stageId={stage.stageId} artifactId={selected?.artifactId ?? null} onChanged={onChanged} /> : null}
    <StageHistory artifacts={artifacts.data?.items ?? []} decisions={decisions.data?.items ?? []} selectedId={selected?.artifactId ?? null} onSelect={setSelectedId} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={page === 1} onClick={() => { setSelectedId(null); setPage((value) => value - 1) }}>{t('delivery_os.flow.previous')}</Button>
      <Button type="button" variant="outline" disabled={page * PAGE_SIZE >= total} onClick={() => { setSelectedId(null); setPage((value) => value + 1) }}>{t('delivery_os.flow.next')}</Button>
      <span className="text-xs text-muted-foreground">{t('delivery_os.flow.versionPage', { page, total })}</span>
    </div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(dialog === 'decision' ? 'delivery_os.flow.recordDecision' : dialog === 'draft' ? 'delivery_os.flow.artifact.reviewDraft' : 'delivery_os.flow.artifact.import')}</DialogTitle>
        </DialogHeader>
        {dialog === 'import' && !pending ? <StageArtifactImport projectId={projectId} stageId={stage.stageId} onParsed={setPending} /> : null}
        {dialog !== 'decision' && pending ? <div className="space-y-4" data-testid="delivery-stage-draft-review">
          <p className="text-sm text-muted-foreground">{t('delivery_os.flow.artifact.reviewHint')}</p>
          <StageArtifactContent content={pending.content} />
          <RawDocumentDisclosure payload={pending} />
        </div> : null}
        {dialog === 'decision' || pending ? <CrudForm
          embedded
          entityId="delivery_os:project"
          fields={fields}
          initialValues={{ updatedAt, verdict: 'approved', evidenceKind: 'email' }}
          submitLabel={t(dialog === 'decision' ? 'delivery_os.flow.save' : 'delivery_os.flow.artifact.submitForReview')}
          onSubmit={submit}
        /> : null}
      </DialogContent>
    </Dialog>
  </section>
}
