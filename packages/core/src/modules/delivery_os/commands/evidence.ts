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
import { DeliveryEvidence, type DeliveryProject, type DeliveryTask } from '../data/entities'
import { acceptResultCommandSchema, type AcceptResultCommandInput } from '../data/validators'
import { findAttempt, parseAttemptRegister, recordAttemptResult } from '../lib/attempts'
import { buildDeliveryError, uuidSchema, type ExecutionAttempt, type TaskStatus } from '../lib/contracts'
import { evaluateResultAcceptance } from '../lib/resultAcceptance'
import { canTransition } from '../lib/taskLifecycle'
import { getTargetProfile } from '../lib/targetProfiles'
import { buildTaskPackageV1, type TaskPackageResult } from '../lib/taskPackage'
import { emitDeliveryOsEvent } from '../events'
import {
  assertDeliveryCheck,
  DELIVERY_EVIDENCE_RESOURCE_KIND,
  DELIVERY_TASK_RESOURCE_KIND,
  deliveryHttpError,
  lockScopedTask,
  parseDeliveryInput,
  requireScopedProject,
  requireScopedTask,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'
import { emitTaskSideEffects, emitTaskUpdated, findProjectBaseline } from './tasks'

export type ResultAcceptCommandResult = {
  evidenceId: string
  duplicate: boolean
  taskStatus: TaskStatus
  taskUpdatedAt: string
}

type CompletionDelivery = ExecutionAttempt['completionDelivery']

type AcceptOutcome = {
  task: DeliveryTask
  evidenceId: string
  evidence: DeliveryEvidence | null
  completionDelivery: CompletionDelivery
}

const RESULT_MANIFEST_UNIQUE_INDEX = 'delivery_evidence_result_manifest_uq'

const evidenceCrudIndexer: CrudIndexerConfig<DeliveryEvidence> = {
  entityType: E.delivery_os.delivery_evidence,
}

function assertSourceAllowed(parsed: AcceptResultCommandInput, ctx: CommandRuntimeContext): void {
  if (parsed.source === 'manual' || !ctx.request) return
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

async function buildResultPackage(
  tx: EntityManager,
  task: DeliveryTask,
  project: DeliveryProject,
  attempt: ExecutionAttempt | undefined,
  scope: DeliveryScope,
): Promise<TaskPackageResult> {
  const baseline = await findProjectBaseline(tx, task.baselineId, project.id, scope)
  if (!baseline) {
    return {
      ok: false,
      ...buildDeliveryError('foreign_reference', 'Baseline does not belong to this project', [
        { path: 'baselineId', code: 'foreign_baseline' },
      ]),
    }
  }
  const profile = getTargetProfile(task.targetProfileId, task.targetProfileVersion)
  if (!profile) {
    return {
      ok: false,
      ...buildDeliveryError('unknown_target_profile', 'Unknown target profile', [
        { path: 'targetProfileId', code: 'unknown_target_profile' },
      ]),
    }
  }
  return buildTaskPackageV1(
    {
      project: { id: project.id, repositoryRef: project.repositoryRef ?? null, limits: project.limits },
      task,
      baseline,
      attempt,
      profile,
    },
    { attemptGate: 'none' },
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

const acceptResultCommand: CommandHandler<unknown, ResultAcceptCommandResult> = {
  id: 'delivery_os.results.accept',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(acceptResultCommandSchema, rawInput)
    assertSourceAllowed(parsed, ctx)
    const recordedBy = uuidSchema.safeParse(ctx.auth?.sub)

    const evaluated = { manifestHash: null as string | null }
    const em = resolveDeliveryEm(ctx)
    let outcome: AcceptOutcome
    try {
      outcome = await em.transactional(async (tx): Promise<AcceptOutcome> => {
        const task = await lockScopedTask(tx, parsed.taskId, scope)
        const project = await requireScopedProject(tx, task.projectId, scope)
        const register = readAttemptRegister(task)
        const attempt = findAttempt(register, parsed.attemptId)
        const taskPackage = await buildResultPackage(tx, task, project, attempt, scope)
        const existing = attempt ? await findResultEvidence(tx, task.id, attempt.attemptId, scope) : null

        const evaluation = evaluateResultAcceptance({
          manifestRaw: parsed.manifest,
          task,
          attempt,
          taskPackage,
          existingResult: existing ? { evidenceId: existing.id, payloadHash: existing.payloadHash } : null,
        })
        if (!evaluation.ok) throw deliveryHttpError(evaluation)
        evaluated.manifestHash = evaluation.manifestHash
        if (evaluation.outcome === 'duplicate') {
          return { task, evidenceId: evaluation.evidenceId, evidence: null, completionDelivery: attempt?.completionDelivery ?? null }
        }

        assertDeliveryCheck(
          canTransition(task.status, 'awaiting_review', { source: 'command', statusReason: task.statusReason ?? null }),
        )
        const evidenceId = randomUUID()
        const recorded = recordAttemptResult(register, {
          attemptId: parsed.attemptId,
          evidenceId,
          externalRunId: evaluation.manifest.externalRunId,
        })
        if (!recorded.ok) throw deliveryHttpError(recorded)

        const evidence = tx.create(DeliveryEvidence, {
          id: evidenceId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          baselineId: task.baselineId,
          taskId: task.id,
          attemptId: parsed.attemptId,
          kind: 'result_manifest',
          source: parsed.source,
          sourceRevision: evaluation.manifest.resultRevision,
          payload: evaluation.manifest,
          payloadHash: evaluation.manifestHash,
          rawReportHash: null,
          attachmentIds: [],
          recordedBy: recordedBy.success ? recordedBy.data : null,
        })
        tx.persist(evidence)
        task.executionAttempts = recorded.register
        task.status = 'awaiting_review'
        task.statusReason = null
        return { task, evidenceId, evidence, completionDelivery: recorded.attempt.completionDelivery }
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

    await emitDeliveryOsEvent(
      'delivery_os.evidence.recorded',
      {
        projectId: outcome.task.projectId,
        taskId: outcome.task.id,
        attemptId: parsed.attemptId,
        evidenceId: outcome.evidenceId,
        kind: 'result_manifest',
        duplicate: outcome.evidence === null,
        completionDelivery: outcome.completionDelivery,
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
      await emitTaskSideEffects(ctx, 'updated', outcome.task)
      await emitTaskUpdated(outcome.task)
    }
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
