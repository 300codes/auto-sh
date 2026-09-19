import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  FLOW_APPROVAL_STAGE_ORDER,
  type DeliveryReportFlowSection,
  type FlowBlocker,
  type FlowGate,
  type FlowPendingApproval,
  type FlowStageId,
  type FlowStageStatus,
  type FlowStatusV1,
  type FlowTemplateRef,
  type FlowTemplateV1,
  type IntakeStep,
} from './contracts'
import { isAttemptActive, type AttemptRegister } from './attempts'
import { blockingThreadsFor, type CommentThreadRecord } from './stageDecisions'
import {
  checkFlowGate,
  computeStageCurrency,
  flowGateBlockers,
  type StageArtifactRecord,
  type StageCurrencyMap,
  type StageDecisionRecord,
} from './flowRules'

export type FlowStatusArtifactRecord = StageArtifactRecord & { createdAt?: string }

export type FlowStatusProject = {
  projectId: string
  template: FlowTemplateV1 | null
  templateRef: FlowTemplateRef | null
  workflowInstanceId: string | null
  updatedAt: string
}

export type FlowStatusInput = {
  project: FlowStatusProject
  intakeStep: IntakeStep | null
  artifacts: readonly FlowStatusArtifactRecord[]
  decisions: readonly StageDecisionRecord[]
  openThreadsByStage: Partial<Record<FlowStageId, number>>
  attempts: AttemptRegister
}

type NextAction = FlowStatusV1['nextAction']

const OPEN_GATE: FlowGate = { ok: true, blocking: [] }

function isApprovalStage(stageId: string): stageId is FlowStageId {
  return (FLOW_APPROVAL_STAGE_ORDER as readonly string[]).includes(stageId)
}

/** One blocker per attempt that is still running or whose outcome is unknown: nothing may be dispatched over it. */
export function attemptBlockers(register: AttemptRegister): FlowBlocker[] {
  return register
    .filter((attempt) => isAttemptActive(attempt) || attempt.state === 'reconciliation_required')
    .map((attempt) => ({ kind: 'attempt_active' as const, stageId: null, ref: attempt.attemptId }))
}

export function pendingApprovalsFor(template: FlowTemplateV1, states: StageCurrencyMap): FlowPendingApproval[] {
  const pending: FlowPendingApproval[] = []
  for (const stage of template.stages) {
    if (!isApprovalStage(stage.kind)) continue
    const state = states[stage.kind]
    if (state.currency !== 'pending' || !state.currentArtifact) continue
    pending.push({
      stageId: stage.kind,
      artifactId: state.currentArtifact.artifactId,
      contentHash: state.currentArtifact.contentHash,
      version: state.currentArtifact.version,
      approverFeatures: [...stage.approverFeatures],
      clientApprovalRequired: stage.requiresClientApproval,
    })
  }
  return pending
}

function stageStatuses(template: FlowTemplateV1, states: StageCurrencyMap, pending: readonly FlowPendingApproval[], openThreadsByStage: FlowStatusInput['openThreadsByStage']): FlowStageStatus[] {
  return template.stages.map((stage) => {
    if (!isApprovalStage(stage.kind)) {
      return { stageId: stage.stageId, kind: stage.kind, title: stage.title, currency: null, currentArtifact: null, approvedArtifact: null, latestDecision: null, pendingApproval: null, blockers: [], openThreads: 0 }
    }
    const state = states[stage.kind]
    return {
      stageId: stage.stageId,
      kind: stage.kind,
      title: stage.title,
      currency: state.currency,
      currentArtifact: state.currentArtifact,
      approvedArtifact: state.approvedArtifact,
      latestDecision: state.latestDecision,
      pendingApproval: pending.find((approval) => approval.stageId === stage.kind) ?? null,
      blockers: state.blockers,
      openThreads: openThreadsByStage[stage.kind] ?? 0,
    }
  })
}

function approvalStagesInTemplateOrder(template: FlowTemplateV1): FlowStageId[] {
  return template.stages.map((stage) => stage.kind).filter(isApprovalStage)
}

function firstNonApprovalStage(template: FlowTemplateV1): string | null {
  return template.stages.find((stage) => !isApprovalStage(stage.kind))?.stageId ?? null
}

function nextActionFor(
  template: FlowTemplateV1,
  states: StageCurrencyMap,
  intakeStep: IntakeStep | null,
  openThreadsByStage: FlowStatusInput['openThreadsByStage'],
  attemptBlocked: boolean,
): { currentStageId: string | null; nextAction: NextAction } {
  if (intakeStep !== null && intakeStep !== 'submitted') return { currentStageId: null, nextAction: { kind: 'complete_intake', stageId: null } }
  for (const stageId of approvalStagesInTemplateOrder(template)) {
    const state = states[stageId]
    if (state.currency === 'approved') continue
    if (state.currency === 'missing' || state.currency === 'stale') return { currentStageId: stageId, nextAction: { kind: 'create_artifact', stageId } }
    if (state.currency === 'rejected') return { currentStageId: stageId, nextAction: { kind: 'fix_rejection', stageId } }
    if ((openThreadsByStage[stageId] ?? 0) > 0) return { currentStageId: stageId, nextAction: { kind: 'resolve_comments', stageId } }
    return { currentStageId: stageId, nextAction: { kind: 'approve_stage', stageId } }
  }
  const currentStageId = firstNonApprovalStage(template)
  return { currentStageId, nextAction: attemptBlocked ? { kind: 'none', stageId: null } : { kind: 'dispatch', stageId: currentStageId } }
}

function latestTimestamp(project: FlowStatusProject, artifacts: readonly FlowStatusArtifactRecord[], decisions: readonly StageDecisionRecord[]): string {
  let latest = project.updatedAt
  for (const artifact of artifacts) if (artifact.createdAt && artifact.createdAt > latest) latest = artifact.createdAt
  for (const decision of decisions) if (decision.decidedAt > latest) latest = decision.decidedAt
  return latest
}

/** Open comments gate an approval (F8), never dispatch or publication, so they stay out of the gate lists. */
function gateFrom(states: StageCurrencyMap, extraBlockers: readonly FlowBlocker[] = []): FlowGate {
  const check = checkFlowGate(states)
  const blocking = [...flowGateBlockers(states).filter((blocker) => blocker.kind !== 'open_comments'), ...extraBlockers]
  return { ok: check.ok && extraBlockers.length === 0, blocking }
}

/** The F6 route derives its per-stage open-thread counts from the same predicate F8 blocks on. */
export function countBlockingThreadsByStage(threads: readonly CommentThreadRecord[], states: StageCurrencyMap): Partial<Record<FlowStageId, number>> {
  const counts: Partial<Record<FlowStageId, number>> = {}
  for (const stageId of FLOW_APPROVAL_STAGE_ORDER) {
    const current = states[stageId]?.currentArtifact
    if (!current) continue
    const count = blockingThreadsFor(threads, stageId, current).length
    if (count > 0) counts[stageId] = count
  }
  return counts
}

/**
 * The F6 read model. Legacy projects (no pinned template) keep the v1 behaviour: no stages, gates open, one
 * informational `template_not_pinned` blocker. Pinned projects derive everything from the snapshot plus the
 * append-only artifact and decision rows; nothing here mutates or stores state.
 */
export function buildFlowStatus(input: FlowStatusInput): FlowStatusV1 {
  const { project } = input
  const attempts = attemptBlockers(input.attempts)
  const base = {
    schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.flowStatus,
    projectId: project.projectId,
    template: project.templateRef,
    workflowInstanceId: project.workflowInstanceId,
    intakeStep: input.intakeStep,
    updatedAt: latestTimestamp(project, input.artifacts, input.decisions),
  }
  if (project.template === null) {
    return {
      ...base,
      template: null,
      currentStageId: null,
      stages: [],
      pendingApprovals: [],
      blockers: [...flowGateBlockers(null), ...attempts],
      gates: { dispatchable: OPEN_GATE, publishable: OPEN_GATE },
      nextAction: input.intakeStep !== null ? { kind: 'pin_template', stageId: null } : { kind: 'none', stageId: null },
    }
  }
  const states = computeStageCurrency(project.template, input.artifacts, input.decisions, { openThreadsByStage: input.openThreadsByStage })
  const pendingApprovals = pendingApprovalsFor(project.template, states)
  const intakeBlockers: FlowBlocker[] = input.intakeStep !== null && input.intakeStep !== 'submitted' ? [{ kind: 'intake_incomplete', stageId: null, ref: input.intakeStep }] : []
  const { currentStageId, nextAction } = nextActionFor(project.template, states, input.intakeStep, input.openThreadsByStage, attempts.length > 0)
  return {
    ...base,
    currentStageId,
    stages: stageStatuses(project.template, states, pendingApprovals, input.openThreadsByStage),
    pendingApprovals,
    blockers: [...intakeBlockers, ...flowGateBlockers(states), ...attempts],
    gates: { dispatchable: gateFrom(states, attempts), publishable: gateFrom(states) },
    nextAction,
  }
}

/** F15: the optional `flow` section of the v1 report. `null` for legacy projects so the R22 answer stays untouched. */
export function buildDeliveryReportFlowSection(input: Pick<FlowStatusInput, 'project' | 'artifacts' | 'decisions'>): DeliveryReportFlowSection | null {
  const { project } = input
  if (project.template === null || project.templateRef === null) return null
  const states = computeStageCurrency(project.template, input.artifacts, input.decisions)
  return {
    template: project.templateRef,
    stages: FLOW_APPROVAL_STAGE_ORDER.map((stageId) => ({
      stageId,
      currency: states[stageId].currency,
      approvedArtifact: states[stageId].approvedArtifact,
      decisionId: states[stageId].latestDecision?.decisionId ?? null,
      clientApproved: states[stageId].latestDecision?.clientApproved ?? false,
    })),
    gate: gateFrom(states),
  }
}
