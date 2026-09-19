import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { DeliveryDecision, DeliveryEvidence, DeliveryPublication, type DeliveryProject } from '../data/entities'
import { parseRecordEvidenceBody, recordPublicationCommandInputSchema, type RecordPublicationCommandInput } from '../data/validators'
import {
  buildDeliveryError,
  buildDeliveryFlowError,
  FLOW_APPROVAL_STAGE_ORDER,
  publicationRecordResponseSchema,
  type PublicationResultV1,
} from '../lib/contracts'
import { checkFlowGate } from '../lib/flowRules'
import { buildDeploymentEvidencePayload, checkPublicationDeployConsent, hashPublicationPayload } from '../lib/publicationRules'
import { emitDeliveryOsEvent } from '../events'
import { checkDeployConsent } from './decisions'
import { evidenceCrudIndexer, recordEvidenceWithinTransaction } from './evidence'
import { loadFlowGateStates, unreadableSnapshotDetails } from './flowGate'
import {
  assertDeliveryCheck,
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryFlowHttpError,
  deliveryHttpError,
  lockScopedProject,
  parseDeliveryInput,
  requireActorUserId,
  requireLockHeader,
  requireScopedProject,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'
import { findProjectBaseline, foreignBaselineError } from './tasks'

export const DELIVERY_PUBLICATION_RESOURCE_KIND = 'delivery_os.publication'

export const PUBLICATION_RECORD_FEATURE = 'delivery_os.results.import'

export type PublicationRecordCommandResult = {
  publicationId: string
  deploymentEvidenceId: string
  duplicate: boolean
}

type FeatureGrantReader = {
  getGrantedFeatures(userId: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<string[]>
}

type PublicationOutcome = {
  project: DeliveryProject
  publicationId: string
  deploymentEvidenceId: string
  evidence: DeliveryEvidence | null
  duplicate: boolean
}

const logger = createLogger('delivery_os')

/** The caller's grant list (wildcards intact) must cover `delivery_os.results.import`; a failing lookup grants nothing (403). */
async function assertPublicationFeature(ctx: CommandRuntimeContext, scope: DeliveryScope, userId: string): Promise<void> {
  let granted: string[] = []
  try {
    const rbac = ctx.container.resolve('rbacService') as FeatureGrantReader
    const features = await rbac.getGrantedFeatures(userId, scope)
    granted = Array.isArray(features) ? features.filter((feature): feature is string => typeof feature === 'string') : []
  } catch (error) {
    logger.warn('publication feature lookup failed closed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.feature_check_failed' })
  }
  if (hasAllFeatures([PUBLICATION_RECORD_FEATURE], granted)) return
  throw deliveryHttpError(
    buildDeliveryError('forbidden', 'Recording a publication requires the results import feature', [
      { path: 'actorUserId', code: 'feature_required', message: PUBLICATION_RECORD_FEATURE },
    ]),
  )
}

function findPublicationByHash(em: EntityManager, projectId: string, payloadHash: string, scope: DeliveryScope): Promise<DeliveryPublication | null> {
  return findOneWithDecryption(
    em,
    DeliveryPublication,
    { projectId, payloadHash, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

function findProjectDecision(tx: EntityManager, projectId: string, decisionId: string, scope: DeliveryScope): Promise<DeliveryDecision | null> {
  return findOneWithDecryption(
    tx,
    DeliveryDecision,
    { id: decisionId, projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

function findProjectDeployDecisions(tx: EntityManager, projectId: string, scope: DeliveryScope): Promise<DeliveryDecision[]> {
  return findWithDecryption(
    tx,
    DeliveryDecision,
    { projectId, kind: 'deploy', tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { decidedAt: 'asc', id: 'asc' } },
    scope,
  )
}

async function assertVerificationEvidence(tx: EntityManager, project: DeliveryProject, publication: PublicationResultV1, scope: DeliveryScope): Promise<void> {
  const evidenceId = publication.verification.evidenceId
  if (evidenceId === null) return
  const row = await findOneWithDecryption(
    tx,
    DeliveryEvidence,
    { id: evidenceId, projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  if (row) return
  throw deliveryHttpError(
    buildDeliveryError('foreign_reference', 'The verification evidence does not belong to this project', [
      { path: 'verification.evidenceId', code: 'foreign_evidence' },
    ]),
  )
}

/**
 * The flow gate on the F14 path: a pinned project needs all four approval stages approved and current. Unlike the v1
 * routes the refusal is the flow code `422 stage_not_approved` with the same per-stage `details[]`; an unreadable
 * snapshot fails closed; legacy (unpinned) projects issue no stage query.
 */
async function assertPublicationFlowGate(tx: EntityManager, project: DeliveryProject, scope: DeliveryScope): Promise<void> {
  const loaded = await loadFlowGateStates(tx, project, scope)
  if (loaded === null) return
  if (loaded === 'unreadable') {
    logger.warn('pinned flow template snapshot is unreadable; publication gate fails closed', { projectId: project.id, templateId: project.flowTemplateId })
    throw deliveryFlowHttpError(buildDeliveryFlowError('stage_not_approved', 'Flow stages are not approved', unreadableSnapshotDetails()))
  }
  const result = checkFlowGate(loaded.states, FLOW_APPROVAL_STAGE_ORDER, { v1Compatible: false })
  if (!result.ok) throw deliveryFlowHttpError(result)
}

function toDeploymentEvidenceInput(publication: PublicationResultV1) {
  const parsed = parseRecordEvidenceBody({
    kind: 'deployment',
    baselineId: publication.baselineId,
    sourceRevision: publication.sourceRevision,
    attachmentIds: publication.snapshotRef ? [publication.snapshotRef.attachmentId] : [],
    payload: buildDeploymentEvidencePayload(publication),
  })
  if (!parsed.ok) throw deliveryHttpError(parsed)
  return parsed.data
}

async function recordPublicationInTransaction(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  parsed: RecordPublicationCommandInput,
  payloadHash: string,
  actor: string,
  scope: DeliveryScope,
): Promise<PublicationOutcome> {
  const { publication } = parsed
  const project = await lockScopedProject(tx, parsed.projectId, scope)
  const replay = await findPublicationByHash(tx, project.id, payloadHash, scope)
  if (replay) return { project, publicationId: replay.id, deploymentEvidenceId: replay.deploymentEvidenceId, evidence: null, duplicate: true }
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
    resourceId: project.id,
    current: project.updatedAt,
    request: ctx.request ?? null,
  })

  const baseline = await findProjectBaseline(tx, publication.baselineId, project.id, scope)
  if (!baseline) throw deliveryHttpError(foreignBaselineError())
  const named = await findProjectDecision(tx, project.id, publication.deployDecisionId, scope)
  assertDeliveryCheck(
    checkPublicationDeployConsent({
      decision: named
        ? { id: named.id, projectId: named.projectId, kind: named.kind, subjectId: named.subjectId, subjectHash: named.subjectHash, sourceRevision: named.sourceRevision, verdict: named.verdict }
        : null,
      projectId: project.id,
      baselineId: baseline.id,
      baselineContentHash: baseline.contentHash,
      sourceRevision: publication.sourceRevision,
    }),
  )
  assertDeliveryCheck(checkDeployConsent(await findProjectDeployDecisions(tx, project.id, scope), baseline.contentHash, publication.sourceRevision))
  await assertVerificationEvidence(tx, project, publication, scope)
  await assertPublicationFlowGate(tx, project, scope)

  const recorded = await recordEvidenceWithinTransaction(tx, ctx, project, toDeploymentEvidenceInput(publication), scope)
  const now = new Date()
  const row = tx.create(DeliveryPublication, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    baselineId: baseline.id,
    sourceRevision: publication.sourceRevision,
    snapshotRef: publication.snapshotRef,
    target: publication.target,
    url: publication.url,
    deployDecisionId: publication.deployDecisionId,
    deploymentEvidenceId: recorded.evidenceId,
    verification: publication.verification,
    publishedAt: new Date(publication.publishedAt),
    publishedBy: publication.publishedBy,
    payloadHash,
    recordedBy: actor,
    createdAt: now,
  })
  tx.persist(row)
  project.updatedAt = now
  return { project, publicationId: row.id, deploymentEvidenceId: recorded.evidenceId, evidence: recorded.evidence, duplicate: false }
}

async function emitPublicationSideEffects(ctx: CommandRuntimeContext, scope: DeliveryScope, outcome: PublicationOutcome): Promise<void> {
  if (!outcome.evidence) return
  await emitDeliveryOsEvent(
    'delivery_os.evidence.recorded',
    {
      projectId: outcome.project.id,
      taskId: null,
      attemptId: null,
      evidenceId: outcome.deploymentEvidenceId,
      kind: 'deployment',
      duplicate: false,
      completionDelivery: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'created',
    entity: outcome.evidence,
    identifiers: { id: outcome.deploymentEvidenceId, organizationId: scope.organizationId, tenantId: scope.tenantId },
    indexer: evidenceCrudIndexer,
  })
}

function toResult(outcome: PublicationOutcome): PublicationRecordCommandResult {
  return publicationRecordResponseSchema.parse({
    publicationId: outcome.publicationId,
    deploymentEvidenceId: outcome.deploymentEvidenceId,
    duplicate: outcome.duplicate,
  })
}

const recordPublicationCommand: CommandHandler<RecordPublicationCommandInput, PublicationRecordCommandResult> = {
  id: 'delivery_os.publications.record',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(recordPublicationCommandInputSchema, rawInput)
    const payloadHash = hashPublicationPayload(parsed.publication)
    const actor = requireActorUserId(ctx)
    await assertPublicationFeature(ctx, scope, actor)

    const probeEm = resolveDeliveryEm(ctx)
    const probeProject = await requireScopedProject(probeEm, parsed.projectId, scope)
    const replay = await findPublicationByHash(probeEm, probeProject.id, payloadHash, scope)
    if (replay) {
      return toResult({ project: probeProject, publicationId: replay.id, deploymentEvidenceId: replay.deploymentEvidenceId, evidence: null, duplicate: true })
    }
    if (ctx.request) requireLockHeader(ctx)

    const em = resolveDeliveryEm(ctx)
    let outcome: PublicationOutcome
    try {
      outcome = await em.transactional((tx) => recordPublicationInTransaction(tx, ctx, parsed, payloadHash, actor, scope))
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const recoveryEm = resolveDeliveryEm(ctx)
      const winner = await findPublicationByHash(recoveryEm, parsed.projectId, payloadHash, scope)
      if (!winner) throw error
      const project = await requireScopedProject(recoveryEm, parsed.projectId, scope)
      outcome = { project, publicationId: winner.id, deploymentEvidenceId: winner.deploymentEvidenceId, evidence: null, duplicate: true }
    }

    await emitPublicationSideEffects(ctx, scope, outcome)
    return toResult(outcome)
  },
  buildLog: async ({ input, result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const parsed = recordPublicationCommandInputSchema.safeParse(input)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.publications.record', 'Record delivery publication'),
      resourceKind: DELIVERY_PUBLICATION_RESOURCE_KIND,
      resourceId: result.publicationId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: parsed.success ? parsed.data.projectId : null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: parsed.success
        ? {
            ...result,
            baselineId: parsed.data.publication.baselineId,
            deployDecisionId: parsed.data.publication.deployDecisionId,
            target: parsed.data.publication.target,
            url: parsed.data.publication.url,
            verificationStatus: parsed.data.publication.verification.status,
          }
        : { ...result },
    }
  },
}

registerCommand(recordPublicationCommand)
