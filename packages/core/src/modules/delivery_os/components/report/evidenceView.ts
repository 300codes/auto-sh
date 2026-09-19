import type { DeliveryReportRow, DeliveryReportV1, SourceRevision } from '../../lib/contracts'

export function evidenceRevisionLabel(revision: SourceRevision | null): string | null {
  if (!revision) return null
  return revision.kind === 'git' ? `git:${revision.commitSha}` : `snapshot:${revision.contentHash}:${revision.externalWorkspaceId}`
}

export function evidenceRowKey(report: DeliveryReportV1, row: DeliveryReportRow): string {
  return JSON.stringify([
    report.projectId, report.baselineId, evidenceRevisionLabel(report.revision),
    row.requirementId, row.acId, row.taskId, row.testId, row.manualCheckId,
    row.evidenceId, row.rawReportHash, row.deploymentEvidenceId,
  ])
}

export function evidenceStatusVariant(status: string | null): 'success' | 'error' | 'warning' | 'neutral' {
  if (status === 'passed' || status === 'verified' || status === 'approved') return 'success'
  if (status === 'failed' || status === 'rejected' || status === 'changes_requested') return 'error'
  if (status === 'missing' || status === 'not_run' || status === 'manual_pending' || status === 'unverified') return 'warning'
  return 'neutral'
}

export function evidenceTableRows(report: DeliveryReportV1) {
  return report.rows.map((row) => ({ ...row, id: evidenceRowKey(report, row) }))
}
