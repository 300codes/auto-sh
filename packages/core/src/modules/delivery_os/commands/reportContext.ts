import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryFlowStageArtifact, DeliveryFlowStageDecision, DeliveryReleaseCandidate, type DeliveryProject, type DeliveryDecision } from '../data/entities'
import { isSameRevision, type SourceRevision } from '../lib/contracts'
import { buildDeliveryReportFlowSection } from '../lib/flowStatus'
import { hashCanonical } from '../lib/hash'
import { releaseCandidateSchema, type DeliveryReportResponse } from '../lib/reportContracts'
import type { DeliveryScope } from './shared'

export function reportContextError(code: string, status = 409): never {
  throw new CrudHttpError(status, { error: code, code, details: [{ path: 'report', code }] })
}

export async function loadReportContext(em: EntityManager, scope: DeliveryScope, project: DeliveryProject) {
  const where = { ...scope, projectId: project.id }
  const candidates = await findWithDecryption(em, DeliveryReleaseCandidate, where, { orderBy: { version: 'desc' }, limit: 1 }, scope)
  const row = candidates[0]
  const currentCandidate = row ? releaseCandidateSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }) : null
  if (!project.flowTemplateId && !project.flowTemplateHash && !project.flowTemplateSnapshot && !project.flowTemplateVersion && !project.flowPinnedAt) return { mode: 'legacy' as const, flow: null, currentCandidate }
  if (!project.flowTemplateId || !project.flowTemplateSnapshot || !project.flowTemplateHash || !project.flowTemplateVersion || hashCanonical(project.flowTemplateSnapshot) !== project.flowTemplateHash) reportContextError('flow_template_hash_mismatch', 422)
  const artifacts = await findWithDecryption(em, DeliveryFlowStageArtifact, where, { orderBy: { version: 'asc', id: 'asc' } }, scope)
  const decisions = await findWithDecryption(em, DeliveryFlowStageDecision, where, { orderBy: { decidedAt: 'asc', id: 'asc' } }, scope)
  const flow = buildDeliveryReportFlowSection({
    project: { projectId: project.id, template: project.flowTemplateSnapshot, templateRef: { templateId: project.flowTemplateId, version: project.flowTemplateVersion, hash: project.flowTemplateHash }, workflowInstanceId: project.flowWorkflowInstanceId ?? null, updatedAt: project.updatedAt.toISOString() },
    artifacts: artifacts.filter((artifact) => artifact.templateHash === project.flowTemplateHash).map((artifact) => ({ id: artifact.id, stageId: artifact.stageId, version: artifact.version, contentHash: artifact.contentHash, dependsOn: artifact.dependsOn })),
    decisions: decisions.filter((decision) => decision.templateHash === project.flowTemplateHash).map((decision) => ({ id: decision.id, stageId: decision.stageId, artifactId: decision.artifactId, subjectHash: decision.subjectHash, verdict: decision.verdict, decidedAt: decision.decidedAt.toISOString(), clientApproved: decision.verdict === 'approved' && !!decision.clientApproverName && !!decision.clientApprovalEvidence })),
  })
  return { mode: 'flow' as const, flow, currentCandidate }
}

export function assertReportDecisionContext(report: DeliveryReportResponse, input: { candidateId?: string; candidateVersion?: number; decisionContextHash?: string }, revision: SourceRevision, approved: boolean): void {
  if (input.decisionContextHash && input.decisionContextHash !== report.decisionContextHash) reportContextError('decision_context_stale')
  const candidate = report.currentCandidate
  if (candidate) {
    if (candidate.baselineId !== report.baselineId || !isSameRevision(candidate.sourceRevision, revision)) reportContextError('candidate_stale')
    if ((input.candidateId !== undefined && input.candidateId !== candidate.id) || (input.candidateVersion !== undefined && input.candidateVersion !== candidate.version)) reportContextError('candidate_stale')
  } else if (input.candidateId !== undefined || input.candidateVersion !== undefined) reportContextError('candidate_stale')
  if (approved && report.mode === 'flow') {
    if (!candidate) reportContextError('release_candidate_required', 422)
    if (!report.flow?.gate.ok) throw new CrudHttpError(422, { error: 'flow_not_publishable', code: 'flow_not_publishable', details: (report.flow?.gate.blocking ?? []).map((blocker) => ({ path: blocker.stageId ?? 'flow', code: blocker.kind, message: blocker.ref ?? blocker.kind })) })
  }
}

export function candidateConsentHash(report: Pick<DeliveryReportResponse, 'currentCandidate' | 'flow' | 'baselineHash'>): string {
  return hashCanonical({ candidate: report.currentCandidate, flow: report.flow, baselineHash: report.baselineHash })
}

export function assertCurrentCandidateDeployConsent(report: DeliveryReportResponse, decisions: readonly DeliveryDecision[]): void {
  if (!report.currentCandidate) return
  const current = report.currentCandidate
  const latest = decisions.filter((decision) => decision.kind === 'deploy' && decision.releaseCandidateId === current.id && decision.releaseCandidateVersion === current.version && decision.candidateContextHash === candidateConsentHash(report)).sort((left, right) => right.decidedAt.getTime() - left.decidedAt.getTime() || right.id.localeCompare(left.id))[0]
  if (!latest || latest.verdict !== 'approved') reportContextError('deploy_decision_missing', 422)
}
