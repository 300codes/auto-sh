import { candidateConsentHash, loadReportContext } from './reportContext'
import { hashCanonical } from '../lib/hash'
import type { DeliveryReportResponse } from '../lib/reportContracts'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryDecision, DeliveryEvidence, DeliveryProject, DeliveryTask } from '../data/entities'
import {
  buildDeliveryError,
  sourceRevisionSchema,
  type SourceRevision,
} from '../lib/contracts'
import { buildDeliveryReport } from '../lib/deliveryReport'
import { getTargetProfile } from '../lib/targetProfiles'
import { MAX_TRACEABILITY_ROWS } from '../lib/traceability'
import { requireVerifiedBaselineContent } from './evidence'
import { deliveryHttpError, type DeliveryScope } from './shared'
import { findProjectBaseline } from './tasks'

export type ReportOptions = {
  baselineId?: string | null
  revision?: string | SourceRevision | null
  limit?: number
}

export type DeliveryOsReportQueries = {
  buildReport(scope: DeliveryScope, projectId: string, options?: ReportOptions): Promise<DeliveryReportResponse>
}

function assertQueryScope(scope: DeliveryScope | null | undefined): DeliveryScope {
  if (scope && typeof scope.tenantId === 'string' && scope.tenantId && typeof scope.organizationId === 'string' && scope.organizationId) {
    return { tenantId: scope.tenantId, organizationId: scope.organizationId }
  }
  throw new Error('[internal] deliveryOsReportQueries requires tenantId and organizationId')
}

function notFound(path: string, code: string) {
  return deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path, code }]))
}

function invalidRevision(code: string, message: string) {
  return deliveryHttpError(buildDeliveryError('invalid_revision', message, [{ path: 'revision', code }]))
}

export function parseRevisionRef(ref: string): SourceRevision | null {
  const first = ref.indexOf(':')
  if (first < 0) return null
  const kind = ref.slice(0, first)
  const rest = ref.slice(first + 1)
  let candidate: unknown = null
  if (kind === 'git') {
    candidate = { kind, commitSha: rest }
  } else if (kind === 'snapshot') {
    const second = rest.indexOf(':')
    if (second < 0) return null
    candidate = { kind, contentHash: rest.slice(0, second), externalWorkspaceId: rest.slice(second + 1) }
  }
  const parsed = sourceRevisionSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export function formatRevisionRef(revision: SourceRevision): string {
  return revision.kind === 'git' ? `git:${revision.commitSha}` : `snapshot:${revision.contentHash}:${revision.externalWorkspaceId}`
}

function resolveRevision(raw: ReportOptions['revision']): SourceRevision | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') {
    const parsed = sourceRevisionSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    throw invalidRevision('revision_unparsable', 'Revision is not a valid source revision')
  }
  const parsed = parseRevisionRef(raw)
  if (parsed) return parsed
  throw invalidRevision('revision_unparsable', 'Revision must be git:<commitSha> or snapshot:<sha256>:<externalWorkspaceId>')
}

export function createDeliveryOsReportQueries(rootEm: EntityManager, useTransaction = false): DeliveryOsReportQueries {
  return {
    async buildReport(rawScope, projectId, options = {}) {
      const scope = assertQueryScope(rawScope)
      const em = useTransaction ? rootEm : rootEm.fork()
      const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId }
      const project = await findOneWithDecryption(em, DeliveryProject, { id: projectId, ...scoped }, undefined, scope)
      if (!project) throw notFound('projectId', 'not_found')
      const context = await loadReportContext(em, scope, project)
      const selectedBaselineId = options.baselineId ?? project.activeBaselineId ?? null
      const revision = resolveRevision(options.revision) ?? (selectedBaselineId === context.currentCandidate?.baselineId ? context.currentCandidate.sourceRevision : null)

      const profile = getTargetProfile(project.targetProfileId, project.targetProfileVersion)
      if (!profile) {
        throw deliveryHttpError(
          buildDeliveryError('unknown_target_profile', 'Unknown target profile', [
            { path: 'targetProfileId', code: 'unknown_target_profile' },
          ]),
        )
      }
      const baselineId = options.baselineId ?? project.activeBaselineId ?? null
      if (!baselineId) throw notFound('baselineId', 'no_active_baseline')
      const baseline = await findProjectBaseline(em, baselineId, project.id, scope)
      if (!baseline) throw notFound('baselineId', 'not_found')
      if (revision && revision.kind !== profile.revisionKind) {
        throw invalidRevision('revision_kind_mismatch', `Profile ${profile.id}@${profile.version} requires a ${profile.revisionKind} revision`)
      }
      const content = requireVerifiedBaselineContent(baseline)

      const where = { projectId: project.id, ...scoped }
      const tasks = await findWithDecryption(em, DeliveryTask, where, { orderBy: { createdAt: 'asc', id: 'asc' } }, scope)
      const evidence = await findWithDecryption(
        em,
        DeliveryEvidence,
        { ...where, baselineId: baseline.id },
        { orderBy: { createdAt: 'asc', id: 'asc' } },
        scope,
      )
      const decisions = await findWithDecryption(em, DeliveryDecision, where, { orderBy: { decidedAt: 'asc', id: 'asc' } }, scope)

      const report = buildDeliveryReport({
        projectId: project.id,
        baseline: { id: baseline.id, projectId: baseline.projectId, contentHash: baseline.contentHash, content },
        tasks: tasks.map((task) => ({
          id: task.id,
          projectId: task.projectId,
          baselineId: task.baselineId,
          title: task.title,
          status: task.status,
          acIds: Array.isArray(task.acIds) ? task.acIds : [],
        })),
        evidence: evidence.map((row) => ({
          id: row.id,
          projectId: row.projectId,
          baselineId: row.baselineId,
          taskId: row.taskId ?? null,
          kind: row.kind,
          sourceRevision: row.sourceRevision ?? null,
          payload: row.payload,
          rawReportHash: row.rawReportHash ?? null,
          createdAt: row.createdAt,
        })),
        decisions: decisions.map((decision) => ({
          id: decision.id,
          projectId: decision.projectId,
          kind: decision.kind,
          subjectType: decision.subjectType,
          subjectId: decision.subjectId,
          subjectHash: decision.subjectHash,
          sourceRevision: decision.sourceRevision ?? null,
          verdict: decision.verdict,
          reason: decision.reason ?? null,
          decidedAt: decision.decidedAt,
        })),
        profile,
        revision,
        limit: options.limit ?? MAX_TRACEABILITY_ROWS,
      })
      return {
        ...report,
        ...context,
        candidateDecisions: {
          deployDecisionId: decisions.filter((decision) => decision.kind === 'deploy' && decision.releaseCandidateId === context.currentCandidate?.id && decision.releaseCandidateVersion === context.currentCandidate?.version && decision.candidateContextHash === candidateConsentHash({ ...context, baselineHash: baseline.contentHash })).at(-1)?.id ?? null,
          releaseDecisionId: decisions.filter((decision) => decision.kind === 'release' && decision.releaseCandidateId === context.currentCandidate?.id && decision.releaseCandidateVersion === context.currentCandidate?.version && decision.candidateContextHash === candidateConsentHash({ ...context, baselineHash: baseline.contentHash })).at(-1)?.id ?? null,
        },
        projectUpdatedAt: project.updatedAt.toISOString(),
        decisionContextHash: hashCanonical({ projectUpdatedAt: project.updatedAt, baselineHash: baseline.contentHash, revision: report.revision, context, evidence: evidence.map((row) => ({ id: row.id, payloadHash: row.payloadHash, rawReportHash: row.rawReportHash ?? null, revision: row.sourceRevision ?? null })), decisions: decisions.map((row) => ({ id: row.id, verdict: row.verdict, decidedAt: row.decidedAt })), tasks: tasks.map((row) => ({ id: row.id, updatedAt: row.updatedAt, status: row.status })) }),
      }
    },
  }
}
