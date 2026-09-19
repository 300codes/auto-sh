import { z } from 'zod'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import {
  FLOW_APPROVAL_STAGE_ORDER,
  buildDeliveryFlowError,
  commentThreadTriageStatusSchema,
  type DeliveryErrorDetail,
  type DeliveryFlowCheckResult,
  type DeliveryFlowErrorResult,
  type FlowStageId,
  type FlowTemplateStage,
  type FlowTemplateV1,
  type StageCurrency,
  type StageDecisionRequest,
  type StageDecisionVerdict,
} from './contracts'
import { computeStageCurrency, type StageArtifactRecord, type StageDecisionRecord } from './flowRules'
import { hashCanonical } from './hash'

export const DEFERRED_BY_STAGE_DECISION = 'deferred_by_stage_decision'

export type CommentThreadTriageStatus = z.infer<typeof commentThreadTriageStatusSchema>

export type CommentThreadRecord = {
  threadKey: string
  stageId: FlowStageId
  artifactId: string | null
  sourceStatus: 'open' | 'resolved' | 'deleted'
  triageStatus: CommentThreadTriageStatus
  deferral: { artifactId: string; contentHash: string } | null
}

export type ThreadArtifactBinding = { artifactId: string; contentHash: string }

export type StoredStageDecisionRecord = StageDecisionRecord & { idempotencyKey: string; requestHash: string }

export type StageDecisionDraft = {
  stageId: FlowStageId
  artifactId: string
  subjectHash: string
  subjectVersion: number
  verdict: StageDecisionVerdict
  reason: string | null
  clientApproved: boolean
  deferredThreadKeys: string[]
}

export type ThreadDeferral = { threadKey: string; artifactId: string; contentHash: string; reason: string }

export type StageDecisionFailure = { ok: false } & DeliveryFlowErrorResult

export type StageDecisionPlan =
  | { ok: true; duplicate: true; existing: StoredStageDecisionRecord; currency: StageCurrency }
  | { ok: true; duplicate: false; requestHash: string; record: StageDecisionDraft; currency: StageCurrency; deferrals: ThreadDeferral[] }
  | StageDecisionFailure

function fail(result: DeliveryFlowErrorResult): StageDecisionFailure {
  return { ok: false, ...result }
}

/**
 * The replay hash covers the parsed request with optional fields normalised, so `{}` and `{ reason: null }` collide as
 * intended. The Idempotency-Key header itself is not part of the hash.
 */
export function hashStageDecisionRequest(request: StageDecisionRequest): string {
  return hashCanonical({
    artifactId: request.artifactId,
    subjectHash: request.subjectHash,
    subjectVersion: request.subjectVersion,
    verdict: request.verdict,
    reason: request.reason ?? null,
    clientApproval: request.clientApproval ?? null,
    deferredThreadKeys: request.deferredThreadKeys ?? [],
  })
}

/**
 * The route already required `delivery_os.stages.approve`; the pinned snapshot names who may approve this stage.
 * Wildcard grants (`*`, `delivery_os.*`) count, `projects.manage` alone does not. An empty list means the route
 * feature suffices.
 */
export function checkStageApprover(grantedFeatures: readonly string[], templateStage: Pick<FlowTemplateStage, 'stageId' | 'approverFeatures'>): DeliveryFlowCheckResult {
  if (authorizeFeatures(templateStage.approverFeatures, { grantedFeatures })) return { ok: true }
  return fail(
    buildDeliveryFlowError('forbidden', 'The caller may not decide this stage', [
      { path: `stages.${templateStage.stageId}.approverFeatures`, code: 'forbidden', message: `Requires ${templateStage.approverFeatures.join(', ')}` },
    ]),
  )
}

/** `projectDecisions` must hold every decision row of the project: the Idempotency-Key is unique per project, not per stage. */
export function findReplayedStageDecision(projectDecisions: readonly StoredStageDecisionRecord[], idempotencyKey: string): StoredStageDecisionRecord | null {
  return projectDecisions.find((decision) => decision.idempotencyKey === idempotencyKey) ?? null
}

/**
 * Open feedback that has not been triaged blocks an approval: threads bound to this artifact, and threads of the same
 * stage without a confirmed design version (never auto-bound to the latest snapshot, so they fail closed). A deferral
 * is hash-bound: it only lifts the block while the artifact it was recorded for is still the current version.
 */
export function blockingThreadsFor(threads: readonly CommentThreadRecord[], stageId: FlowStageId, artifact: ThreadArtifactBinding): CommentThreadRecord[] {
  return threads.filter((thread) => {
    if (thread.stageId !== stageId || thread.sourceStatus !== 'open' || thread.triageStatus === 'resolved') return false
    if (thread.artifactId !== artifact.artifactId && thread.artifactId !== null) return false
    if (thread.triageStatus !== 'deferred') return true
    return !isDeferredFor(thread, artifact)
  })
}

export function isDeferredFor(thread: CommentThreadRecord, artifact: ThreadArtifactBinding): boolean {
  return thread.triageStatus === 'deferred' && thread.deferral !== null && thread.deferral.artifactId === artifact.artifactId && thread.deferral.contentHash === artifact.contentHash
}

function currentArtifactOf(artifacts: readonly StageArtifactRecord[], stageId: FlowStageId): StageArtifactRecord | null {
  let current: StageArtifactRecord | null = null
  for (const artifact of artifacts) {
    if (artifact.stageId === stageId && (!current || artifact.version > current.version)) current = artifact
  }
  return current
}

function currencyWith(template: FlowTemplateV1, artifacts: readonly StageArtifactRecord[], decisions: readonly StageDecisionRecord[], stageId: FlowStageId): StageCurrency {
  return computeStageCurrency(template, artifacts, decisions)[stageId].currency
}

type SubjectBinding = { ok: true; artifact: StageArtifactRecord } | StageDecisionFailure

function checkSubjectBinding(request: StageDecisionRequest, stageId: FlowStageId, artifacts: readonly StageArtifactRecord[]): SubjectBinding {
  const artifact = artifacts.find((candidate) => candidate.id === request.artifactId && candidate.stageId === stageId)
  if (!artifact) {
    return fail(
      buildDeliveryFlowError('foreign_reference', 'Artifact does not belong to this stage of the project', [
        { path: 'artifactId', code: 'foreign_artifact', message: `${request.artifactId} is not a ${stageId} artifact of this project` },
      ]),
    )
  }
  const current = currentArtifactOf(artifacts, stageId)
  if (!current || current.id !== artifact.id) {
    return fail(
      buildDeliveryFlowError('stage_artifact_stale', 'The artifact is no longer the current version of the stage', [
        { path: 'artifactId', code: 'stage_artifact_stale', message: `Current ${stageId} artifact is ${current?.id ?? 'missing'} v${current?.version ?? 0}` },
      ]),
    )
  }
  const details: DeliveryErrorDetail[] = []
  if (request.subjectHash !== artifact.contentHash) {
    details.push({ path: 'subjectHash', code: 'subject_hash_mismatch', message: 'subjectHash does not match the artifact content hash' })
  }
  if (request.subjectVersion !== artifact.version) {
    details.push({ path: 'subjectVersion', code: 'subject_hash_mismatch', message: `Artifact version is ${artifact.version}` })
  }
  if (details.length > 0) return fail(buildDeliveryFlowError('subject_hash_mismatch', 'Decision subject does not match the artifact', details))
  return { ok: true, artifact }
}

function checkUpstreamCurrency(
  template: FlowTemplateV1,
  artifact: StageArtifactRecord,
  artifacts: readonly StageArtifactRecord[],
  decisions: readonly StageDecisionRecord[],
): DeliveryFlowCheckResult {
  const states = computeStageCurrency(template, artifacts, decisions)
  const templateStage = template.stages.find((stage) => stage.kind === artifact.stageId)
  const upstream = FLOW_APPROVAL_STAGE_ORDER.filter((candidate) => (templateStage?.dependsOn ?? []).includes(candidate))
  const approvalDetails = upstream
    .filter((upstreamId) => states[upstreamId].currency !== 'approved')
    .map((upstreamId) => ({
      path: `stages.${upstreamId}`,
      code: states[upstreamId].currency === 'stale' ? 'stage_dependency_stale' : 'stage_not_approved',
      message: `Upstream stage ${upstreamId} is ${states[upstreamId].currency}`,
    }))
  if (approvalDetails.length > 0) {
    const code = approvalDetails.some((detail) => detail.code === 'stage_not_approved') ? 'stage_not_approved' : 'stage_dependency_stale'
    return fail(buildDeliveryFlowError(code, 'Upstream stages are not approved and current', approvalDetails))
  }
  const bindingDetails = upstream
    .filter((upstreamId) => {
      const bound = artifact.dependsOn.find((dependency) => dependency.stageId === upstreamId)
      const current = states[upstreamId].currentArtifact
      return !bound || !current || bound.artifactId !== current.artifactId || bound.contentHash !== current.contentHash
    })
    .map((upstreamId) => ({ path: `dependsOn.${upstreamId}`, code: 'stage_dependency_stale', message: `The artifact is not bound to the current ${upstreamId} artifact` }))
  if (bindingDetails.length === 0) return { ok: true }
  return fail(buildDeliveryFlowError('stage_dependency_stale', 'The artifact is bound to a superseded upstream version', bindingDetails))
}

function checkDeferredKeys(request: StageDecisionRequest, stageId: FlowStageId, threads: readonly CommentThreadRecord[]): DeliveryFlowCheckResult {
  const stageThreads = new Set(threads.filter((thread) => thread.stageId === stageId).map((thread) => thread.threadKey))
  const details = (request.deferredThreadKeys ?? [])
    .map((threadKey, index) => ({ threadKey, index }))
    .filter(({ threadKey }) => !stageThreads.has(threadKey))
    .map(({ threadKey, index }) => ({ path: `deferredThreadKeys.${index}`, code: 'unknown_thread', message: `${threadKey} is not a thread of stage ${stageId}` }))
  if (details.length === 0) return { ok: true }
  return fail(buildDeliveryFlowError('foreign_reference', 'Deferred thread does not belong to this stage', details))
}

/**
 * Pure planning of F8 (`stages.decide`). Order: approver → replay (same key: same stage and hash is a duplicate, anything
 * else a conflict; `projectDecisions` are all rows of the project, every stage) → subject identity → current version →
 * hash/version → verdict checks. A rejection only needs its
 * reason; an approval needs the upstream chain approved and current, the client approval the template demands and
 * no open un-triaged feedback that is not explicitly deferred for this artifact hash. The stored `deferredThreadKeys`
 * are exactly the keys that produced a deferral record, never the raw client list.
 */
export function planStageDecision(input: {
  request: StageDecisionRequest
  idempotencyKey: string
  stageId: FlowStageId
  template: FlowTemplateV1
  grantedFeatures: readonly string[]
  artifacts: readonly StageArtifactRecord[]
  projectDecisions: readonly StoredStageDecisionRecord[]
  threads: readonly CommentThreadRecord[]
  now: string
}): StageDecisionPlan {
  const { request, stageId, template, artifacts, threads } = input
  const decisions = input.projectDecisions
  const templateStage = template.stages.find((stage) => stage.kind === stageId)
  if (!templateStage) {
    return fail(buildDeliveryFlowError('stage_unknown', 'Stage is not part of the pinned template', [{ path: 'stageId', code: 'stage_unknown', message: stageId }]))
  }
  const approver = checkStageApprover(input.grantedFeatures, templateStage)
  if (!approver.ok) return approver

  const requestHash = hashStageDecisionRequest(request)
  const replayed = findReplayedStageDecision(decisions, input.idempotencyKey)
  if (replayed) {
    if (replayed.stageId === stageId && replayed.requestHash === requestHash) {
      return { ok: true, duplicate: true, existing: replayed, currency: currencyWith(template, artifacts, decisions, stageId) }
    }
    return fail(
      buildDeliveryFlowError('idempotency_conflict', 'Idempotency-Key was used with a different request', [
        { path: 'idempotencyKey', code: 'idempotency_conflict', message: 'Same key, different stage or body' },
      ]),
    )
  }

  const subject = checkSubjectBinding(request, stageId, artifacts)
  if (!subject.ok) return subject
  const artifact = subject.artifact

  if (request.verdict === 'rejected' && !request.reason) {
    return fail(buildDeliveryFlowError('reason_required', 'A rejection needs a reason', [{ path: 'reason', code: 'reason_required', message: 'A rejection needs a reason' }]))
  }

  let deferrals: ThreadDeferral[] = []
  if (request.verdict === 'approved') {
    const upstream = checkUpstreamCurrency(template, artifact, artifacts, decisions)
    if (!upstream.ok) return upstream
    if (templateStage.requiresClientApproval && !request.clientApproval) {
      return fail(
        buildDeliveryFlowError('client_approval_required', 'This stage needs a recorded client approval', [
          { path: 'clientApproval', code: 'client_approval_required', message: `${stageId} requires client approval` },
        ]),
      )
    }
    const deferredCheck = checkDeferredKeys(request, stageId, threads)
    if (!deferredCheck.ok) return deferredCheck
    const deferredKeys = new Set(request.deferredThreadKeys ?? [])
    const blocking = blockingThreadsFor(threads, stageId, { artifactId: artifact.id, contentHash: artifact.contentHash })
    const stillOpen = blocking.filter((thread) => !deferredKeys.has(thread.threadKey))
    if (stillOpen.length > 0) {
      return fail(
        buildDeliveryFlowError(
          'blocking_comments_open',
          'Open feedback must be resolved or explicitly deferred before approval',
          stillOpen.map((thread) => ({ path: `threads.${thread.threadKey}`, code: 'blocking_comments_open', message: `Thread ${thread.threadKey} is open and not triaged` })),
        ),
      )
    }
    deferrals = blocking
      .filter((thread) => deferredKeys.has(thread.threadKey))
      .map((thread) => ({ threadKey: thread.threadKey, artifactId: artifact.id, contentHash: artifact.contentHash, reason: request.reason ?? DEFERRED_BY_STAGE_DECISION }))
  }

  const record: StageDecisionDraft = {
    stageId,
    artifactId: artifact.id,
    subjectHash: artifact.contentHash,
    subjectVersion: artifact.version,
    verdict: request.verdict,
    reason: request.reason ?? null,
    clientApproved: request.verdict === 'approved' && Boolean(request.clientApproval),
    deferredThreadKeys: [...new Set(deferrals.map((deferral) => deferral.threadKey))],
  }
  const projected: StageDecisionRecord = {
    id: `pending:${input.idempotencyKey}`,
    stageId,
    artifactId: artifact.id,
    subjectHash: artifact.contentHash,
    verdict: request.verdict,
    decidedAt: input.now,
    clientApproved: record.clientApproved,
  }
  return { ok: true, duplicate: false, requestHash, record, currency: currencyWith(template, artifacts, [...decisions, projected], stageId), deferrals }
}
