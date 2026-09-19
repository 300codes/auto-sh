import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryDecision, type DeliveryProject } from '../data/entities'
import type { SourceRevision } from '../lib/contracts'
import { assertCurrentCandidateDeployConsent, assertReportDecisionContext, loadReportContext, reportContextError } from './reportContext'
import { createDeliveryOsReportQueries } from './reportQueries'
import { lockScopedProjectTasks, type DeliveryScope } from './shared'

export async function assertPublicationGate(tx: EntityManager, scope: DeliveryScope, project: DeliveryProject, baselineId: string, revision: SourceRevision): Promise<void> {
  const context = await loadReportContext(tx, scope, project)
  if (context.mode === 'legacy' && !context.currentCandidate) return
  await lockScopedProjectTasks(tx, project.id, scope)
  if (project.activeBaselineId !== baselineId) reportContextError('baseline_not_active', 422)
  const report = await createDeliveryOsReportQueries(tx, true).buildReport(scope, project.id, { baselineId, revision })
  assertReportDecisionContext(report, {}, revision, true)
  if (!report.gates.publishable.ok) reportContextError('report_not_green', 422)
  const decisions = await findWithDecryption(tx, DeliveryDecision, { ...scope, projectId: project.id, kind: 'deploy' }, { orderBy: { decidedAt: 'asc', id: 'asc' } }, scope)
  assertCurrentCandidateDeployConsent(report, decisions)
}
