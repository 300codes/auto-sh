import {
  buildDeliveryError,
  isSameRevision,
  type DeliveryCheckResult,
  type DeliveryErrorCode,
  type DeliveryErrorDetail,
  type ResultManifestV1,
  type TaskPackageV1,
} from './contracts'

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
