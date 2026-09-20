import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { FlowBlockerKind, FlowStatusV1, StageCurrency } from '../../lib/contracts'

export const LIST_VISIBLE_BLOCKERS = 2

export type FlowHighlightState = 'blocked' | 'ready' | 'inProgress'

export type FlowHighlightBlocker = { kind: FlowBlockerKind; stageId: string | null }

export type FlowHighlight = {
  state: FlowHighlightState
  tone: StatusBadgeVariant
  nextActionKind: FlowStatusV1['nextAction']['kind']
  stageId: string | null
  currency: StageCurrency | null
  blockers: FlowHighlightBlocker[]
  hiddenBlockerCount: number
  pendingApprovals: number
}

const stateTones: Record<FlowHighlightState, StatusBadgeVariant> = {
  blocked: 'warning',
  ready: 'success',
  inProgress: 'info',
}

export function buildFlowHighlight(flow: FlowStatusV1): FlowHighlight {
  const state: FlowHighlightState = flow.blockers.length > 0
    ? 'blocked'
    : flow.nextAction.kind === 'none' ? 'ready' : 'inProgress'
  const stageId = flow.nextAction.stageId ?? flow.currentStageId
  const stage = flow.stages.find((candidate) => candidate.stageId === stageId)
  return {
    state,
    tone: stateTones[state],
    nextActionKind: flow.nextAction.kind,
    stageId,
    currency: stage?.currency ?? null,
    blockers: flow.blockers.slice(0, LIST_VISIBLE_BLOCKERS).map((blocker) => ({ kind: blocker.kind, stageId: blocker.stageId })),
    hiddenBlockerCount: Math.max(0, flow.blockers.length - LIST_VISIBLE_BLOCKERS),
    pendingApprovals: flow.pendingApprovals.length,
  }
}
