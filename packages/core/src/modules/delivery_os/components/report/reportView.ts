import type { DeliveryReportResponse } from '../../lib/reportContracts'
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

export function currentReportDecision(report: DeliveryReportV1 & Partial<Pick<DeliveryReportResponse, 'currentCandidate' | 'candidateDecisions'>>, kind: ReportDecision['kind']) {
  return report.decisions.filter((decision) => decision.kind === kind && decision.appliesToRevision
    && (!report.currentCandidate || (kind !== 'deploy' && kind !== 'release') || report.candidateDecisions?.[kind === 'deploy' ? 'deployDecisionId' : 'releaseDecisionId'] === decision.id)
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

export type DecisionBlockerLink = { labelKey: string; reference: string | null; href: string | null }

export function decisionBlockerLinks(details: unknown, report: DeliveryReportResponse): DecisionBlockerLink[] {
  if (!Array.isArray(details)) return []
  const projectHref = `/backend/delivery/projects/${encodeURIComponent(report.projectId)}`
  return details.slice(0, 200).map((detail: unknown) => {
    const unknown: DecisionBlockerLink = { labelKey: 'delivery_os.report.blocker.unknown', reference: null, href: null }
    if (!detail || typeof detail !== 'object') return unknown
    const { path, code } = detail as Record<string, unknown>
    if (typeof path !== 'string' || typeof code !== 'string') return unknown
    const [kind, ...parts] = path.split(':')
    const id = parts.join(':')
    if (kind === 'ac' && ['failed', 'missing', 'not_run', 'manual_pending'].includes(code) && report.acceptanceCriteria.some((criterion) => criterion.acId === id)) {
      return { labelKey: 'delivery_os.report.blocker.ac', reference: id, href: `#${encodeURIComponent(`report-ac-${id}`)}` }
    }
    if (kind === 'scan' && ['failed', 'missing'].includes(code) && report.scans.some((scan) => scan.checkId === id)) {
      return { labelKey: 'delivery_os.report.blocker.scan', reference: id, href: `#${encodeURIComponent(`report-scan-${id}`)}` }
    }
    if ((kind === 'deployment' || path === 'deploymentEvidenceId') && ['missing', 'unverified', 'deployment_unverified', 'deployment_revision_missing', 'not_deployment_evidence'].includes(code)) {
      return { labelKey: 'delivery_os.report.blocker.deployment', reference: null, href: '#report-deployment' }
    }
    if (kind === 'revision' && code === 'missing') return { labelKey: 'delivery_os.report.blocker.revision', reference: null, href: '#report-summary' }
    if (path.startsWith('stages.') && ['stage_not_approved', 'stage_dependency_stale', 'stage_artifact_stale', 'client_approval_required', 'blocking_comments_open'].includes(code)) {
      const stageId = path.slice('stages.'.length)
      if (report.flow?.stages.some((stage) => stage.stageId === stageId)) {
        return { labelKey: `delivery_os.flow.stage.${stageId}`, reference: null, href: `${projectHref}?stage=${encodeURIComponent(stageId)}#delivery-stage-${encodeURIComponent(stageId)}` }
      }
    }
    return unknown
  })
}
