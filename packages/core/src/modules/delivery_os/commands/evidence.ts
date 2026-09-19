import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { DeliveryEvidence, DeliveryTask, type DeliveryBaseline, type DeliveryProject } from '../data/entities'
import { proveAcceptanceCriteria, listUnprovenAcIds, type AcProofEvidence } from '../lib/acProof'
import {
  acceptResultCommandSchema,
  parseRecordEvidenceBody,
  type AcceptResultCommandInput,
  type RecordEvidenceInput,
  type RecordableEvidenceKind,
} from '../data/validators'
import { closeAttempt, findAttempt, parseAttemptRegister, recordAttemptResult } from '../lib/attempts'
import {
  buildDeliveryError,
  isSameRevision,
  type BaselineContentV1,
  sourceRevisionSchema,
  uuidSchema,
  type ExecutionAttempt,
  type SourceRevision,
  type TaskStatus,
  type TaskStatusReason,
} from '../lib/contracts'
import {
  checkScanEvidence,
  checkTestEvidence,
  deriveDeploymentVerificationStatus,
  hashEvidenceIdentity,
} from '../lib/evidenceRules'
import { hashCanonical } from '../lib/hash'
import { evaluateResultAcceptance } from '../lib/resultAcceptance'
import { assertRevisionKind, isEvidenceKindPermitted, type TargetProfile } from '../lib/targetProfiles'
import {
  canTransition,
  changesRequestedOutcome,
  planBlockPropagation,
  planUnblockPropagation,
  type VerificationEvidence,
} from '../lib/taskLifecycle'
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
  lockScopedProjectTasks,
  lockScopedTask,
  parseDeliveryInput,
  requireActorUserId,
  requireScopedProject,
  requireScopedTask,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'
import {
  applyPropagation,
  countCorrectionRounds,
  emitTaskSideEffects,
  emitTaskUpdated,
  findProjectBaseline,
  foreignBaselineError,
  readBaselineContent,
  requireTaskProfile,
  toLifecycleTask,
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

export const evidenceCrudIndexer: CrudIndexerConfig<DeliveryEvidence> = {
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
    canTransition(task.status, 'awaiting_review', { source: 'command', currentStatusReason: task.statusReason ?? null }),
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
  taskStatus?: TaskStatus
  taskStatusReason?: string | null
  taskUpdatedAt?: string
  propagatedTaskIds?: string[]
}

type RecordOutcome = {
  evidenceId: string
  evidence: DeliveryEvidence | null
  taskId: string | null
  attemptId: string | null
  task: DeliveryTask | null
  moved: boolean
  propagated: DeliveryTask[]
}

type ReviewInput = Extract<RecordEvidenceInput, { kind: 'review' }> & { taskId: string }

function toReviewInput(input: Extract<RecordEvidenceInput, { kind: 'review' }>): ReviewInput {
  if (input.taskId) return { ...input, taskId: input.taskId }
  throw deliveryHttpError(
    buildDeliveryError('validation_failed', 'A review must name the task it reviews', [{ path: 'taskId', code: 'validation_failed' }]),
  )
}

type TaskTarget = { status: TaskStatus; statusReason: TaskStatusReason | null }

function parseRecordEvidenceInput(rawInput: unknown): { projectId: string; evidence: RecordEvidenceInput } {
  const projectId = typeof rawInput === 'object' && rawInput !== null && 'projectId' in rawInput ? rawInput.projectId : undefined
  const parsedProjectId = uuidSchema.safeParse(projectId)
  if (!parsedProjectId.success) {
    throw deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path: 'projectId', code: 'not_found' }]))
  }
  const parsed = parseRecordEvidenceBody(rawInput)
  if (!parsed.ok) throw deliveryHttpError(parsed)
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
  if (!task) throw deliveryHttpError(foreignTaskError())
  assertTaskPins(task, input)
  return task
}

function foreignTaskError() {
  return buildDeliveryError('foreign_reference', 'Task does not belong to this project', [{ path: 'taskId', code: 'foreign_task' }])
}

function assertTaskPins(task: DeliveryTask, input: RecordEvidenceInput): void {
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
}

export function requireVerifiedBaselineContent(baseline: DeliveryBaseline): BaselineContentV1 {
  const content = readBaselineContent(baseline)
  if (!content) throw deliveryHttpError(unreadableBaselineError())
  if (hashCanonical(baseline.content) !== baseline.contentHash) {
    throw deliveryHttpError(
      buildDeliveryError('hash_mismatch', 'Stored baseline content does not match its hash', [
        { path: 'baselineId', code: 'stored_content_altered' },
      ]),
    )
  }
  return content
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
  const content = requireVerifiedBaselineContent(baseline)
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
  return recordEvidenceWithinTransaction(tx, ctx, project, input, scope)
}

/**
 * Records evidence for a project row the caller already holds under its transaction lock. The publication command
 * (F14) uses it to write the derived v1 `deployment` evidence and the publication row in ONE transaction; the public
 * `delivery_os.evidence.record` command locks the project and delegates here.
 */
export async function recordEvidenceWithinTransaction(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  project: DeliveryProject,
  input: RecordEvidenceInput,
  scope: DeliveryScope,
): Promise<RecordOutcome> {
  const payloadHash = hashEvidenceIdentity(input)
  if (payloadHash === null) {
    throw deliveryHttpError(
      buildDeliveryError('validation_failed', 'Evidence is not canonical JSON', [{ path: 'payload', code: 'validation_failed' }]),
    )
  }
  if (input.kind === 'review') return recordReviewInTransaction(tx, ctx, project, toReviewInput(input), payloadHash, scope)
  const taskId = input.taskId ?? null
  const attemptId = input.attemptId ?? null
  const existing = await findRecordedEvidence(tx, project, input, payloadHash, scope)
  if (existing) return { evidenceId: existing.id, evidence: null, taskId, attemptId, task: null, moved: false, propagated: [] }

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
  return { evidenceId: evidence.id, evidence, taskId, attemptId, task: null, moved: false, propagated: [] }
}

function compareByCreation(left: DeliveryEvidence, right: DeliveryEvidence): number {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime()
  return byTime !== 0 ? byTime : left.id.localeCompare(right.id)
}

async function loadTaskEvidence(tx: EntityManager, project: DeliveryProject, taskId: string, scope: DeliveryScope): Promise<DeliveryEvidence[]> {
  const rows = await findWithDecryption(
    tx,
    DeliveryEvidence,
    { projectId: project.id, taskId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  return [...rows].sort(compareByCreation)
}

async function loadProjectLevelTests(
  tx: EntityManager,
  project: DeliveryProject,
  baselineId: string,
  scope: DeliveryScope,
): Promise<DeliveryEvidence[]> {
  return findWithDecryption(
    tx,
    DeliveryEvidence,
    { projectId: project.id, baselineId, taskId: null, kind: 'test', tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

const REVIEW_HISTORY_KINDS: readonly string[] = ['review', 'result_manifest']

function findReviewReplay(taskRows: readonly DeliveryEvidence[], input: ReviewInput, payloadHash: string): DeliveryEvidence | null {
  const history = taskRows.filter((row) => REVIEW_HISTORY_KINDS.includes(row.kind))
  const newest = history.at(-1)
  if (!newest || newest.kind !== 'review' || newest.payloadHash !== payloadHash) return null
  if ((newest.attemptId ?? null) !== (input.attemptId ?? null)) return null
  return newest
}

function reviewNotAllowed(task: DeliveryTask): never {
  throw deliveryHttpError(
    buildDeliveryError('invalid_transition', `Task cannot be reviewed while ${task.status}`, [
      { path: 'status', code: 'task_not_awaiting_review', message: 'Only a task awaiting review can be reviewed' },
    ]),
  )
}

function assertReviewer(input: ReviewInput, ctx: CommandRuntimeContext): void {
  if (input.payload.reviewer.kind === 'human') requireActorUserId(ctx)
  if (input.payload.manualCheckId === undefined) return
  if (input.payload.reviewer.kind !== 'human') {
    throw deliveryHttpError(
      buildDeliveryError('validation_failed', 'A manual check is decided by a human', [
        { path: 'payload.reviewer.kind', code: 'human_reviewer_required' },
      ]),
    )
  }
}

function assertKnownManualCheck(task: DeliveryTask, content: BaselineContentV1, manualCheckId: string): void {
  const known = task.acIds.some((acId) => Object.hasOwn(content.manualChecks, acId) && content.manualChecks[acId] === manualCheckId)
  if (known) return
  throw deliveryHttpError(
    buildDeliveryError('unknown_test_id', 'Unknown manual check', [
      { path: 'payload.manualCheckId', code: 'unknown_manual_check', message: `${manualCheckId} is not a manual check of this task` },
    ]),
  )
}

function findAcceptedResult(
  taskRows: readonly DeliveryEvidence[],
  task: DeliveryTask,
  attemptId: string | null,
): { row: DeliveryEvidence; revision: SourceRevision } {
  const results = taskRows.filter((row) => row.kind === 'result_manifest' && (attemptId === null || row.attemptId === attemptId))
  const onBaseline = results.filter((row) => row.baselineId === task.baselineId)
  if (onBaseline.length === 0) {
    if (results.length > 0) {
      throw deliveryHttpError(
        buildDeliveryError('baseline_mismatch', 'The accepted result belongs to another baseline', [
          { path: 'evidence', code: 'baseline_mismatch', message: `No accepted result for baseline ${task.baselineId}` },
        ]),
      )
    }
    throw deliveryHttpError(
      buildDeliveryError('missing_required_tests', 'The task has no accepted result to review', [
        { path: 'evidence', code: 'missing_evidence', message: 'No result manifest accepted for the task' },
      ]),
    )
  }
  const row = onBaseline[onBaseline.length - 1]
  const revision = sourceRevisionSchema.safeParse(row.sourceRevision)
  if (!revision.success) {
    throw deliveryHttpError(
      buildDeliveryError('hash_mismatch', 'Stored result revision is not readable', [{ path: 'evidence', code: 'unreadable_result_revision' }]),
    )
  }
  return { row, revision: revision.data }
}

function assertReviewedRevision(input: ReviewInput, resultRevision: SourceRevision): void {
  if (input.sourceRevision && isSameRevision(input.sourceRevision, resultRevision)) return
  throw deliveryHttpError(
    buildDeliveryError('missing_required_tests', 'The review names another revision than the accepted result', [
      { path: 'sourceRevision', code: 'revision_mismatch', message: 'Review the revision of the accepted result' },
    ]),
  )
}

function assertReviewedEvidence(input: ReviewInput, taskRows: readonly DeliveryEvidence[]): void {
  const reviewedId = input.payload.reviewedEvidenceId
  if (reviewedId === undefined || taskRows.some((row) => row.id === reviewedId)) return
  throw deliveryHttpError(
    buildDeliveryError('foreign_reference', 'Reviewed evidence does not belong to this task', [
      { path: 'payload.reviewedEvidenceId', code: 'foreign_evidence' },
    ]),
  )
}

function toProofEvidence(row: DeliveryEvidence): AcProofEvidence {
  const revision = sourceRevisionSchema.safeParse(row.sourceRevision)
  return { id: row.id, kind: row.kind, baselineId: row.baselineId, sourceRevision: revision.success ? revision.data : null, payload: row.payload }
}

function toVerificationEvidence(row: AcProofEvidence): VerificationEvidence {
  return { id: row.id, kind: row.kind, baselineId: row.baselineId, sourceRevision: row.sourceRevision }
}

type ReviewDecisionInput = {
  task: DeliveryTask
  project: DeliveryProject
  content: BaselineContentV1
  input: ReviewInput
  resultRevision: SourceRevision
  taskRows: readonly DeliveryEvidence[]
  projectTests: readonly DeliveryEvidence[]
}

function decideReviewTarget(decision: ReviewDecisionInput): TaskTarget | null {
  const { task, input } = decision
  if (input.payload.manualCheckId !== undefined) return null
  const base = { source: 'command' as const, currentStatusReason: task.statusReason ?? null }
  if (input.payload.verdict === 'changes_requested') {
    const correction = { requested: countCorrectionRounds(decision.taskRows), max: decision.project.limits.maxCorrectionRounds }
    const outcome = changesRequestedOutcome(correction)
    assertDeliveryCheck(canTransition(task.status, outcome.status, { ...base, correction }))
    return outcome
  }
  const evidence = [...decision.taskRows, ...decision.projectTests].sort(compareByCreation).map(toProofEvidence)
  const proofs = proveAcceptanceCriteria({
    acIds: task.acIds,
    acTestMap: decision.content.acTestMap,
    manualChecks: decision.content.manualChecks,
    baselineId: task.baselineId,
    revision: decision.resultRevision,
    evidence,
  })
  assertDeliveryCheck(
    canTransition(task.status, 'verified', {
      ...base,
      verification: {
        taskBaselineId: task.baselineId,
        resultRevision: decision.resultRevision,
        evidence: evidence.map(toVerificationEvidence),
        unprovenAcIds: listUnprovenAcIds(proofs),
      },
    }),
  )
  return { status: 'verified', statusReason: null }
}

function propagateReviewOutcome(task: DeliveryTask, tasks: readonly DeliveryTask[]): DeliveryTask[] {
  const lifecycle = tasks.map(toLifecycleTask)
  if (task.status === 'blocked') return applyPropagation(planBlockPropagation(task.id, lifecycle), tasks)
  if (task.status === 'verified') return applyPropagation(planUnblockPropagation(task.id, lifecycle), tasks)
  return []
}

async function recordReviewInTransaction(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  project: DeliveryProject,
  input: ReviewInput,
  payloadHash: string,
  scope: DeliveryScope,
): Promise<RecordOutcome> {
  const attemptId = input.attemptId ?? null
  assertReviewer(input, ctx)
  const tasks = await lockScopedProjectTasks(tx, project.id, scope)
  const taskRows = await loadTaskEvidence(tx, project, input.taskId, scope)
  const replay = findReviewReplay(taskRows, input, payloadHash)
  if (replay) {
    const current = await requireScopedTask(tx, input.taskId, scope)
    return { evidenceId: replay.id, evidence: null, taskId: input.taskId, attemptId, task: current, moved: false, propagated: [] }
  }

  const baseline = await requireEvidenceBaseline(tx, project, input.baselineId, scope)
  const task = tasks.find((candidate) => candidate.id === input.taskId)
  if (!task) throw deliveryHttpError(foreignTaskError())
  assertTaskPins(task, input)
  const profile = requireTaskProfile(task.targetProfileId, task.targetProfileVersion)
  assertKindRules(input, profile, baseline, task)
  if (task.status !== 'awaiting_review') reviewNotAllowed(task)
  const content = requireVerifiedBaselineContent(baseline)
  if (input.payload.manualCheckId !== undefined) assertKnownManualCheck(task, content, input.payload.manualCheckId)
  const accepted = findAcceptedResult(taskRows, task, attemptId)
  assertReviewedRevision(input, accepted.revision)
  assertReviewedEvidence(input, taskRows)
  const projectTests = await loadProjectLevelTests(tx, project, task.baselineId, scope)
  const target = decideReviewTarget({ task, project, content, input, resultRevision: accepted.revision, taskRows, projectTests })

  const attachments = await verifyEvidenceAttachments(tx, ctx, { attachmentIds: input.attachmentIds ?? [] }, scope)
  if (!attachments.ok) throw deliveryHttpError(attachments)

  const recordedBy = uuidSchema.safeParse(ctx.auth?.sub)
  const evidence = tx.create(DeliveryEvidence, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    baselineId: baseline.id,
    taskId: task.id,
    attemptId,
    kind: 'review',
    source: 'manual',
    sourceRevision: input.sourceRevision ?? null,
    payload: { ...input.payload },
    payloadHash,
    rawReportHash: null,
    attachmentIds: attachments.attachmentIds,
    recordedBy: recordedBy.success ? recordedBy.data : null,
  })
  tx.persist(evidence)
  if (!target) return { evidenceId: evidence.id, evidence, taskId: task.id, attemptId, task, moved: false, propagated: [] }
  task.status = target.status
  task.statusReason = target.statusReason
  return { evidenceId: evidence.id, evidence, taskId: task.id, attemptId, task, moved: true, propagated: propagateReviewOutcome(task, tasks) }
}

function toRecordResult(outcome: RecordOutcome, kind: RecordableEvidenceKind): EvidenceRecordCommandResult {
  const base = { evidenceId: outcome.evidenceId, duplicate: outcome.evidence === null, kind }
  if (!outcome.task) return base
  return {
    ...base,
    taskStatus: outcome.task.status,
    taskStatusReason: outcome.task.statusReason ?? null,
    taskUpdatedAt: (outcome.task.updatedAt ?? new Date()).toISOString(),
    propagatedTaskIds: outcome.propagated.map((changed) => changed.id),
  }
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
    if (outcome.moved && outcome.task) {
      for (const changed of [outcome.task, ...outcome.propagated]) {
        await emitTaskSideEffects(ctx, 'updated', changed)
        await emitTaskUpdated(changed)
      }
    }
    return toRecordResult(outcome, input.kind)
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
