'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { stageArtifactListResponseSchema, stageDecisionListResponseSchema, stageDecisionRequestSchema, stageArtifactV1Schema, scopeContentSchema, designStageContentSchema, type FlowStageStatus } from '../../lib/contracts'
import { useFlowQuery } from '../detail/useFlowQuery'
import { StageHistory } from './StageHistory'
import { FigmaSync } from './FigmaSync'

type Props = { projectId: string; stage: FlowStageStatus; updatedAt: string; canManage: boolean; canApprove: boolean; onChanged: () => Promise<void> }

export function StageReview({ projectId, stage, updatedAt, canManage, canApprove, onChanged }: Props) {
  const t = useT()
  const [page, setPage] = React.useState(1)
  const base = `/api/delivery_os/projects/${projectId}/stages/${encodeURIComponent(stage.stageId)}`
  const artifacts = useFlowQuery(`${base}/artifacts?page=${page}&pageSize=20`, stageArtifactListResponseSchema)
  const decisions = useFlowQuery(`${base}/decisions?page=1&pageSize=100`, stageDecisionListResponseSchema)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<'artifact' | 'decision' | null>(null)
  const [draft, setDraft] = React.useState<string>('')
  const [drafting, setDrafting] = React.useState(false)
  const [draftError, setDraftError] = React.useState<string | null>(null)
  const idempotencyKey = React.useRef(crypto.randomUUID())
  const pendingDecision = React.useRef<{ signature: string; payload: unknown; key: string } | null>(null)
  const selected = artifacts.data?.items.find((artifact) => artifact.artifactId === (selectedId ?? stage.currentArtifact?.artifactId)) ?? artifacts.data?.items[0]
  const isCurrent = selected?.artifactId === stage.currentArtifact?.artifactId
  const scope = scopeContentSchema.safeParse(selected?.content)
  const design = designStageContentSchema.safeParse(selected?.content)
  const generateDraft = async () => {
    setDrafting(true)
    setDraftError(null)
    try {
      const response = await apiCall<unknown>(`${base}/draft`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const parsed = stageArtifactV1Schema.safeParse((response.result as { artifact?: unknown } | null)?.artifact)
      if (!response.ok || !parsed.success) throw new Error('[internal] stage draft unavailable')
      setDraft(JSON.stringify(parsed.data, null, 2))
      setDialog('artifact')
    } catch {
      setDraftError(t('delivery_os.flow.artifact.draftFailed'))
    } finally {
      setDrafting(false)
    }
  }
  const changed = async () => { setDialog(null); setDraft(''); pendingDecision.current = null; idempotencyKey.current = crypto.randomUUID(); await Promise.all([artifacts.reload(), decisions.reload(), onChanged()]) }
  const fields = React.useMemo<CrudField[]>(() => dialog === 'artifact'
    ? [{ id: 'artifact', type: 'textarea', rows: 14, label: t('delivery_os.flow.artifact.document'), required: true }]
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
    if (dialog === 'artifact') {
      let raw: unknown
      try { raw = JSON.parse(String(values.artifact ?? '')) } catch { throw createCrudFormError(t('delivery_os.flow.invalid')) }
      const parsed = stageArtifactV1Schema.safeParse(raw)
      if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.stageId !== stage.stageId || (parsed.data.source !== 'manual' && parsed.data.source !== 'agent')) throw createCrudFormError(t('delivery_os.flow.invalid'))
      payload = parsed.data
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
    await withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () => apiCallOrThrow(`${base}/${dialog === 'artifact' ? 'artifacts' : 'decisions'}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(dialog === 'decision' ? { 'Idempotency-Key': idempotencyKey.current } : {}) }, body: JSON.stringify(payload) }))
    await changed()
  }
  if (artifacts.loading && !artifacts.data) return <LoadingMessage label={t('delivery_os.flow.loading')} />
  if (artifacts.error || decisions.error) return <ErrorMessage label={t('delivery_os.flow.loadError')} action={<Button type="button" onClick={() => { void artifacts.reload(); void decisions.reload() }}>{t('delivery_os.task.retry')}</Button>} />
  return <section id={`delivery-stage-${stage.stageId}`} className="space-y-4" data-testid={`delivery-stage-${stage.stageId}`}>
    <h2 className="text-lg font-semibold">{t(`delivery_os.flow.stage.${stage.stageId}`)}</h2>
    <p>{t(`delivery_os.flow.currency.${stage.currency ?? "pending"}`)}</p>
    {canManage ? <div className="flex flex-wrap items-center gap-2">
      {stage.stageId === 'scope' ? <Button type="button" onClick={() => { void generateDraft() }} disabled={drafting}>{t(drafting ? 'delivery_os.flow.artifact.drafting' : 'delivery_os.flow.artifact.draft')}</Button> : null}
      <Button type="button" variant="outline" onClick={() => setDialog('artifact')}>{t('delivery_os.flow.artifact.import')}</Button>
    </div> : null}
    {draftError ? <p role="status" className="text-sm text-status-error-text">{draftError}</p> : null}
    {selected ? <article className="space-y-3 rounded border border-border p-4">
      {!isCurrent ? <p>{t('delivery_os.flow.historyReadOnly')}</p> : null}
      <h3 className="text-sm font-semibold">{t('delivery_os.flow.version', { version: selected.version })}</h3>
      <p className="break-all font-mono text-xs">{selected.contentHash}</p>
      {scope.success ? <div className="space-y-2"><p>{scope.data.summary}</p><ul>{scope.data.inScope.map((item) => <li key={item}>{item}</li>)}</ul><h4>{t('delivery_os.project.sections.requirements.title')}</h4><ul>{scope.data.acceptanceCriteria.map((criterion) => <li key={criterion.id}>{criterion.id}: {criterion.description}</li>)}</ul></div> : null}
      {design.success ? <div className="space-y-2"><p>{design.data.summary}</p><p>{design.data.notes}</p><ul>{design.data.screens.map((screen) => <li key={`${screen.fileKey}:${screen.nodeId}:${screen.viewport.width}:${screen.viewport.height}`}>{screen.name} · {screen.viewport.width} × {screen.viewport.height} · {screen.figmaVersion}</li>)}</ul></div> : null}
      <h4 className="text-xs font-medium">{t('delivery_os.flow.dependencies')}</h4><ul>{selected.dependsOn.map((dependency) => <li key={dependency.stageId} className="break-all text-xs">{t(`delivery_os.flow.stage.${dependency.stageId}`)} · {dependency.version} · {dependency.contentHash}</li>)}</ul>
      {canApprove && isCurrent && stage.currency !== 'stale' ? <Button type="button" onClick={() => setDialog('decision')}>{t('delivery_os.flow.recordDecision')}</Button> : null}
    </article> : <p>{t('delivery_os.flow.currency.missing')}</p>}
    {isCurrent ? <FigmaSync projectId={projectId} stageId={stage.stageId} artifactId={selected?.artifactId ?? null} onChanged={onChanged} /> : null}
    <StageHistory artifacts={artifacts.data?.items ?? []} decisions={decisions.data?.items ?? []} selectedId={selected?.artifactId ?? null} onSelect={setSelectedId} />
    <div className="flex gap-2"><Button type="button" variant="outline" disabled={page === 1} onClick={() => { setSelectedId(null); setPage((value) => value - 1) }}>{t('delivery_os.flow.previous')}</Button><Button type="button" variant="outline" disabled={page * 20 >= (artifacts.data?.total ?? 0)} onClick={() => { setSelectedId(null); setPage((value) => value + 1) }}>{t('delivery_os.flow.next')}</Button></div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null) }}><DialogContent><DialogHeader><DialogTitle>{t(dialog === 'artifact' ? 'delivery_os.flow.artifact.import' : 'delivery_os.flow.recordDecision')}</DialogTitle></DialogHeader><CrudForm embedded entityId="delivery_os:project" fields={fields} initialValues={{ updatedAt, artifact: draft, verdict: 'approved', evidenceKind: 'email' }} submitLabel={t('delivery_os.flow.save')} onSubmit={submit} /></DialogContent></Dialog>
  </section>
}
