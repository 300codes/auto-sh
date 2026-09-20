'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import {
  flowStatusV1Schema,
  FLOW_APPROVAL_STAGE_ORDER,
  type FlowBlocker,
  type FlowStatusV1,
} from '../../lib/contracts'
import { useFlowQuery } from './useFlowQuery'

export type ProjectDetailTab = 'process' | 'baseline' | 'tasks' | 'evidence'

export type FlowStepState = 'pending' | 'active' | 'completed'

export type FlowStep = { id: string; labelKey: string; state: FlowStepState }

export type FlowNextStepAvailability =
  | { available: true }
  | { available: false; reasonKey: 'none' | 'noFlowPermission' }

export type FlowController = {
  flow: FlowStatusV1 | null
  loading: boolean
  error: boolean
  reload: () => Promise<void>
  changed: () => Promise<void>
  selectedStageId: string | null
  selectStage: (stageId: string) => void
  showIntake: boolean
  toggleIntake: () => void
  pinning: boolean
  pinError: boolean
  pinTemplate: () => void
  materializeBaseline: () => void
  steps: FlowStep[]
  availability: FlowNextStepAvailability
  runNextAction: () => void
  openBlocker: (blocker: FlowBlocker) => void
}

export type FlowControllerOptions = {
  projectId: string
  projectUpdatedAt: string
  canManageFlow: boolean
  linkedStageId: string | null
  onChanged: () => Promise<void>
  onRequestTab: (tab: ProjectDetailTab) => void
}

const INTAKE_STEP_ID = 'intake'

function isApprovalStage(stageId: string | null): boolean {
  return stageId !== null && FLOW_APPROVAL_STAGE_ORDER.some((id) => id === stageId)
}

function buildSteps(flow: FlowStatusV1 | null): FlowStep[] {
  const intakeSubmitted = flow?.intakeStep === 'submitted'
  const intakeActive = !flow || !intakeSubmitted
  const steps: FlowStep[] = [{
    id: INTAKE_STEP_ID,
    labelKey: 'delivery_os.flow.brief.title',
    state: intakeSubmitted ? 'completed' : intakeActive ? 'active' : 'pending',
  }]
  for (const stageId of FLOW_APPROVAL_STAGE_ORDER) {
    const stage = flow?.stages.find((candidate) => candidate.stageId === stageId) ?? null
    const isCurrent = flow?.currentStageId === stageId || flow?.nextAction.stageId === stageId
    steps.push({
      id: stageId,
      labelKey: `delivery_os.flow.stage.${stageId}`,
      state: stage?.currency === 'approved' ? 'completed' : isCurrent ? 'active' : 'pending',
    })
  }
  return steps
}

/**
 * One flow status fetch, one set of flow mutations, one selection state — shared
 * by the persistent next-step header and the process tab. Both surfaces read the
 * same `/flow` answer, so lifting it here is what keeps the header above the tabs
 * without a second request or a second source of truth.
 */
export function useFlowController({
  projectId,
  projectUpdatedAt,
  canManageFlow,
  linkedStageId,
  onChanged,
  onRequestTab,
}: FlowControllerOptions): FlowController {
  const t = useT()
  const query = useFlowQuery(`/api/delivery_os/projects/${projectId}/flow`, flowStatusV1Schema)
  const [selectedStageId, setSelectedStageId] = React.useState<string | null>(null)
  const [showIntake, setShowIntake] = React.useState(false)
  const [pinning, setPinning] = React.useState(false)
  const [pinError, setPinError] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: `delivery-flow-${projectId}` })

  React.useEffect(() => {
    if (!isApprovalStage(linkedStageId)) return
    setSelectedStageId(linkedStageId)
    setShowIntake(false)
  }, [linkedStageId, projectId])

  React.useEffect(() => { void query.reload() }, [projectUpdatedAt, query.reload])

  const changed = React.useCallback(async () => { await Promise.all([query.reload(), onChanged()]) }, [query.reload, onChanged])

  const mutateFlow = React.useCallback(async (action: 'pin' | 'baseline') => {
    if (pinning) return
    setPinning(true); setPinError(false)
    try {
      await runMutation({ operation: async () => {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(projectUpdatedAt), () => apiCallOrThrow(`/api/delivery_os/projects/${projectId}/flow/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action === 'pin' ? { templateId: 'delivery-default', templateVersion: 1 } : {}) }))
        await changed()
      }, context: { resourceKind: 'delivery_os.project', resourceId: projectId, retryLastMutation } })
    } catch (error) { if (!surfaceRecordConflict(error, t)) setPinError(true) } finally { setPinning(false) }
  }, [changed, pinning, projectId, projectUpdatedAt, retryLastMutation, runMutation, t])

  const selectStage = React.useCallback((stageId: string) => {
    setSelectedStageId(stageId)
    setShowIntake(false)
    onRequestTab('process')
  }, [onRequestTab])

  const openIntake = React.useCallback(() => {
    setShowIntake(true)
    onRequestTab('process')
  }, [onRequestTab])

  const flow = query.data && query.data.projectId === projectId ? query.data : null

  const availability = React.useMemo<FlowNextStepAvailability>(() => {
    if (!flow) return { available: true }
    if (flow.nextAction.kind === 'none') return { available: false, reasonKey: 'none' }
    if (flow.nextAction.kind === 'pin_template' && !canManageFlow) return { available: false, reasonKey: 'noFlowPermission' }
    return { available: true }
  }, [canManageFlow, flow])

  const runNextAction = React.useCallback(() => {
    if (!flow) return
    if (flow.nextAction.kind === 'pin_template') { void mutateFlow('pin'); return }
    if (flow.nextAction.kind === 'complete_intake') { openIntake(); return }
    const stageId = flow.nextAction.stageId
    if (stageId !== null && isApprovalStage(stageId)) { selectStage(stageId); return }
    onRequestTab(flow.nextAction.kind === 'dispatch' ? 'tasks' : 'evidence')
  }, [flow, mutateFlow, onRequestTab, openIntake, selectStage])

  const openBlocker = React.useCallback((blocker: FlowBlocker) => {
    if (blocker.stageId) selectStage(blocker.stageId)
    else openIntake()
  }, [openIntake, selectStage])

  return {
    flow,
    loading: query.loading,
    error: query.error || (query.data !== null && query.data.projectId !== projectId),
    reload: query.reload,
    changed,
    selectedStageId,
    selectStage,
    showIntake,
    toggleIntake: React.useCallback(() => { setShowIntake((value) => !value) }, []),
    pinning,
    pinError,
    pinTemplate: React.useCallback(() => { void mutateFlow('pin') }, [mutateFlow]),
    materializeBaseline: React.useCallback(() => { void mutateFlow('baseline') }, [mutateFlow]),
    steps: React.useMemo(() => buildSteps(flow), [flow]),
    availability,
    runNextAction,
    openBlocker,
  }
}
