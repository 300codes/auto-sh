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
import { hashCanonical } from './hash'
import { assertRevisionKind, getTargetProfile } from './targetProfiles'
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

export type PendingResultCheckContext = {
  manifest: ResultManifestV1
  task: ResultAcceptanceTask
  taskPackage: TaskPackageV1
}

export type PendingResultCheck = (context: PendingResultCheckContext) => DeliveryCheckResult

export const checkChangedPathsAllowed: PendingResultCheck = () => ({ ok: true })

export const checkArtifactAttachments: PendingResultCheck = () => ({ ok: true })

export const checkResultSizeLimits: PendingResultCheck = () => ({ ok: true })

export const RESULT_ACCEPTANCE_PENDING_CHECKS: readonly PendingResultCheck[] = [
  checkChangedPathsAllowed,
  checkArtifactAttachments,
  checkResultSizeLimits,
]

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

  for (const pendingCheck of RESULT_ACCEPTANCE_PENDING_CHECKS) {
    const checked = pendingCheck({ manifest, task: input.task, taskPackage })
    if (!checked.ok) return checked
  }
  return { ok: true, outcome: 'accept', manifest, manifestHash }
}
