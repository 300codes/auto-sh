import { isSameRevision } from '../../lib/contracts'
import type { ReportSnapshot } from './useDeliveryReport'

export type ReleaseDecisionKind = 'deploy' | 'release'
export type ReleaseVerdict = 'approved' | 'rejected'

export function decisionFingerprint(snapshot: ReportSnapshot): string {
  const { project, report } = snapshot
  return JSON.stringify([project.id, project.status, project.activeBaselineId, project.updatedAt,
    report.projectUpdatedAt, report.baselineId, report.baselineHash, report.revision,
    report.mode, report.flow, report.currentCandidate, report.decisionContextHash,
    report.gates, report.deployment, report.rows, report.scans, report.decisions])
}

export function decisionBlocker(snapshot: ReportSnapshot, kind: ReleaseDecisionKind, verdict: ReleaseVerdict): string | null {
  const { project, report } = snapshot
  if (project.status === 'archived' || project.activeBaselineId !== report.baselineId) return 'readonly'
  if (!report.projectUpdatedAt || !report.decisionContextHash) return 'refreshRequired'
  const candidate = report.currentCandidate
  if (!candidate || candidate.baselineId !== report.baselineId || candidate.baselineHash !== report.baselineHash
    || !report.revision || !isSameRevision(candidate.sourceRevision, report.revision)) return 'candidateRequired'
  if (kind === 'release' && !report.deployment.evidenceId) return 'deploymentRequired'
  if (verdict === 'rejected') return null
  if (report.mode === 'flow' && (!report.flow || !report.flow.gate.ok)) return 'flowBlocked'
  if (!report.gates[kind === 'deploy' ? 'publishable' : 'releasable'].ok) return 'gateBlocked'
  if (kind === 'release' && report.deployment.status !== 'verified') return 'deploymentRequired'
  if (kind === 'release' && (!report.candidateDecisions?.deployDecisionId || !report.decisions.some((decision) => decision.id === report.candidateDecisions.deployDecisionId && decision.verdict === 'approved'))) return 'gateBlocked'
  return null
}

export function decisionPayload(snapshot: ReportSnapshot, kind: ReleaseDecisionKind, verdict: ReleaseVerdict, reason: string) {
  const report = snapshot.report
  return {
    ...(kind === 'deploy' ? { baselineId: report.baselineId, sourceRevision: report.revision }
      : { deploymentEvidenceId: report.deployment.evidenceId }),
    verdict,
    ...(reason.trim() ? { reason: reason.trim() } : {}),
    candidateId: report.currentCandidate?.id,
    candidateVersion: report.currentCandidate?.version,
    decisionContextHash: report.decisionContextHash,
  }
}
