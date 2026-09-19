import {
  FLOW_APPROVAL_STAGE_ORDER,
  buildDeliveryFlowError,
  type DeliveryFlowCheckResult,
  type FlowBlocker,
  type FlowGateDetailCode,
  type FlowStageId,
  type FlowTemplateV1,
  type StageArtifactDependency,
  type StageArtifactRef,
  type StageCurrency,
  type StageDecisionVerdict,
} from './contracts'
import { hashCanonical } from './hash'

export function hashFlowTemplate(template: FlowTemplateV1): string {
  return hashCanonical(template)
}

export type StageArtifactRecord = {
  id: string
  stageId: FlowStageId
  version: number
  contentHash: string
  dependsOn: readonly StageArtifactDependency[]
}

export type StageDecisionRecord = {
  id: string
  stageId: FlowStageId
  artifactId: string
  subjectHash: string
  verdict: StageDecisionVerdict
  decidedAt: string
  clientApproved: boolean
}

export type StageCurrencyState = {
  stageId: FlowStageId
  currency: StageCurrency
  currentArtifact: StageArtifactRef | null
  approvedArtifact: StageArtifactRef | null
  latestDecision: { decisionId: string; verdict: StageDecisionVerdict; decidedAt: string; clientApproved: boolean } | null
  blockers: FlowBlocker[]
}

export type StageCurrencyMap = Record<FlowStageId, StageCurrencyState>

type CurrencyOptions = { openThreadsByStage?: Partial<Record<FlowStageId, number>> }

function toRef(artifact: StageArtifactRecord): StageArtifactRef {
  return { artifactId: artifact.id, version: artifact.version, contentHash: artifact.contentHash }
}

function latestArtifact(artifacts: readonly StageArtifactRecord[], stageId: FlowStageId): StageArtifactRecord | null {
  let latest: StageArtifactRecord | null = null
  for (const artifact of artifacts) {
    if (artifact.stageId !== stageId) continue
    if (!latest || artifact.version > latest.version) latest = artifact
  }
  return latest
}

function latestDecisionFor(decisions: readonly StageDecisionRecord[], artifact: StageArtifactRecord): StageDecisionRecord | null {
  let latest: StageDecisionRecord | null = null
  for (const decision of decisions) {
    if (decision.artifactId !== artifact.id || decision.subjectHash !== artifact.contentHash) continue
    if (!latest || decision.decidedAt > latest.decidedAt || (decision.decidedAt === latest.decidedAt && decision.id > latest.id)) {
      latest = decision
    }
  }
  return latest
}

function isEffectiveApproval(decision: StageDecisionRecord | null, requiresClientApproval: boolean): boolean {
  return decision?.verdict === 'approved' && (!requiresClientApproval || decision.clientApproved)
}

function lastApprovedArtifact(
  artifacts: readonly StageArtifactRecord[],
  decisions: readonly StageDecisionRecord[],
  stageId: FlowStageId,
  requiresClientApproval: boolean,
): StageArtifactRef | null {
  const candidates = artifacts.filter((artifact) => artifact.stageId === stageId).sort((left, right) => right.version - left.version)
  for (const artifact of candidates) {
    if (isEffectiveApproval(latestDecisionFor(decisions, artifact), requiresClientApproval)) return toRef(artifact)
  }
  return null
}

/**
 * Derives the currency of every approval stage from the pinned template, the append-only artifact rows and the
 * append-only decision rows. Nothing is stored: a new upstream artifact version, a rejection or a hash change
 * downgrades the dependants to `stale` while their history stays readable.
 */
export function computeStageCurrency(
  template: FlowTemplateV1,
  artifacts: readonly StageArtifactRecord[],
  decisions: readonly StageDecisionRecord[],
  options: CurrencyOptions = {},
): StageCurrencyMap {
  const states = {} as StageCurrencyMap
  for (const stageId of FLOW_APPROVAL_STAGE_ORDER) {
    const templateStage = template.stages.find((stage) => stage.kind === stageId)
    const requiresClientApproval = templateStage?.requiresClientApproval ?? false
    const blockers: FlowBlocker[] = []
    const current = latestArtifact(artifacts, stageId)
    const approvedArtifact = lastApprovedArtifact(artifacts, decisions, stageId, requiresClientApproval)
    const openThreads = options.openThreadsByStage?.[stageId] ?? 0
    if (!current) {
      blockers.push({ kind: 'artifact_missing', stageId, ref: null })
      states[stageId] = { stageId, currency: 'missing', currentArtifact: null, approvedArtifact, latestDecision: null, blockers }
      continue
    }
    const decision = latestDecisionFor(decisions, current)
    const latestDecision = decision
      ? { decisionId: decision.id, verdict: decision.verdict, decidedAt: decision.decidedAt, clientApproved: decision.clientApproved }
      : null
    let currency: StageCurrency
    if (!decision) {
      currency = 'pending'
      blockers.push({ kind: 'decision_pending', stageId, ref: current.id })
    } else if (decision.verdict === 'rejected') {
      currency = 'rejected'
      blockers.push({ kind: 'rejected', stageId, ref: decision.id })
    } else if (requiresClientApproval && !decision.clientApproved) {
      currency = 'pending'
      blockers.push({ kind: 'decision_pending', stageId, ref: current.id })
    } else {
      currency = 'approved'
      const requiredUpstream = (templateStage?.dependsOn ?? []).filter((dependency): dependency is FlowStageId =>
        (FLOW_APPROVAL_STAGE_ORDER as readonly string[]).includes(dependency),
      )
      for (const upstreamId of requiredUpstream) {
        const upstream = states[upstreamId]
        const bound = current.dependsOn.find((dependency) => dependency.stageId === upstreamId)
        if (!upstream || upstream.currency !== 'approved') {
          currency = 'stale'
          blockers.push({ kind: 'upstream_not_approved', stageId, ref: upstreamId })
          continue
        }
        if (!bound || !upstream.currentArtifact || upstream.currentArtifact.contentHash !== bound.contentHash) {
          currency = 'stale'
          blockers.push({ kind: 'upstream_stale', stageId, ref: upstreamId })
        }
      }
    }
    if (openThreads > 0) blockers.push({ kind: 'open_comments', stageId, ref: String(openThreads) })
    states[stageId] = { stageId, currency, currentArtifact: toRef(current), approvedArtifact, latestDecision, blockers }
  }
  return states
}

export type FlowGateOptions = {
  /** The v1 routes (task ready, attempt reserve, deploy decision) answer a frozen v1 code so v1 clients keep parsing. */
  v1Compatible?: boolean
}

function gateDetailCode(currency: StageCurrency | undefined): FlowGateDetailCode {
  return currency === 'stale' ? 'stage_dependency_stale' : 'stage_not_approved'
}

/**
 * The server-side gate: dispatch (task ready, attempt reserve in any mode), publish consent and publication all
 * require every listed approval stage to be `approved` and current. Legacy projects without a pinned template are
 * not gated (the caller passes `null` and gets `ok`).
 */
export function checkFlowGate(
  states: StageCurrencyMap | null,
  requiredStages: readonly FlowStageId[] = FLOW_APPROVAL_STAGE_ORDER,
  options: FlowGateOptions = {},
): DeliveryFlowCheckResult {
  if (states === null) return { ok: true }
  const details = requiredStages
    .filter((stageId) => states[stageId]?.currency !== 'approved')
    .map((stageId) => ({
      path: `stages.${stageId}`,
      code: gateDetailCode(states[stageId]?.currency),
      message: `Stage ${stageId} is ${states[stageId]?.currency ?? 'missing'}`,
    }))
  if (details.length === 0) return { ok: true }
  const code = options.v1Compatible ? 'baseline_not_approved' : 'stage_not_approved'
  return { ok: false, ...buildDeliveryFlowError(code, 'Flow stages are not approved', details) }
}

export function flowGateBlockers(states: StageCurrencyMap | null, requiredStages: readonly FlowStageId[] = FLOW_APPROVAL_STAGE_ORDER): FlowBlocker[] {
  if (states === null) return [{ kind: 'template_not_pinned', stageId: null, ref: null }]
  return requiredStages.flatMap((stageId) => states[stageId]?.blockers ?? [])
}

export type FrozenTargetProfile = { targetProfileId: string; targetProfileVersion: number }

/**
 * The target profile of an existing project is frozen at creation (v1). Scope may confirm it, never change it; a
 * different platform means a new project.
 */
export function checkPlatformChoiceFrozen(
  project: FrozenTargetProfile,
  chosen: { profileId: string; profileVersion: number } | null,
): DeliveryFlowCheckResult {
  if (chosen === null) return { ok: true }
  if (chosen.profileId === project.targetProfileId && chosen.profileVersion === project.targetProfileVersion) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryFlowError('target_profile_frozen', 'The project target profile is frozen', [
      {
        path: 'platform.chosen',
        code: 'target_profile_frozen',
        message: `Project is ${project.targetProfileId}@${project.targetProfileVersion}; chosen ${chosen.profileId}@${chosen.profileVersion}`,
      },
    ]),
  }
}
