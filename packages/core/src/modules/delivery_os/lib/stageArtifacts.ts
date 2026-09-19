import {
  FLOW_APPROVAL_STAGE_ORDER,
  buildDeliveryFlowError,
  type DeliveryErrorDetail,
  type DeliveryFlowCheckResult,
  type DeliveryFlowErrorResult,
  type FlowStageId,
  type FlowTemplateV1,
  type StageArtifactRef,
  type StageArtifactV1,
} from './contracts'
import {
  checkPlatformChoiceFrozen,
  computeStageCurrency,
  type FrozenTargetProfile,
  type StageArtifactRecord,
  type StageDecisionRecord,
} from './flowRules'
import { hashCanonical } from './hash'

export type StageArtifactProjectContext = FrozenTargetProfile & { projectId: string }

export type StageArtifactFailure = { ok: false } & DeliveryFlowErrorResult

export type AcReference = { path: string; acId: string }

export type StageArtifactPlan =
  | { ok: true; duplicate: true; existing: StageArtifactRef; isCurrent: boolean; downstreamNowStale: FlowStageId[] }
  | { ok: true; duplicate: false; version: number; contentHash: string; downstreamNowStale: FlowStageId[] }
  | StageArtifactFailure

function fail(result: DeliveryFlowErrorResult): StageArtifactFailure {
  return { ok: false, ...result }
}

/**
 * The content hash covers what an approval is about: the stage, its content, the upstream versions it was built on
 * and its attachments. `projectId`, `source` and `producedBy` are provenance, so identical content from another source
 * is a duplicate, while rebinding to a new upstream version is new content that needs a new approval.
 */
export function hashStageArtifactContent(artifact: StageArtifactV1): string {
  return hashCanonical({
    schemaVersion: artifact.schemaVersion,
    stageId: artifact.stageId,
    content: artifact.content,
    dependsOn: artifact.dependsOn,
    attachments: artifact.attachments,
  })
}

export function nextStageArtifactVersion(existing: readonly StageArtifactRecord[], stageId: FlowStageId): number {
  return existing.reduce((highest, artifact) => (artifact.stageId === stageId && artifact.version > highest ? artifact.version : highest), 0) + 1
}

function currentArtifactOf(existing: readonly StageArtifactRecord[], stageId: FlowStageId): StageArtifactRecord | null {
  let current: StageArtifactRecord | null = null
  for (const artifact of existing) {
    if (artifact.stageId === stageId && (!current || artifact.version > current.version)) current = artifact
  }
  return current
}

export function findDuplicateStageArtifact(
  existing: readonly StageArtifactRecord[],
  stageId: FlowStageId,
  contentHash: string,
): StageArtifactRecord | null {
  return existing.find((artifact) => artifact.stageId === stageId && artifact.contentHash === contentHash) ?? null
}

/**
 * Every approval stage that depends on `stageId` through the pinned template (transitively) and already has an
 * artifact: its binding chain now points at a superseded version, so it needs a new version and a new approval.
 */
export function downstreamStagesWithArtifacts(
  template: FlowTemplateV1,
  existing: readonly StageArtifactRecord[],
  stageId: FlowStageId,
): FlowStageId[] {
  const reached = new Set<string>([stageId])
  let grew = true
  while (grew) {
    grew = false
    for (const stage of template.stages) {
      if (reached.has(stage.stageId) || !stage.dependsOn.some((dependency) => reached.has(dependency))) continue
      reached.add(stage.stageId)
      grew = true
    }
  }
  return FLOW_APPROVAL_STAGE_ORDER.filter(
    (candidate) => candidate !== stageId && reached.has(candidate) && existing.some((artifact) => artifact.stageId === candidate),
  )
}

export function checkAcReferences(knownAcIds: ReadonlySet<string> | null, references: readonly AcReference[]): DeliveryFlowCheckResult {
  const details = references
    .filter((reference) => !knownAcIds || !knownAcIds.has(reference.acId))
    .map((reference) => ({ path: reference.path, code: 'unknown_ac', message: `${reference.acId} is not part of the approved scope` }))
  if (details.length === 0) return { ok: true }
  return fail(buildDeliveryFlowError('unknown_ac', 'Acceptance criterion is not part of the approved scope', details))
}

function checkDependencyShape(artifact: StageArtifactV1): DeliveryFlowCheckResult {
  const ownIndex = FLOW_APPROVAL_STAGE_ORDER.indexOf(artifact.stageId)
  const seen = new Set<string>()
  const duplicates: DeliveryErrorDetail[] = []
  const notUpstream: DeliveryErrorDetail[] = []
  artifact.dependsOn.forEach((dependency, index) => {
    if (seen.has(dependency.stageId)) {
      duplicates.push({ path: `dependsOn.${index}.stageId`, code: 'duplicate_stable_id', message: `Duplicate dependency ${dependency.stageId}` })
    }
    seen.add(dependency.stageId)
    if (FLOW_APPROVAL_STAGE_ORDER.indexOf(dependency.stageId) >= ownIndex) {
      notUpstream.push({ path: `dependsOn.${index}.stageId`, code: 'foreign_dependency', message: `${dependency.stageId} is not upstream of ${artifact.stageId}` })
    }
  })
  if (notUpstream.length > 0) return fail(buildDeliveryFlowError('foreign_dependency', 'Dependency is not upstream', notUpstream))
  if (duplicates.length > 0) return fail(buildDeliveryFlowError('duplicate_stable_id', 'Duplicate dependency', duplicates))
  return { ok: true }
}

function checkDependencyReferences(artifact: StageArtifactV1, existing: readonly StageArtifactRecord[]): DeliveryFlowCheckResult {
  const details: DeliveryErrorDetail[] = []
  artifact.dependsOn.forEach((dependency, index) => {
    const bound = existing.find((candidate) => candidate.id === dependency.artifactId)
    if (!bound || bound.stageId !== dependency.stageId) {
      details.push({ path: `dependsOn.${index}.artifactId`, code: 'foreign_artifact', message: `${dependency.artifactId} is not a ${dependency.stageId} artifact of this project` })
      return
    }
    if (bound.version !== dependency.version || bound.contentHash !== dependency.contentHash) {
      details.push({ path: `dependsOn.${index}`, code: 'dependency_mismatch', message: `Version or hash does not match artifact ${dependency.artifactId}` })
    }
  })
  if (details.length === 0) return { ok: true }
  return fail(buildDeliveryFlowError('foreign_reference', 'Dependency does not reference an artifact of this project', details))
}

function requiredUpstreamStages(template: FlowTemplateV1, artifact: StageArtifactV1): FlowStageId[] {
  const templateStage = template.stages.find((stage) => stage.kind === artifact.stageId)
  const required = new Set<string>([...(templateStage?.dependsOn ?? []), ...artifact.dependsOn.map((dependency) => dependency.stageId)])
  return FLOW_APPROVAL_STAGE_ORDER.filter((stageId) => required.has(stageId))
}

/**
 * Pure planning of F7 (`stages.create_artifact`). Order: project → replay (identical content wins before any other
 * check) → dependency shape → references → upstream approval → binding currency → frozen profile (Scope) → AC ids.
 * The first failing category stops the evaluation and lists every offending entry.
 */
export function planStageArtifact(input: {
  artifact: StageArtifactV1
  project: StageArtifactProjectContext
  template: FlowTemplateV1
  existing: readonly StageArtifactRecord[]
  decisions: readonly StageDecisionRecord[]
  resolvedScopeAcIds?: ReadonlySet<string> | null
  acReferences?: readonly AcReference[]
}): StageArtifactPlan {
  const { artifact, project, template, existing } = input
  if (artifact.projectId !== project.projectId) {
    return fail(
      buildDeliveryFlowError('foreign_reference', 'Artifact belongs to another project', [
        { path: 'projectId', code: 'foreign_project', message: 'projectId does not match the path project' },
      ]),
    )
  }
  const contentHash = hashStageArtifactContent(artifact)
  const duplicate = findDuplicateStageArtifact(existing, artifact.stageId, contentHash)
  if (duplicate) {
    const current = currentArtifactOf(existing, artifact.stageId)
    return {
      ok: true,
      duplicate: true,
      existing: { artifactId: duplicate.id, version: duplicate.version, contentHash: duplicate.contentHash },
      isCurrent: current?.id === duplicate.id,
      downstreamNowStale: [],
    }
  }
  const shape = checkDependencyShape(artifact)
  if (!shape.ok) return shape
  const references = checkDependencyReferences(artifact, existing)
  if (!references.ok) return references

  const states = computeStageCurrency(template, existing, input.decisions)
  const upstream = requiredUpstreamStages(template, artifact)
  const approvalDetails = upstream
    .filter((stageId) => states[stageId].currency !== 'approved')
    .map((stageId) => ({
      path: `dependsOn.${stageId}`,
      code: states[stageId].currency === 'stale' ? 'stage_dependency_stale' : 'stage_not_approved',
      message: `Upstream stage ${stageId} is ${states[stageId].currency}`,
    }))
  if (approvalDetails.length > 0) {
    const code = approvalDetails.some((detail) => detail.code === 'stage_not_approved') ? 'stage_not_approved' : 'stage_dependency_stale'
    return fail(buildDeliveryFlowError(code, 'Upstream stages are not approved and current', approvalDetails))
  }

  const staleDetails: DeliveryErrorDetail[] = []
  for (const stageId of upstream) {
    const bound = artifact.dependsOn.find((dependency) => dependency.stageId === stageId)
    const current = states[stageId].currentArtifact
    if (!bound) {
      staleDetails.push({ path: 'dependsOn', code: 'dependency_missing', message: `The artifact must bind the current ${stageId} artifact` })
    } else if (!current || current.artifactId !== bound.artifactId) {
      staleDetails.push({ path: `dependsOn.${stageId}`, code: 'stage_artifact_stale', message: `${bound.artifactId} is not the current ${stageId} artifact` })
    }
  }
  if (staleDetails.length > 0) return fail(buildDeliveryFlowError('stage_artifact_stale', 'Upstream binding is not current', staleDetails))

  let knownAcIds = input.resolvedScopeAcIds ?? null
  if (artifact.stageId === 'scope') {
    const frozen = checkPlatformChoiceFrozen(project, artifact.content.platform)
    if (!frozen.ok) {
      return fail({ status: frozen.status, body: { ...frozen.body, details: frozen.body.details.map((detail) => ({ ...detail, path: 'content.platform' })) } })
    }
    knownAcIds = new Set(artifact.content.acceptanceCriteria.map((criterion) => criterion.id))
  }
  const acCheck = checkAcReferences(knownAcIds, input.acReferences ?? [])
  if (!acCheck.ok) return acCheck

  return {
    ok: true,
    duplicate: false,
    version: nextStageArtifactVersion(existing, artifact.stageId),
    contentHash,
    downstreamNowStale: downstreamStagesWithArtifacts(template, existing, artifact.stageId),
  }
}
