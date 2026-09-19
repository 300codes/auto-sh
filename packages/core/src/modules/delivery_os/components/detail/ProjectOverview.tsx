'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flowStatusV1Schema, FLOW_APPROVAL_STAGE_ORDER } from '../../lib/contracts'
import { useFlowQuery } from './useFlowQuery'
import { BriefWizard } from '../intake/BriefWizard'
import { StageReview } from '../stages/StageReview'
import { WorkflowStudioLink } from './WorkflowStudioLink'

type Props = { projectId: string; projectUpdatedAt: string; actorUserId: string | null; canManage: boolean; canImport: boolean; canApprove: boolean; canManageFlow: boolean; onChanged: () => Promise<void> }

export function ProjectOverview({ projectId, projectUpdatedAt, actorUserId, canManage, canImport, canApprove, canManageFlow, onChanged }: Props) {
  const t = useT()
  const searchParams = useSearchParams()
  const linkedStage = searchParams.get('stage')
  const query = useFlowQuery(`/api/delivery_os/projects/${projectId}/flow`, flowStatusV1Schema)
  const [selectedStageId, setSelectedStageId] = React.useState<string | null>(null)
  const [showIntake, setShowIntake] = React.useState(false)
  React.useEffect(() => {
    if (linkedStage && FLOW_APPROVAL_STAGE_ORDER.some((id) => id === linkedStage)) {
      setSelectedStageId(linkedStage)
      setShowIntake(false)
    }
  }, [linkedStage, projectId])
  const [pinning, setPinning] = React.useState(false)
  const [pinError, setPinError] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: `delivery-flow-${projectId}` })
  React.useEffect(() => { void query.reload() }, [projectUpdatedAt, query.reload])
  const changed = React.useCallback(async () => { await Promise.all([query.reload(), onChanged()]) }, [query.reload, onChanged])
  const mutateFlow = async (action: 'pin' | 'baseline') => {
    if (pinning) return
    setPinning(true); setPinError(false)
    try {
      await runMutation({ operation: async () => {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(projectUpdatedAt), () => apiCallOrThrow(`/api/delivery_os/projects/${projectId}/flow/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action === 'pin' ? { templateId: 'delivery-default', templateVersion: 1 } : {}) }))
        await changed()
      }, context: { resourceKind: 'delivery_os.project', resourceId: projectId, retryLastMutation } })
    } catch (error) { if (!surfaceRecordConflict(error, t)) setPinError(true) } finally { setPinning(false) }
  }
  if (!query.data && query.loading) return <LoadingMessage label={t('delivery_os.flow.loading')} />
  if (query.error || !query.data || query.data.projectId !== projectId) return <ErrorMessage label={t('delivery_os.flow.loadError')} action={<Button type="button" onClick={() => void query.reload()}>{t('delivery_os.task.retry')}</Button>} />
  const flow = query.data
  const selected = flow.stages.find((stage) => stage.stageId === selectedStageId && FLOW_APPROVAL_STAGE_ORDER.some((id) => id === stage.stageId))
  const next = () => {
    if (flow.nextAction.kind === 'pin_template') { void mutateFlow('pin'); return }
    if (flow.nextAction.kind === 'complete_intake') { setShowIntake(true); return }
    if (flow.nextAction.stageId && FLOW_APPROVAL_STAGE_ORDER.some((id) => id === flow.nextAction.stageId)) { setSelectedStageId(flow.nextAction.stageId); setShowIntake(false); return }
    document.getElementById(flow.nextAction.kind === 'dispatch' ? 'delivery-project-tasks' : 'delivery-project-evidence')?.scrollIntoView({ behavior: 'smooth' })
  }
  return <section className="space-y-4 rounded border border-border p-4" data-testid="delivery-project-overview">
    <h2 className="text-lg font-semibold">{t('delivery_os.flow.overview')}</h2>
    <WorkflowStudioLink projectId={projectId} />
    <p>{flow.currentStageId ? t(`delivery_os.flow.stage.${flow.currentStageId}`) : t('delivery_os.flow.noStage')}</p>
    <p>{t('delivery_os.flow.pending', { count: flow.pendingApprovals.length })}</p>
    {pinError ? <ErrorMessage label={t('delivery_os.flow.saveError')} /> : null}
    <Button type="button" disabled={pinning || flow.nextAction.kind === 'none' || (flow.nextAction.kind === 'pin_template' && !canManageFlow)} onClick={next}>{t(`delivery_os.flow.nextAction.${flow.nextAction.kind}`)}</Button>
    {canManageFlow && !flow.template && flow.nextAction.kind !== 'pin_template' ? <Button type="button" variant="outline" disabled={pinning} onClick={() => void mutateFlow('pin')}>{t('delivery_os.flow.nextAction.pin_template')}</Button> : null}
    {canManageFlow && flow.stages.length > 0 ? <Button type="button" variant="outline" disabled={pinning} onClick={() => void mutateFlow('baseline')}>{t('delivery_os.flow.materialize')}</Button> : null}
    <ul>{flow.blockers.map((blocker, index) => <li key={`${blocker.kind}:${blocker.stageId}:${index}`}><Button type="button" variant="link" onClick={() => { if (blocker.stageId) setSelectedStageId(blocker.stageId); else setShowIntake(true) }}>{t(`delivery_os.flow.blocker.${blocker.kind}`)} {blocker.stageId ? t(`delivery_os.flow.stage.${blocker.stageId}`) : ''}</Button></li>)}</ul>
    <nav className="flex flex-wrap gap-2" aria-label={t('delivery_os.flow.overview')}><Button type="button" variant="outline" onClick={() => setShowIntake((value) => !value)}>{t('delivery_os.flow.brief.title')}</Button>{flow.stages.filter((stage) => FLOW_APPROVAL_STAGE_ORDER.some((id) => id === stage.stageId)).map((stage) => <Button type="button" variant="outline" key={stage.stageId} onClick={() => { setSelectedStageId(stage.stageId); setShowIntake(false) }}>{t(`delivery_os.flow.stage.${stage.stageId}`)} <StatusBadge variant={stage.currency === 'approved' ? 'success' : stage.currency === 'rejected' ? 'error' : 'neutral'}>{t(`delivery_os.flow.currency.${stage.currency ?? 'pending'}`)}</StatusBadge></Button>)}</nav>
    {showIntake || flow.nextAction.kind === 'complete_intake' ? <BriefWizard projectId={projectId} projectUpdatedAt={flow.updatedAt} actorUserId={actorUserId} canManage={canManage} canImport={canImport} onChanged={() => void changed()} /> : null}
    {selected ? <StageReview key={`${projectId}:${selected.stageId}`} projectId={projectId} stage={selected} updatedAt={flow.updatedAt} canManage={canManage} canApprove={canApprove} onChanged={changed} /> : null}
  </section>
}
