import { isPathAllowed } from './allowedPaths'
import { checkAttemptAcceptsResult } from './attempts'
import {
  DELIVERY_SCHEMA_VERSIONS,
  buildDeliveryError,
  isSameRevision,
  parseVersioned,
  resultManifestV1Schema,
  type DeliveryCheckResult,
  type DeliveryErrorCode,
  type DeliveryErrorDetail,
  type DeliveryErrorResult,
  type ExecutionAttempt,
  type ResultManifestV1,
  type TaskPackageV1,
} from './contracts'
import type { AttachmentReference } from './designReview'
import { hashCanonical } from './hash'
import { checkReportedChecks } from './resultChecks'
import { assertRevisionKind, getTargetProfile, type TargetProfile } from './targetProfiles'
import type { TaskPackageResult } from './taskPackage'

type CorrelatedField = 'projectId' | 'taskId' | 'attemptId' | 'baselineId' | 'baselineHash' | 'targetProfileVersion' | 'baseRevision'

type CorrelationPackage = Pick<TaskPackageV1, CorrelatedField> & { baseCommit?: string | null }

type CorrelationManifest = Pick<ResultManifestV1, CorrelatedField> & { baseCommit?: string | null }

const correlatedFields: ReadonlyArray<{ field: keyof CorrelationManifest; code: DeliveryErrorCode }> = [
  { field: 'projectId', code: 'correlation_mismatch' },
  { field: 'taskId', code: 'correlation_mismatch' },
  { field: 'attemptId', code: 'correlation_mismatch' },
  { field: 'targetProfileVersion', code: 'correlation_mismatch' },
  { field: 'baselineId', code: 'baseline_mismatch' },
  { field: 'baselineHash', code: 'baseline_mismatch' },
  { field: 'baseCommit', code: 'base_revision_mismatch' },
]

export function checkResultCorrelation(taskPackage: CorrelationPackage, manifest: CorrelationManifest): DeliveryCheckResult {
  const mismatches: Array<{ code: DeliveryErrorCode; detail: DeliveryErrorDetail }> = []
  for (const { field, code } of correlatedFields) {
    if ((taskPackage[field] ?? undefined) !== (manifest[field] ?? undefined)) {
      mismatches.push({ code, detail: { path: field, code, message: `${field} does not match the reserved attempt` } })
    }
  }
  if (!isSameRevision(taskPackage.baseRevision, manifest.baseRevision)) {
    const code: DeliveryErrorCode = 'base_revision_mismatch'
    mismatches.push({ code, detail: { path: 'baseRevision', code, message: 'baseRevision does not match the reserved attempt' } })
  }
  const first = mismatches[0]
  if (!first) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError(first.code, first.detail.message ?? 'Result does not match the reserved attempt', mismatches.map((entry) => entry.detail)),
  }
}

export type ResultAcceptanceTask = { id: string; allowedPaths: readonly string[] }

export type ExistingResult = { evidenceId: string; payloadHash: string }

export type ResultAcceptanceInput = {
  manifestRaw: unknown
  task: ResultAcceptanceTask
  attempt: ExecutionAttempt | undefined
  taskPackage: TaskPackageResult
  existingResult: ExistingResult | null
}

export type ResultAcceptanceOutcome =
  | { ok: true; outcome: 'accept'; manifest: ResultManifestV1; manifestHash: string }
  | { ok: true; outcome: 'duplicate'; evidenceId: string; manifestHash: string }
  | ({ ok: false } & DeliveryErrorResult)

export type ResultAcceptanceCheckContext = {
  manifest: ResultManifestV1
  task: ResultAcceptanceTask
  taskPackage: TaskPackageV1
  profile: TargetProfile
  declaredTestIds: readonly string[]
}

export type ResultAcceptanceCheck = (context: ResultAcceptanceCheckContext) => DeliveryCheckResult

export const MAX_RESULT_CHANGED_PATHS = 500
export const MAX_RESULT_CHECKS = 500
export const MAX_RESULT_ARTIFACTS = 50
export const MAX_RESULT_ARTIFACT_BYTES = 10 * 1024 * 1024
export const MAX_RESULT_TOTAL_ARTIFACT_BYTES = 64 * 1024 * 1024

export const checkResultSizeLimits: ResultAcceptanceCheck = ({ manifest }) => {
  const details: DeliveryErrorDetail[] = []
  const countLimits = [
    { path: 'changedPaths', code: 'too_many_changed_paths', count: manifest.changedPaths.length, max: MAX_RESULT_CHANGED_PATHS },
    { path: 'checks', code: 'too_many_checks', count: manifest.checks.length, max: MAX_RESULT_CHECKS },
    { path: 'artifacts', code: 'too_many_artifacts', count: manifest.artifacts.length, max: MAX_RESULT_ARTIFACTS },
  ]
  for (const limit of countLimits) {
    if (limit.count > limit.max) {
      details.push({ path: limit.path, code: limit.code, message: `At most ${limit.max} entries are accepted, received ${limit.count}` })
    }
  }
  manifest.artifacts.forEach((artifact, index) => {
    if ((artifact.sizeBytes ?? 0) > MAX_RESULT_ARTIFACT_BYTES) {
      details.push({ path: `artifacts.${index}.sizeBytes`, code: 'artifact_too_large', message: `An artifact may have at most ${MAX_RESULT_ARTIFACT_BYTES} bytes` })
    }
  })
  const totalBytes = manifest.artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0)
  if (totalBytes > MAX_RESULT_TOTAL_ARTIFACT_BYTES) {
    details.push({ path: 'artifacts', code: 'artifacts_total_too_large', message: `All artifacts together may have at most ${MAX_RESULT_TOTAL_ARTIFACT_BYTES} bytes` })
  }
  if (details.length === 0) return { ok: true }
  return { ok: false, ...buildDeliveryError('payload_too_large', 'The result is too large', details) }
}

export const checkChangedPathsAllowed: ResultAcceptanceCheck = ({ manifest, task }) => {
  const details = manifest.changedPaths.flatMap((changedPath, index): DeliveryErrorDetail[] =>
    isPathAllowed(changedPath, task.allowedPaths)
      ? []
      : [{ path: `changedPaths.${index}`, code: 'outside_allowed_paths', message: `${changedPath} is outside the allowed paths of this task` }],
  )
  if (details.length === 0) return { ok: true }
  return { ok: false, ...buildDeliveryError('path_not_allowed', 'The result changes files outside the allowed paths of this task', details) }
}

export const checkResultChecks: ResultAcceptanceCheck = ({ manifest, taskPackage, profile, declaredTestIds }) =>
  checkReportedChecks({
    checks: manifest.checks,
    resultRevision: manifest.resultRevision,
    validationProfile: taskPackage.validationProfile,
    acceptanceCriteriaIds: taskPackage.acceptanceCriteria.map((criterion) => criterion.id),
    knownTestIds: [
      ...Object.values(taskPackage.validationProfile.requiredTests).flat(),
      ...declaredTestIds,
      ...profile.testCatalogue.map((test) => test.testId),
    ],
  })

export const RESULT_ACCEPTANCE_CHECKS: readonly ResultAcceptanceCheck[] = [
  checkResultSizeLimits,
  checkChangedPathsAllowed,
  checkResultChecks,
]

export function collectArtifactReferences(artifacts: ResultManifestV1['artifacts']): AttachmentReference[] {
  return artifacts.flatMap((artifact, index): AttachmentReference[] =>
    artifact.attachmentId
      ? [{
          path: `artifacts.${index}`,
          role: 'attachment',
          attachmentId: artifact.attachmentId,
          declared: { sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
        }]
      : [],
  )
}

const resultManifestSchemas = { [DELIVERY_SCHEMA_VERSIONS.resultManifest]: resultManifestV1Schema }

function hashManifest(manifest: ResultManifestV1): string | null {
  try {
    return hashCanonical(manifest)
  } catch {
    return null
  }
}

export function evaluateResultAcceptance(input: ResultAcceptanceInput): ResultAcceptanceOutcome {
  const parsed = parseVersioned(resultManifestSchemas, input.manifestRaw)
  if (!parsed.ok) return parsed
  const manifest = parsed.data
  const manifestHash = hashManifest(manifest)
  if (manifestHash === null) {
    return { ok: false, ...buildDeliveryError('validation_failed', 'Manifest is not canonical JSON', [{ path: 'manifest', code: 'validation_failed' }]) }
  }
  if (!input.attempt) {
    return { ok: false, ...buildDeliveryError('attempt_not_found', 'Attempt not found', [{ path: 'attemptId', code: 'attempt_not_found' }]) }
  }

  if (input.existingResult) {
    if (input.existingResult.payloadHash === manifestHash) {
      return { ok: true, outcome: 'duplicate', evidenceId: input.existingResult.evidenceId, manifestHash }
    }
    return {
      ok: false,
      ...buildDeliveryError('result_conflict', 'This attempt already has a different result', [
        { path: 'manifest', code: 'result_conflict', message: 'A result is recorded once per attempt; reserve a new attempt for new content' },
      ]),
    }
  }

  const gate = checkAttemptAcceptsResult(input.attempt)
  if (!gate.ok) return gate
  if (!input.taskPackage.ok) return input.taskPackage
  const taskPackage = input.taskPackage.taskPackage

  const profile = getTargetProfile(taskPackage.targetProfileId, taskPackage.targetProfileVersion)
  if (!profile) {
    return { ok: false, ...buildDeliveryError('unknown_target_profile', 'Unknown target profile', [{ path: 'targetProfileId', code: 'unknown_target_profile' }]) }
  }
  const revisionKind = assertRevisionKind(profile, manifest.resultRevision)
  if (!revisionKind.ok) return revisionKind
  const correlation = checkResultCorrelation(taskPackage, manifest)
  if (!correlation.ok) return correlation

  const context = { manifest, task: input.task, taskPackage, profile, declaredTestIds: input.taskPackage.declaredTestIds }
  for (const acceptanceCheck of RESULT_ACCEPTANCE_CHECKS) {
    const checked = acceptanceCheck(context)
    if (!checked.ok) return checked
  }
  return { ok: true, outcome: 'accept', manifest, manifestHash }
}
