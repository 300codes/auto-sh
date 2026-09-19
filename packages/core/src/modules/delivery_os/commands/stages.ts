import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { DeliveryFlowStageArtifact, DeliveryFlowStageDecision, type DeliveryProject } from '../data/entities'
import {
  stageArtifactCreateCommandSchema,
  stageDecisionCommandSchema,
  type StageArtifactCreateCommandInput,
  type StageDecisionCommandInput,
} from '../data/validators'
import {
  buildDeliveryError,
  buildDeliveryFlowError,
  flowStageIdSchema,
  stageArtifactCreateResponseSchema,
  stageDecisionResponseSchema,
  uuidSchema,
  type FlowStageId,
  type FlowTemplateStage,
  type FlowTemplateV1,
  type StageArtifactCreateResponse,
  type StageArtifactRef,
  type StageArtifactV1,
  type StageCurrency,
  type StageDecisionResponse,
} from '../lib/contracts'
import { collectAttachmentReferences, type AttachmentReference } from '../lib/designReview'
import { type StageDecisionRecord } from '../lib/flowRules'
import { planStageArtifact, type AcReference, type StageArtifactPlan } from '../lib/stageArtifacts'
import {
  hashStageDecisionRequest,
  planStageDecision,
  type CommentThreadRecord,
  type StageDecisionPlan,
  type StoredStageDecisionRecord,
  type ThreadDeferral,
} from '../lib/stageDecisions'
import { isIssuedTrustedExecution, readTrustedExecutionOption } from '../lib/trustedExecution'
import { emitDeliveryOsEvent } from '../events'
import { verifyAttachmentReferences } from './attachments'
import { requireIdempotencyKey } from './attempts'
import { loadStageArtifactRows, loadStageDecisionRows, toStageArtifactRecord, toStageDecisionRecord } from './flowGate'
import { checkProjectArchivable } from './projects'
import {
  assertDeliveryCheck,
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryFlowHttpError,
  deliveryHttpError,
  lockScopedProject,
  lockScopedProjectTasks,
  parseDeliveryInput,
  requireActorUserId,
  requireLockHeader,
  requireScopedProject,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'

export const DELIVERY_STAGE_ARTIFACT_RESOURCE_KIND = 'delivery_os.stage_artifact'
export const DELIVERY_STAGE_DECISION_RESOURCE_KIND = 'delivery_os.stage_decision'

export type StageArtifactCommandResult = StageArtifactCreateResponse
export type StageDecisionCommandResult = StageDecisionResponse

type PinnedSnapshot = { template: FlowTemplateV1; hash: string }

type StoredDecision = StoredStageDecisionRecord & { subjectVersion: number }

type FeatureGrantReader = {
  getGrantedFeatures(userId: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<string[]>
}

const logger = createLogger('delivery_os')

function readPinnedSnapshot(project: Pick<DeliveryProject, 'flowTemplateSnapshot' | 'flowTemplateHash'>): PinnedSnapshot {
  if (project.flowTemplateSnapshot && project.flowTemplateHash) {
    return { template: project.flowTemplateSnapshot, hash: project.flowTemplateHash }
  }
  throw deliveryFlowHttpError(
    buildDeliveryFlowError('flow_not_pinned', 'Pin a process template before recording stage artifacts or decisions', [
      { path: 'projectId', code: 'flow_not_pinned' },
    ]),
  )
}

function requireTemplateStage(template: FlowTemplateV1, stageId: FlowStageId): FlowTemplateStage {
  const templateStage = template.stages.find((stage) => stage.kind === stageId)
  if (templateStage) return templateStage
  throw deliveryFlowHttpError(
    buildDeliveryFlowError('stage_unknown', 'Stage is not part of the pinned template', [{ path: 'stageId', code: 'stage_unknown', message: stageId }]),
  )
}

/**
 * Route-level check of the path `stageId` (F7/F8/F9) with the same errors as the commands: `422 flow_not_pinned` for an
 * unpinned project, `422 stage_unknown` for a value that is not an approval stage of the pinned snapshot.
 */
export function requirePinnedTemplateStage(
  project: Pick<DeliveryProject, 'flowTemplateSnapshot' | 'flowTemplateHash'>,
  rawStageId: string,
): FlowStageId {
  const { template } = readPinnedSnapshot(project)
  const parsed = flowStageIdSchema.safeParse(rawStageId)
  const stages = Array.isArray(template.stages) ? template.stages : []
  if (parsed.success && stages.some((stage) => stage.kind === parsed.data)) return parsed.data
  throw deliveryFlowHttpError(
    buildDeliveryFlowError('stage_unknown', 'Stage is not part of the pinned template', [
      { path: 'stageId', code: 'stage_unknown', message: rawStageId.slice(0, 100) },
    ]),
  )
}

function projectContext(project: DeliveryProject) {
  return { projectId: project.id, targetProfileId: project.targetProfileId, targetProfileVersion: project.targetProfileVersion }
}

function toArtifactRef(row: Pick<DeliveryFlowStageArtifact, 'id' | 'version' | 'contentHash'>): StageArtifactRef {
  return { artifactId: row.id, version: row.version, contentHash: row.contentHash }
}

function toStoredDecision(row: DeliveryFlowStageDecision): StoredDecision {
  return {
    ...toStageDecisionRecord(row),
    subjectVersion: row.subjectVersion,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
  }
}

function toDecisionRecords(rows: readonly DeliveryFlowStageDecision[]): StageDecisionRecord[] {
  return rows.map(toStoredDecision)
}

/**
 * Comment threads of a stage (F11/F12, L17). Until the comment tables are populated by the import command this answers
 * no threads, so approvals are not blocked by feedback; L17 replaces this loader with the `delivery_comment_threads`
 * query and keeps the signature.
 */
export async function loadStageCommentThreads(
  _em: EntityManager,
  _projectId: string,
  _stageId: FlowStageId,
  _scope: DeliveryScope,
): Promise<CommentThreadRecord[]> {
  return []
}

/** Persists hash-bound deferrals on the thread rows (L17). No thread rows exist before the import lands, so this is a no-op. */
export async function recordThreadDeferrals(_tx: EntityManager, _deferrals: readonly ThreadDeferral[]): Promise<void> {
  return undefined
}

/**
 * The v1 stage contents carry no acceptance-criterion references (design screens have no `acIds`; the Scope content
 * defines the criteria instead of citing them), so the collector yields nothing. An additive v2 content field plugs
 * in here without touching the plan.
 */
export function collectArtifactAcReferences(_artifact: StageArtifactV1): AcReference[] {
  return []
}

function resolveScopeAcIds(artifact: StageArtifactV1, rows: readonly DeliveryFlowStageArtifact[]): ReadonlySet<string> | null {
  if (artifact.stageId === 'scope') return null
  const bound = artifact.dependsOn.find((dependency) => dependency.stageId === 'scope')
  const scopeRow = bound ? rows.find((row) => row.id === bound.artifactId && row.stageId === 'scope') : undefined
  const criteria = scopeRow?.content.acceptanceCriteria
  if (!Array.isArray(criteria)) return null
  const ids = criteria.flatMap((criterion) => {
    const id = typeof criterion === 'object' && criterion !== null ? (criterion as { id?: unknown }).id : undefined
    return typeof id === 'string' ? [id] : []
  })
  return new Set(ids)
}

function artifactAttachmentReferences(artifact: StageArtifactV1): AttachmentReference[] {
  const screens = artifact.stageId === 'scope' ? [] : artifact.content.screens
  return collectAttachmentReferences({ screens, attachments: artifact.attachments })
}

function resolveActor(ctx: CommandRuntimeContext, trustedActorId: string | undefined): string | null {
  const parsed = uuidSchema.safeParse(ctx.auth?.sub)
  if (parsed.success) return parsed.data
  return trustedActorId ?? null
}

function trustedExecutionRequired(): ReturnType<typeof deliveryHttpError> {
  return deliveryHttpError(
    buildDeliveryError('forbidden', 'The trusted execution option is reserved for the in-process scoping agent', [
      { path: 'trustedExecution', code: 'trusted_execution_required' },
    ]),
  )
}

async function enforceProjectLock(ctx: CommandRuntimeContext, project: DeliveryProject): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
    resourceId: project.id,
    current: project.updatedAt,
    request: ctx.request ?? null,
  })
}

/**
 * The stage's `approverFeatures` from the pinned snapshot are matched against the caller's grant list with wildcards
 * intact. A stage that lists no features needs no RBAC lookup; a failing lookup grants nothing (fail closed → 403).
 */
async function resolveGrantedFeatures(ctx: CommandRuntimeContext, scope: DeliveryScope, templateStage: FlowTemplateStage): Promise<string[]> {
  if (templateStage.approverFeatures.length === 0) return []
  const userId = ctx.auth?.sub
  if (!userId) return []
  try {
    const rbac = ctx.container.resolve('rbacService') as FeatureGrantReader
    const granted = await rbac.getGrantedFeatures(userId, scope)
    return Array.isArray(granted) ? granted.filter((feature): feature is string => typeof feature === 'string') : []
  } catch (error) {
    logger.warn('stage approver feature lookup failed closed', { stageId: templateStage.stageId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.feature_check_failed' })
    return []
  }
}

// --- F7 stages.create_artifact ----------------------------------------------

type ArtifactPlanning = { snapshot: PinnedSnapshot; plan: StageArtifactPlan & { ok: true } }

async function planArtifactFor(
  em: EntityManager,
  project: DeliveryProject,
  parsed: StageArtifactCreateCommandInput,
  scope: DeliveryScope,
): Promise<ArtifactPlanning> {
  const snapshot = readPinnedSnapshot(project)
  requireTemplateStage(snapshot.template, parsed.stageId)
  const artifactRows = await loadStageArtifactRows(em, project.id, scope)
  const decisionRows = await loadStageDecisionRows(em, project.id, scope)
  const plan = planStageArtifact({
    artifact: parsed.artifact,
    project: projectContext(project),
    template: snapshot.template,
    existing: artifactRows.map(toStageArtifactRecord),
    decisions: toDecisionRecords(decisionRows),
    resolvedScopeAcIds: resolveScopeAcIds(parsed.artifact, artifactRows),
    acReferences: collectArtifactAcReferences(parsed.artifact),
  })
  if (!plan.ok) throw deliveryFlowHttpError(plan)
  return { snapshot, plan }
}

function findArtifactByHash(
  em: EntityManager,
  projectId: string,
  stageId: FlowStageId,
  contentHash: string,
  scope: DeliveryScope,
): Promise<DeliveryFlowStageArtifact | null> {
  return findOneWithDecryption(
    em,
    DeliveryFlowStageArtifact,
    { projectId, stageId, contentHash, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

type ArtifactOutcome = { project: DeliveryProject; ref: StageArtifactRef; duplicate: boolean; downstreamNowStale: FlowStageId[] }

function toArtifactResult(outcome: ArtifactOutcome, stageId: FlowStageId): StageArtifactCommandResult {
  return stageArtifactCreateResponseSchema.parse({
    artifactId: outcome.ref.artifactId,
    projectId: outcome.project.id,
    stageId,
    version: outcome.ref.version,
    contentHash: outcome.ref.contentHash,
    duplicate: outcome.duplicate,
    downstreamNowStale: outcome.downstreamNowStale,
    projectUpdatedAt: outcome.project.updatedAt.toISOString(),
  })
}

async function emitArtifactCreated(scope: DeliveryScope, outcome: ArtifactOutcome, stageId: FlowStageId): Promise<void> {
  await emitDeliveryOsEvent(
    'delivery_os.stage.artifact_created',
    {
      projectId: outcome.project.id,
      stageId,
      artifactId: outcome.ref.artifactId,
      version: outcome.ref.version,
      contentHash: outcome.ref.contentHash,
      downstreamNowStale: outcome.downstreamNowStale,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

const createArtifactCommand: CommandHandler<StageArtifactCreateCommandInput, StageArtifactCommandResult> = {
  id: 'delivery_os.stages.create_artifact',
  async execute(rawInput, ctx) {
    const trustedOption = readTrustedExecutionOption(rawInput)
    if (trustedOption !== undefined && (ctx.request || !isIssuedTrustedExecution(trustedOption))) throw trustedExecutionRequired()
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(stageArtifactCreateCommandSchema, rawInput)
    const actor = resolveActor(ctx, parsed.trustedExecution?.actorUserId)

    const probeEm = resolveDeliveryEm(ctx)
    const probeProject = await requireScopedProject(probeEm, parsed.projectId, scope)
    const probe = await planArtifactFor(probeEm, probeProject, parsed, scope)
    if (probe.plan.duplicate) {
      return toArtifactResult({ project: probeProject, ref: probe.plan.existing, duplicate: true, downstreamNowStale: [] }, parsed.stageId)
    }
    assertDeliveryCheck(await verifyAttachmentReferences(probeEm, ctx, artifactAttachmentReferences(parsed.artifact), scope))
    if (ctx.request) requireLockHeader(ctx)

    const em = resolveDeliveryEm(ctx)
    let outcome: ArtifactOutcome
    try {
      const written = await em.transactional(async (tx) => {
        const project = await lockScopedProject(tx, parsed.projectId, scope)
        const { snapshot, plan } = await planArtifactFor(tx, project, parsed, scope)
        if (plan.duplicate) return { project, row: null, ref: plan.existing, downstreamNowStale: [] as FlowStageId[] }
        const tasks = await lockScopedProjectTasks(tx, project.id, scope)
        assertDeliveryCheck(checkProjectArchivable(tasks, 'stage'))
        await enforceProjectLock(ctx, project)
        const now = new Date()
        const row = tx.create(DeliveryFlowStageArtifact, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          stageId: parsed.stageId,
          version: plan.version,
          contentHash: plan.contentHash,
          source: parsed.artifact.source,
          content: parsed.artifact.content,
          dependsOn: parsed.artifact.dependsOn,
          attachmentIds: [...new Set(artifactAttachmentReferences(parsed.artifact).map((reference) => reference.attachmentId))],
          templateHash: snapshot.hash,
          createdBy: actor,
          createdAt: now,
        })
        tx.persist(row)
        project.updatedAt = now
        return { project, row, ref: null, downstreamNowStale: plan.downstreamNowStale }
      })
      outcome = written.row
        ? { project: written.project, ref: toArtifactRef(written.row), duplicate: false, downstreamNowStale: written.downstreamNowStale }
        : { project: written.project, ref: written.ref as StageArtifactRef, duplicate: true, downstreamNowStale: [] }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const recoveryEm = resolveDeliveryEm(ctx)
      const winner = await findArtifactByHash(recoveryEm, parsed.projectId, parsed.stageId, probe.plan.contentHash, scope)
      if (!winner) throw error
      outcome = { project: await requireScopedProject(recoveryEm, parsed.projectId, scope), ref: toArtifactRef(winner), duplicate: true, downstreamNowStale: [] }
    }

    if (!outcome.duplicate) await emitArtifactCreated(scope, outcome, parsed.stageId)
    return toArtifactResult(outcome, parsed.stageId)
  },
  buildLog: async ({ input, result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const parsed = stageArtifactCreateCommandSchema.safeParse(input)
    const trustedActorId = parsed.success ? parsed.data.trustedExecution?.actorUserId : undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.stages.create_artifact', 'Record delivery stage artifact'),
      resourceKind: DELIVERY_STAGE_ARTIFACT_RESOURCE_KIND,
      resourceId: result.artifactId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(trustedActorId ? { actorUserId: trustedActorId } : {}),
      snapshotAfter: {
        artifactId: result.artifactId,
        projectId: result.projectId,
        stageId: result.stageId,
        version: result.version,
        contentHash: result.contentHash,
        downstreamNowStale: result.downstreamNowStale,
      },
    }
  },
}

// --- F8 stages.decide --------------------------------------------------------

type DecisionPlanning = { snapshot: PinnedSnapshot; plan: StageDecisionPlan & { ok: true }; stored: StoredDecision[] }

type DecisionGrants = { grantedFeatures: string[] }

/** The grant list is resolved once on the probe (before any row lock) and reused under the lock and in recovery. */
async function resolveDecisionGrants(ctx: CommandRuntimeContext, scope: DeliveryScope, project: DeliveryProject, stageId: FlowStageId): Promise<DecisionGrants> {
  const snapshot = readPinnedSnapshot(project)
  const templateStage = requireTemplateStage(snapshot.template, stageId)
  return { grantedFeatures: await resolveGrantedFeatures(ctx, scope, templateStage) }
}

async function planDecisionFor(
  em: EntityManager,
  grants: DecisionGrants,
  project: DeliveryProject,
  parsed: StageDecisionCommandInput,
  scope: DeliveryScope,
  now: Date,
): Promise<DecisionPlanning> {
  const snapshot = readPinnedSnapshot(project)
  requireTemplateStage(snapshot.template, parsed.stageId)
  const { grantedFeatures } = grants
  const artifactRows = await loadStageArtifactRows(em, project.id, scope)
  const stored = (await loadStageDecisionRows(em, project.id, scope)).map(toStoredDecision)
  const threads = await loadStageCommentThreads(em, project.id, parsed.stageId, scope)
  const plan = planStageDecision({
    request: parsed.decision,
    idempotencyKey: parsed.idempotencyKey,
    stageId: parsed.stageId,
    template: snapshot.template,
    grantedFeatures,
    artifacts: artifactRows.map(toStageArtifactRecord),
    projectDecisions: stored,
    threads,
    now: now.toISOString(),
  })
  if (!plan.ok) throw deliveryFlowHttpError(plan)
  return { snapshot, plan, stored }
}

function findDecisionByKey(em: EntityManager, projectId: string, idempotencyKey: string, scope: DeliveryScope): Promise<DeliveryFlowStageDecision | null> {
  return findOneWithDecryption(
    em,
    DeliveryFlowStageDecision,
    { projectId, idempotencyKey, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

type DecisionSubject = Pick<StoredDecision, 'id' | 'artifactId' | 'subjectHash' | 'subjectVersion' | 'verdict' | 'clientApproved'>

type DecisionOutcome = { project: DeliveryProject; subject: DecisionSubject; currency: StageCurrency; duplicate: boolean }

function replayedSubject(planning: DecisionPlanning, existingId: string): DecisionSubject {
  const found = planning.stored.find((candidate) => candidate.id === existingId)
  if (found) return found
  throw new Error('[internal] replayed stage decision is not among the loaded rows')
}

function toDecisionResult(outcome: DecisionOutcome, stageId: FlowStageId): StageDecisionCommandResult {
  return stageDecisionResponseSchema.parse({
    decisionId: outcome.subject.id,
    projectId: outcome.project.id,
    stageId,
    artifactId: outcome.subject.artifactId,
    subjectHash: outcome.subject.subjectHash,
    subjectVersion: outcome.subject.subjectVersion,
    verdict: outcome.subject.verdict,
    clientApproved: outcome.subject.clientApproved,
    currency: outcome.currency,
    duplicate: outcome.duplicate,
    projectUpdatedAt: outcome.project.updatedAt.toISOString(),
  })
}

async function emitStageDecided(scope: DeliveryScope, outcome: DecisionOutcome, stageId: FlowStageId): Promise<void> {
  await emitDeliveryOsEvent(
    'delivery_os.stage.decided',
    {
      projectId: outcome.project.id,
      stageId,
      artifactId: outcome.subject.artifactId,
      decisionId: outcome.subject.id,
      verdict: outcome.subject.verdict,
      currency: outcome.currency,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

function idempotencyConflict(): ReturnType<typeof deliveryFlowHttpError> {
  return deliveryFlowHttpError(
    buildDeliveryFlowError('idempotency_conflict', 'Idempotency-Key was used with a different request', [
      { path: 'idempotencyKey', code: 'idempotency_conflict', message: 'Same key, different stage or body' },
    ]),
  )
}

const decideCommand: CommandHandler<StageDecisionCommandInput, StageDecisionCommandResult> = {
  id: 'delivery_os.stages.decide',
  async execute(rawInput, ctx) {
    requireIdempotencyKey(rawInput)
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(stageDecisionCommandSchema, rawInput)
    const actor = requireActorUserId(ctx)

    const probeEm = resolveDeliveryEm(ctx)
    const probeProject = await requireScopedProject(probeEm, parsed.projectId, scope)
    const grants = await resolveDecisionGrants(ctx, scope, probeProject, parsed.stageId)
    const probe = await planDecisionFor(probeEm, grants, probeProject, parsed, scope, new Date())
    if (probe.plan.duplicate) {
      return toDecisionResult(
        { project: probeProject, subject: replayedSubject(probe, probe.plan.existing.id), currency: probe.plan.currency, duplicate: true },
        parsed.stageId,
      )
    }
    requireLockHeader(ctx)

    const em = resolveDeliveryEm(ctx)
    let outcome: DecisionOutcome
    try {
      const written = await em.transactional(async (tx) => {
        const project = await lockScopedProject(tx, parsed.projectId, scope)
        const now = new Date()
        const planning = await planDecisionFor(tx, grants, project, parsed, scope, now)
        const { snapshot, plan } = planning
        if (plan.duplicate) return { project, row: null, subject: replayedSubject(planning, plan.existing.id), currency: plan.currency }
        await enforceProjectLock(ctx, project)
        const clientApproval = plan.record.clientApproved ? (parsed.decision.clientApproval ?? null) : null
        const row = tx.create(DeliveryFlowStageDecision, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          stageId: parsed.stageId,
          artifactId: plan.record.artifactId,
          subjectHash: plan.record.subjectHash,
          subjectVersion: plan.record.subjectVersion,
          verdict: plan.record.verdict,
          reason: plan.record.reason,
          actorUserId: actor,
          decidedAt: now,
          clientApproverName: clientApproval?.approverName ?? null,
          clientApproverRole: clientApproval?.approverRole ?? null,
          clientApprovalEvidence: clientApproval?.evidence ?? null,
          deferredThreadKeys: plan.record.deferredThreadKeys,
          templateHash: snapshot.hash,
          idempotencyKey: parsed.idempotencyKey,
          requestHash: plan.requestHash,
          createdAt: now,
        })
        tx.persist(row)
        await recordThreadDeferrals(tx, plan.deferrals)
        project.updatedAt = now
        return { project, row, subject: null, currency: plan.currency }
      })
      outcome = written.row
        ? {
            project: written.project,
            subject: {
              id: written.row.id,
              artifactId: written.row.artifactId,
              subjectHash: written.row.subjectHash,
              subjectVersion: written.row.subjectVersion,
              verdict: written.row.verdict,
              clientApproved: typeof written.row.clientApproverName === 'string' && written.row.clientApproverName.length > 0,
            },
            currency: written.currency,
            duplicate: false,
          }
        : { project: written.project, subject: written.subject as DecisionSubject, currency: written.currency, duplicate: true }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const recoveryEm = resolveDeliveryEm(ctx)
      const winner = await findDecisionByKey(recoveryEm, parsed.projectId, parsed.idempotencyKey, scope)
      if (!winner) throw error
      if (winner.stageId !== parsed.stageId || winner.requestHash !== hashStageDecisionRequest(parsed.decision)) throw idempotencyConflict()
      const project = await requireScopedProject(recoveryEm, parsed.projectId, scope)
      const replay = await planDecisionFor(recoveryEm, grants, project, parsed, scope, new Date())
      outcome = { project, subject: toStoredDecision(winner), currency: replay.plan.currency, duplicate: true }
    }

    if (!outcome.duplicate) await emitStageDecided(scope, outcome, parsed.stageId)
    return toDecisionResult(outcome, parsed.stageId)
  },
  buildLog: async ({ result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.stages.decide', 'Decide delivery stage'),
      resourceKind: DELIVERY_STAGE_DECISION_RESOURCE_KIND,
      resourceId: result.decisionId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: {
        decisionId: result.decisionId,
        projectId: result.projectId,
        stageId: result.stageId,
        artifactId: result.artifactId,
        subjectVersion: result.subjectVersion,
        verdict: result.verdict,
        clientApproved: result.clientApproved,
        currency: result.currency,
      },
    }
  },
}

registerCommand(createArtifactCommand)
registerCommand(decideCommand)
