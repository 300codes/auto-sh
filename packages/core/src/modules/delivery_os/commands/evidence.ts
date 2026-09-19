import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { DeliveryEvidence, DeliveryTask, type DeliveryBaseline, type DeliveryProject } from '../data/entities'
import {
  acceptResultCommandSchema,
  parseRecordEvidenceBody,
  type AcceptResultCommandInput,
  type RecordEvidenceInput,
  type RecordableEvidenceKind,
} from '../data/validators'
import { closeAttempt, findAttempt, parseAttemptRegister, recordAttemptResult } from '../lib/attempts'
import { buildDeliveryError, uuidSchema, type ExecutionAttempt, type TaskStatus } from '../lib/contracts'
import {
  checkScanEvidence,
  checkTestEvidence,
  deriveDeploymentVerificationStatus,
  hashEvidenceIdentity,
} from '../lib/evidenceRules'
import { hashCanonical } from '../lib/hash'
import { evaluateResultAcceptance } from '../lib/resultAcceptance'
import { assertRevisionKind, isEvidenceKindPermitted, type TargetProfile } from '../lib/targetProfiles'
import { canTransition } from '../lib/taskLifecycle'
import { isIssuedTrustedExecution, readTrustedExecutionOption } from '../lib/trustedExecution'
import { emitDeliveryOsEvent } from '../events'
import { verifyEvidenceAttachments, verifyResultArtifacts } from './attachments'
import { loadTaskPackage } from './attemptQueries'
import { unreadableRegisterError } from './attempts'
import {
  assertDeliveryCheck,
  DELIVERY_EVIDENCE_RESOURCE_KIND,
  DELIVERY_TASK_RESOURCE_KIND,
  deliveryHttpError,
  DELIVERY_PROJECT_RESOURCE_KIND,
  lockScopedProject,
  lockScopedTask,
  parseDeliveryInput,
  requireScopedProject,
  requireScopedTask,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'
import {
  emitTaskSideEffects,
  emitTaskUpdated,
  findProjectBaseline,
  foreignBaselineError,
  readBaselineContent,
  requireTaskProfile,
  unreadableBaselineError,
} from './tasks'

export type ResultAcceptCommandResult = {
  evidenceId: string
  duplicate: boolean
  taskStatus: TaskStatus
  taskUpdatedAt: string
}

type CompletionDelivery = ExecutionAttempt['completionDelivery']

export type AcceptOutcome = {
  task: DeliveryTask
  evidenceId: string
  evidence: DeliveryEvidence | null
  completionDelivery: CompletionDelivery
}

const RESULT_MANIFEST_UNIQUE_INDEX = 'delivery_evidence_result_manifest_uq'

const evidenceCrudIndexer: CrudIndexerConfig<DeliveryEvidence> = {
  entityType: E.delivery_os.delivery_evidence,
}

function assertSourceAllowed(parsed: AcceptResultCommandInput, rawInput: unknown, ctx: CommandRuntimeContext): void {
  if (parsed.source === 'manual') return
  if (!ctx.request && isIssuedTrustedExecution(readTrustedExecutionOption(rawInput))) return
  throw deliveryHttpError(
    buildDeliveryError('forbidden', 'Adapter results are accepted only from the trusted in-process executor', [
      { path: 'source', code: 'trusted_execution_required' },
    ]),
  )
}

function readAttemptRegister(task: DeliveryTask): ExecutionAttempt[] {
  const register = parseAttemptRegister(task.executionAttempts)
  if (register.ok) return register.register
  throw deliveryHttpError(
    buildDeliveryError('reconciliation_required', 'Reconcile the unknown attempt before continuing', [
      { path: 'executionAttempts', code: 'unreadable_attempt_register' },
    ]),
  )
}

function findResultEvidence(
  em: EntityManager,
  taskId: string,
  attemptId: string,
  scope: DeliveryScope,
): Promise<DeliveryEvidence | null> {
  return findOneWithDecryption(
    em,
    DeliveryEvidence,
    { taskId, attemptId, kind: 'result_manifest', tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

function toResult(outcome: AcceptOutcome): ResultAcceptCommandResult {
  return {
    evidenceId: outcome.evidenceId,
    duplicate: outcome.evidence === null,
    taskStatus: outcome.task.status,
    taskUpdatedAt: (outcome.task.updatedAt ?? new Date()).toISOString(),
  }
}

export type AcceptResultInput = {
  task: DeliveryTask
  scope: DeliveryScope
  attemptId: string
  manifest: unknown
  source: 'manual' | 'adapter'
  recordedBy: string | null
  register?: readonly ExecutionAttempt[]
  onEvaluated?: (manifestHash: string) => void
}

export async function acceptResultInTransaction(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  input: AcceptResultInput,
): Promise<AcceptOutcome> {
  const { task, scope } = input
  const project = await requireScopedProject(tx, task.projectId, scope)
  const register = input.register ?? readAttemptRegister(task)
  const attempt = findAttempt(register, input.attemptId)
  const taskPackage = await loadTaskPackage(tx, { task, project, attempt, scope }, { attemptGate: 'none' })
  const existing = attempt ? await findResultEvidence(tx, task.id, attempt.attemptId, scope) : null

  const evaluation = evaluateResultAcceptance({
    manifestRaw: input.manifest,
    task,
    attempt,
    taskPackage,
    existingResult: existing ? { evidenceId: existing.id, payloadHash: existing.payloadHash } : null,
  })
  if (!evaluation.ok) throw deliveryHttpError(evaluation)
  input.onEvaluated?.(evaluation.manifestHash)
  if (evaluation.outcome === 'duplicate') {
    return { task, evidenceId: evaluation.evidenceId, evidence: null, completionDelivery: attempt?.completionDelivery ?? null }
  }

  assertDeliveryCheck(
    canTransition(task.status, 'awaiting_review', { source: 'command', statusReason: task.statusReason ?? null }),
  )
  const artifacts = await verifyResultArtifacts(tx, ctx, evaluation.manifest.artifacts, scope)
  if (!artifacts.ok) throw deliveryHttpError(artifacts)
  const evidenceId = randomUUID()
  const recorded = recordAttemptResult(register, {
    attemptId: input.attemptId,
    evidenceId,
    externalRunId: evaluation.manifest.externalRunId,
  })
  if (!recorded.ok) throw deliveryHttpError(recorded)
  const closed = closeAttempt(recorded.register, { attemptId: input.attemptId, now: new Date().toISOString() })
  if (!closed.ok) throw deliveryHttpError(closed)

  const evidence = tx.create(DeliveryEvidence, {
    id: evidenceId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    baselineId: task.baselineId,
    taskId: task.id,
    attemptId: input.attemptId,
    kind: 'result_manifest',
    source: input.source,
    sourceRevision: evaluation.manifest.resultRevision,
    payload: evaluation.manifest,
    payloadHash: evaluation.manifestHash,
    rawReportHash: null,
    attachmentIds: artifacts.attachmentIds,
    recordedBy: input.recordedBy,
  })
  tx.persist(evidence)
  task.executionAttempts = closed.register
  task.status = 'awaiting_review'
  task.statusReason = null
  return { task, evidenceId, evidence, completionDelivery: closed.attempt.completionDelivery }
}

export async function emitResultAccepted(
  ctx: CommandRuntimeContext,
  scope: DeliveryScope,
  attemptId: string,
  outcome: AcceptOutcome,
): Promise<void> {
  await emitDeliveryOsEvent(
    'delivery_os.evidence.recorded',
    {
      projectId: outcome.task.projectId,
      taskId: outcome.task.id,
      attemptId,
      evidenceId: outcome.evidenceId,
      kind: 'result_manifest',
      duplicate: outcome.evidence === null,
      completionDelivery: outcome.completionDelivery,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!outcome.evidence) return
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'created',
    entity: outcome.evidence,
    identifiers: { id: outcome.evidenceId, organizationId: scope.organizationId, tenantId: scope.tenantId },
    indexer: evidenceCrudIndexer,
  })
  await emitTaskSideEffects(ctx, 'updated', outcome.task)
  await emitTaskUpdated(outcome.task)
}

const acceptResultCommand: CommandHandler<unknown, ResultAcceptCommandResult> = {
  id: 'delivery_os.results.accept',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(acceptResultCommandSchema, rawInput)
    assertSourceAllowed(parsed, rawInput, ctx)
    const recordedBy = uuidSchema.safeParse(ctx.auth?.sub)

    const evaluated = { manifestHash: null as string | null }
    const em = resolveDeliveryEm(ctx)
    let outcome: AcceptOutcome
    try {
      outcome = await em.transactional(async (tx): Promise<AcceptOutcome> => {
        const task = await lockScopedTask(tx, parsed.taskId, scope)
        return acceptResultInTransaction(tx, ctx, {
          task,
          scope,
          attemptId: parsed.attemptId,
          manifest: parsed.manifest,
          source: parsed.source,
          recordedBy: recordedBy.success ? recordedBy.data : null,
          onEvaluated: (manifestHash) => {
            evaluated.manifestHash = manifestHash
          },
        })
      })
    } catch (error) {
      if (!evaluated.manifestHash || !isUniqueViolation(error, RESULT_MANIFEST_UNIQUE_INDEX)) throw error
      const readEm = resolveDeliveryEm(ctx)
      const winner = await findResultEvidence(readEm, parsed.taskId, parsed.attemptId, scope)
      if (!winner) throw error
      if (winner.payloadHash !== evaluated.manifestHash) {
        throw deliveryHttpError(
          buildDeliveryError('result_conflict', 'This attempt already has a different result', [
            { path: 'manifest', code: 'result_conflict' },
          ]),
        )
      }
      const task = await requireScopedTask(readEm, parsed.taskId, scope)
      const committed = findAttempt(readAttemptRegister(task), parsed.attemptId)
      outcome = { task, evidenceId: winner.id, evidence: null, completionDelivery: committed?.completionDelivery ?? null }
    }

    await emitResultAccepted(ctx, scope, parsed.attemptId, outcome)
    return toResult(outcome)
  },
  buildLog: async ({ input, result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const parsed = acceptResultCommandSchema.safeParse(input)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.results.accept', 'Accept result manifest'),
      resourceKind: DELIVERY_EVIDENCE_RESOURCE_KIND,
      resourceId: result.evidenceId,
      parentResourceKind: DELIVERY_TASK_RESOURCE_KIND,
      parentResourceId: parsed.success ? parsed.data.taskId : null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: { ...result, source: parsed.success ? parsed.data.source : null },
    }
  },
}

registerCommand(acceptResultCommand)

export type EvidenceRecordCommandResult = {
  evidenceId: string
  duplicate: boolean
  kind: RecordableEvidenceKind
}

type RecordOutcome = {
  evidenceId: string
  evidence: DeliveryEvidence | null
  taskId: string | null
  attemptId: string | null
}

function parseRecordEvidenceInput(rawInput: unknown): { projectId: string; evidence: RecordEvidenceInput } {
  const projectId = typeof rawInput === 'object' && rawInput !== null && 'projectId' in rawInput ? rawInput.projectId : undefined
  const parsedProjectId = uuidSchema.safeParse(projectId)
  if (!parsedProjectId.success) {
    throw deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path: 'projectId', code: 'not_found' }]))
  }
  const parsed = parseRecordEvidenceBody(rawInput)
  if (!parsed.ok) throw deliveryHttpError(parsed)
  if (parsed.data.kind === 'review') {
    throw deliveryHttpError(
      buildDeliveryError('unsupported_evidence_kind', 'Review evidence is not recorded through this command yet', [
        { path: 'kind', code: 'review_not_yet_supported' },
      ]),
    )
  }
  return { projectId: parsedProjectId.data, evidence: parsed.data }
}

function findRecordedEvidence(
  tx: EntityManager,
  project: DeliveryProject,
  input: RecordEvidenceInput,
  payloadHash: string,
  scope: DeliveryScope,
): Promise<DeliveryEvidence | null> {
  return findOneWithDecryption(
    tx,
    DeliveryEvidence,
    {
      projectId: project.id,
      kind: input.kind,
      taskId: input.taskId ?? null,
      attemptId: input.attemptId ?? null,
      payloadHash,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
}

async function requireEvidenceBaseline(
  tx: EntityManager,
  project: DeliveryProject,
  baselineId: string,
  scope: DeliveryScope,
): Promise<DeliveryBaseline> {
  const baseline = await findProjectBaseline(tx, baselineId, project.id, scope)
  if (!baseline) throw deliveryHttpError(foreignBaselineError())
  return baseline
}

async function requireEvidenceTask(
  tx: EntityManager,
  project: DeliveryProject,
  input: RecordEvidenceInput,
  scope: DeliveryScope,
): Promise<DeliveryTask | null> {
  if (!input.taskId) return null
  const task = await findOneWithDecryption(
    tx,
    DeliveryTask,
    { id: input.taskId, projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (!task) {
    throw deliveryHttpError(
      buildDeliveryError('foreign_reference', 'Task does not belong to this project', [{ path: 'taskId', code: 'foreign_task' }]),
    )
  }
  const details = task.baselineId === input.baselineId ? [] : [{ path: 'baselineId', code: 'task_baseline_mismatch' }]
  if (input.attemptId) {
    const register = parseAttemptRegister(task.executionAttempts)
    if (!register.ok) throw unreadableRegisterError()
    const attempt = findAttempt(register.register, input.attemptId)
    if (!attempt) {
      throw deliveryHttpError(buildDeliveryError('attempt_not_found', 'Attempt not found', [{ path: 'attemptId', code: 'attempt_not_found' }]))
    }
    if (attempt.baselineId !== input.baselineId) details.push({ path: 'attemptId', code: 'attempt_baseline_mismatch' })
  }
  if (details.length > 0) {
    throw deliveryHttpError(buildDeliveryError('baseline_mismatch', 'The task or attempt is pinned to another baseline', details))
  }
  return task
}

function assertKindRules(input: RecordEvidenceInput, profile: TargetProfile, baseline: DeliveryBaseline, task: DeliveryTask | null): void {
  if (!isEvidenceKindPermitted(profile, input.kind)) {
    throw deliveryHttpError(
      buildDeliveryError('unsupported_evidence_kind', `Profile ${profile.id}@${profile.version} does not permit this evidence kind`, [
        { path: 'kind', code: 'kind_not_permitted_for_profile', message: `Permitted: ${profile.permittedEvidenceKinds.join(', ')}` },
      ]),
    )
  }
  if (input.sourceRevision) {
    const revisionKind = assertRevisionKind(profile, input.sourceRevision)
    if (!revisionKind.ok) {
      throw deliveryHttpError(
        buildDeliveryError(
          'revision_kind_mismatch',
          revisionKind.body.error,
          revisionKind.body.details.map((detail) => ({ ...detail, path: 'sourceRevision.kind' })),
        ),
      )
    }
  }
  if (input.kind === 'scan') assertDeliveryCheck(checkScanEvidence(profile, input.payload))
  if (input.kind !== 'test') return
  if (!input.sourceRevision) {
    throw deliveryHttpError(
      buildDeliveryError('validation_failed', 'Test evidence needs the revision it ran on', [
        { path: 'sourceRevision', code: 'validation_failed' },
      ]),
    )
  }
  const content = readBaselineContent(baseline)
  if (!content) throw deliveryHttpError(unreadableBaselineError())
  if (hashCanonical(baseline.content) !== baseline.contentHash) {
    throw deliveryHttpError(
      buildDeliveryError('hash_mismatch', 'Stored baseline content does not match its hash', [
        { path: 'baselineId', code: 'stored_content_altered' },
      ]),
    )
  }
  assertDeliveryCheck(
    checkTestEvidence({
      checks: input.payload.checks,
      sourceRevision: input.sourceRevision,
      content,
      profile,
      taskAcIds: task?.acIds,
    }),
  )
}

function toStoredEvidence(input: RecordEvidenceInput): { payload: Record<string, unknown>; rawReportHash: string | null } {
  if (input.kind === 'deployment') {
    return { payload: { ...input.payload, verificationStatus: deriveDeploymentVerificationStatus(input.payload) }, rawReportHash: null }
  }
  if (input.kind === 'test' || input.kind === 'scan') return { payload: { ...input.payload }, rawReportHash: input.payload.rawReportHash }
  return { payload: { ...input.payload }, rawReportHash: null }
}

async function recordEvidenceInTransaction(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  projectId: string,
  input: RecordEvidenceInput,
  scope: DeliveryScope,
): Promise<RecordOutcome> {
  const project = await lockScopedProject(tx, projectId, scope)
  const payloadHash = hashEvidenceIdentity(input)
  if (payloadHash === null) {
    throw deliveryHttpError(
      buildDeliveryError('validation_failed', 'Evidence is not canonical JSON', [{ path: 'payload', code: 'validation_failed' }]),
    )
  }
  const taskId = input.taskId ?? null
  const attemptId = input.attemptId ?? null
  const existing = await findRecordedEvidence(tx, project, input, payloadHash, scope)
  if (existing) return { evidenceId: existing.id, evidence: null, taskId, attemptId }

  const baseline = await requireEvidenceBaseline(tx, project, input.baselineId, scope)
  const task = await requireEvidenceTask(tx, project, input, scope)
  const profile = task
    ? requireTaskProfile(task.targetProfileId, task.targetProfileVersion)
    : requireTaskProfile(project.targetProfileId, project.targetProfileVersion)
  assertKindRules(input, profile, baseline, task)
  const attachments = await verifyEvidenceAttachments(
    tx,
    ctx,
    {
      screenshot: input.kind === 'screenshot' ? { attachmentId: input.payload.attachmentId, sha256: input.payload.sha256 } : undefined,
      attachmentIds: input.attachmentIds ?? [],
    },
    scope,
  )
  if (!attachments.ok) throw deliveryHttpError(attachments)

  const recordedBy = uuidSchema.safeParse(ctx.auth?.sub)
  const stored = toStoredEvidence(input)
  const evidence = tx.create(DeliveryEvidence, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    baselineId: baseline.id,
    taskId,
    attemptId,
    kind: input.kind,
    source: 'manual',
    sourceRevision: input.sourceRevision ?? null,
    payload: stored.payload,
    payloadHash,
    rawReportHash: stored.rawReportHash,
    attachmentIds: attachments.attachmentIds,
    recordedBy: recordedBy.success ? recordedBy.data : null,
  })
  tx.persist(evidence)
  return { evidenceId: evidence.id, evidence, taskId, attemptId }
}

const recordEvidenceCommand: CommandHandler<unknown, EvidenceRecordCommandResult> = {
  id: 'delivery_os.evidence.record',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const { projectId, evidence: input } = parseRecordEvidenceInput(rawInput)
    const outcome = await resolveDeliveryEm(ctx).transactional((tx) => recordEvidenceInTransaction(tx, ctx, projectId, input, scope))

    await emitDeliveryOsEvent(
      'delivery_os.evidence.recorded',
      {
        projectId,
        taskId: outcome.taskId,
        attemptId: outcome.attemptId,
        evidenceId: outcome.evidenceId,
        kind: input.kind,
        duplicate: outcome.evidence === null,
        completionDelivery: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    if (outcome.evidence) {
      await emitCrudSideEffects({
        dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
        action: 'created',
        entity: outcome.evidence,
        identifiers: { id: outcome.evidenceId, organizationId: scope.organizationId, tenantId: scope.tenantId },
        indexer: evidenceCrudIndexer,
      })
    }
    return { evidenceId: outcome.evidenceId, duplicate: outcome.evidence === null, kind: input.kind }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const projectId = typeof input === 'object' && input !== null && 'projectId' in input ? uuidSchema.safeParse(input.projectId) : null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.evidence.record', 'Record delivery evidence'),
      resourceKind: DELIVERY_EVIDENCE_RESOURCE_KIND,
      resourceId: result.evidenceId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: projectId?.success ? projectId.data : null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: { ...result, source: 'manual' },
    }
  },
}

registerCommand(recordEvidenceCommand)
