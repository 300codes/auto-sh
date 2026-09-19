import { sourceRevisionSchema, uuidSchema, type DeliveryReportV1, type ReportDecision, type SourceRevision } from '../../lib/contracts'

export type ReportSelection =
  | { kind: 'current' }
  | { kind: 'history'; baselineId: string; revision: SourceRevision }
  | { kind: 'invalid' }

export function formatRevisionRef(revision: SourceRevision): string {
  return revision.kind === 'git' ? `git:${revision.commitSha}` : `snapshot:${revision.contentHash}:${revision.externalWorkspaceId}`
}

export function readReportSelection(query: string): ReportSelection {
  const params = new URLSearchParams(query)
  if (!params.has('baselineId') && !params.has('revision')) return { kind: 'current' }
  if (params.getAll('baselineId').length !== 1 || params.getAll('revision').length !== 1) return { kind: 'invalid' }
  const baseline = uuidSchema.safeParse(params.get('baselineId'))
  const raw = params.get('revision') ?? ''
  const [kind, hash, ...workspace] = raw.split(':')
  const revision = sourceRevisionSchema.safeParse(kind === 'git'
    ? { kind, commitSha: raw.slice(4) }
    : { kind, contentHash: hash, externalWorkspaceId: workspace.join(':') })
  return baseline.success && revision.success
    ? { kind: 'history', baselineId: baseline.data, revision: revision.data }
    : { kind: 'invalid' }
}

export function reportQuery(selection: ReportSelection, activeBaselineId: string): string {
  const query = new URLSearchParams({ baselineId: selection.kind === 'history' ? selection.baselineId : activeBaselineId, limit: '1000' })
  if (selection.kind === 'history') query.set('revision', formatRevisionRef(selection.revision))
  return query.toString()
}

export function reportHistoryHref(report: DeliveryReportV1): string | null {
  if (!report.revision) return null
  const query = new URLSearchParams({ baselineId: report.baselineId, revision: formatRevisionRef(report.revision) })
  return `/backend/delivery/projects/${encodeURIComponent(report.projectId)}/report?${query}`
}

export function currentReportDecision(report: DeliveryReportV1, kind: ReportDecision['kind']) {
  return report.decisions.filter((decision) => decision.kind === kind && decision.appliesToRevision
    && (kind === 'release'
      ? decision.subjectType === 'deployment_evidence' && decision.subjectId === report.deployment.evidenceId
      : decision.subjectType === 'baseline' && decision.subjectId === report.baselineId && decision.subjectHash === report.baselineHash))
    .sort((first, second) => Date.parse(second.decidedAt) - Date.parse(first.decidedAt) || second.id.localeCompare(first.id))[0]
}

export function shouldPollReport(report: DeliveryReportV1, historical: boolean): boolean {
  return !historical && currentReportDecision(report, 'release')?.verdict !== 'approved'
    && currentReportDecision(report, 'deploy')?.verdict === 'approved'
    && report.deployment.status !== 'verified'
}

export function reportRetryDelay(failures: number): number {
  return Math.min(10_000 * 2 ** Math.min(Math.max(failures - 1, 0), 3), 60_000)
}
