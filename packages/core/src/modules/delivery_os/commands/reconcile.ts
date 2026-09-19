import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DeliveryProject, DeliveryTask } from '../data/entities'
import { reconcileAttemptCommandSchema } from '../data/validators'
import { findAttempt, parseAttemptRegister, reconcileAttempt, type AttemptRegister } from '../lib/attempts'
import {
  buildDeliveryError,
  uuidSchema,
  type ExecutionAttempt,
  type ReconciliationResolution,
  type TaskStatus,
  type TaskStatusReason,
} from '../lib/contracts'
import {
  canTransition,
  findBlockedAncestors,
  planBlockPropagation,
  planUnblockPropagation,
} from '../lib/taskLifecycle'
import { isIssuedTrustedExecution, readTrustedExecutionOption } from '../lib/trustedExecution'
import { unreadableRegisterError } from './attempts'
import { acceptResultInTransaction, emitResultAccepted, type AcceptOutcome } from './evidence'
import {
  assertDeliveryCheck,
  DELIVERY_TASK_RESOURCE_KIND,
  deliveryHttpError,
  lockScopedProject,
  lockScopedProjectTasks,
  parseDeliveryInput,
  requireActorUserId,
  requireLockHeader,
  requireScopedTask,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'
import { applyPropagation, checkReadyGate, emitTaskSideEffects, emitTaskUpdated, toLifecycleTask } from './tasks'

export type AttemptReconcileResult = {
  taskId: string
  attemptId: string
  resolution: ReconciliationResolution
  taskStatus: TaskStatus
  taskStatusReason: string | null
  taskUpdatedAt: string
  evidenceId?: string
  attempt: ExecutionAttempt
  propagatedTaskIds: string[]
}

type TaskTarget = { status: TaskStatus; statusReason: TaskStatusReason | null }

type ReconcileOutcome = {
  task: DeliveryTask
  attempt: ExecutionAttempt
  propagated: DeliveryTask[]
  accepted: AcceptOutcome | null
}

function resolveActorUserId(rawInput: unknown, ctx: CommandRuntimeContext): string {
  const signedIn = uuidSchema.safeParse(ctx.auth?.sub)
  if (signedIn.success) return signedIn.data
  const trusted = readTrustedExecutionOption(rawInput)
  if (!ctx.request && isIssuedTrustedExecution(trusted)) return trusted.actorUserId
  return requireActorUserId(ctx)
}

function isCorrectionRound(register: AttemptRegister, attemptId: string): boolean {
  return register.some((attempt) => attempt.attemptId !== attemptId && attempt.resultEvidenceId !== null)
}

async function resolveReleaseTarget(
  tx: EntityManager,
  task: DeliveryTask,
  project: DeliveryProject,
  tasks: readonly DeliveryTask[],
  register: AttemptRegister,
  attemptId: string,
  scope: DeliveryScope,
): Promise<TaskTarget> {
  if (isCorrectionRound(register, attemptId)) {
    assertDeliveryCheck(canTransition(task.status, 'changes_requested', { source: 'command', statusReason: null }))
    return { status: 'changes_requested', statusReason: null }
  }
  const readiness = await checkReadyGate(tx, task, project, scope)
  const blockedAncestorIds = findBlockedAncestors(task.id, tasks.map(toLifecycleTask))
  const status: TaskStatus = readiness.ok && blockedAncestorIds.length === 0 ? 'ready' : 'blocked'
  assertDeliveryCheck(canTransition(task.status, status, { source: 'command', statusReason: null, readiness, blockedAncestorIds }))
  return { status, statusReason: blockedAncestorIds.length > 0 ? 'dependency_blocked' : null }
}

function resolveBlockTarget(from: TaskStatus): TaskTarget {
  assertDeliveryCheck(canTransition(from, 'blocked', { source: 'command', statusReason: null }))
  return { status: 'blocked', statusReason: 'reconciliation_required' }
}

function propagateStatusChange(task: DeliveryTask, from: TaskStatus, tasks: readonly DeliveryTask[]): DeliveryTask[] {
  const lifecycle = tasks.map(toLifecycleTask)
  if (task.status === 'blocked' && from !== 'blocked') return applyPropagation(planBlockPropagation(task.id, lifecycle), tasks)
  if (from === 'blocked' && task.status !== 'blocked') return applyPropagation(planUnblockPropagation(task.id, lifecycle), tasks)
  return []
}

function toResult(outcome: ReconcileOutcome, resolution: ReconciliationResolution): AttemptReconcileResult {
  return {
    taskId: outcome.task.id,
    attemptId: outcome.attempt.attemptId,
    resolution,
    taskStatus: outcome.task.status,
    taskStatusReason: outcome.task.statusReason ?? null,
    taskUpdatedAt: (outcome.task.updatedAt ?? new Date()).toISOString(),
    ...(outcome.accepted ? { evidenceId: outcome.accepted.evidenceId } : {}),
    attempt: outcome.attempt,
    propagatedTaskIds: outcome.propagated.map((changed) => changed.id),
  }
}

const reconcileAttemptCommand: CommandHandler<unknown, AttemptReconcileResult> = {
  id: 'delivery_os.attempts.reconcile',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(reconcileAttemptCommandSchema, rawInput)
    const actorUserId = resolveActorUserId(rawInput, ctx)

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx): Promise<ReconcileOutcome> => {
      const found = await requireScopedTask(tx.fork({ keepTransactionContext: true }), parsed.taskId, scope)
      const project = await lockScopedProject(tx, found.projectId, scope)
      const tasks = await lockScopedProjectTasks(tx, project.id, scope)
      const task = tasks.find((candidate) => candidate.id === parsed.taskId)
      if (!task) throw deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path: 'taskId', code: 'not_found' }]))
      if (ctx.request) requireLockHeader(ctx)
      const register = parseAttemptRegister(task.executionAttempts)
      if (!register.ok) throw unreadableRegisterError()
      if (ctx.request) {
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DELIVERY_TASK_RESOURCE_KIND,
          resourceId: task.id,
          current: task.updatedAt,
          request: ctx.request,
          envValue: 'all',
        })
      }

      const reconciled = reconcileAttempt(register.register, {
        attemptId: parsed.attemptId,
        resolution: parsed.resolution,
        note: parsed.externalEvidence.note,
        observedAt: parsed.externalEvidence.observedAt,
        externalRunId: parsed.externalEvidence.externalRunId ?? null,
        actorUserId,
        now: new Date().toISOString(),
      })
      if (!reconciled.ok) throw deliveryHttpError(reconciled)

      const from = task.status
      if (reconciled.taskEffect === 'await_manifest') {
        const accepted = await acceptResultInTransaction(tx, ctx, {
          task,
          scope,
          attemptId: parsed.attemptId,
          manifest: parsed.manifest,
          source: 'manual',
          recordedBy: actorUserId,
          register: reconciled.register,
        })
        const written = parseAttemptRegister(task.executionAttempts)
        const closed = written.ok ? findAttempt(written.register, parsed.attemptId) : undefined
        return { task, attempt: closed ?? reconciled.attempt, propagated: propagateStatusChange(task, from, tasks), accepted }
      }

      const target =
        reconciled.taskEffect === 'block_task'
          ? resolveBlockTarget(from)
          : await resolveReleaseTarget(tx, task, project, tasks, reconciled.register, parsed.attemptId, scope)
      task.executionAttempts = reconciled.register
      task.status = target.status
      task.statusReason = target.statusReason
      return { task, attempt: reconciled.attempt, propagated: propagateStatusChange(task, from, tasks), accepted: null }
    })

    if (outcome.accepted) {
      await emitResultAccepted(ctx, scope, parsed.attemptId, outcome.accepted)
    } else {
      await emitTaskSideEffects(ctx, 'updated', outcome.task)
      await emitTaskUpdated(outcome.task)
    }
    for (const changed of outcome.propagated) {
      await emitTaskSideEffects(ctx, 'updated', changed)
      await emitTaskUpdated(changed)
    }
    return toResult(outcome, parsed.resolution)
  },
  buildLog: async ({ input, result, ctx }) => {
    const scope = resolveDeliveryScope(ctx)
    const parsed = reconcileAttemptCommandSchema.safeParse(input)
    const trusted = readTrustedExecutionOption(input)
    const trustedActorId = !ctx.request && isIssuedTrustedExecution(trusted) ? trusted.actorUserId : undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.attempts.reconcile', 'Reconcile execution attempt'),
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: result.taskId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(trustedActorId ? { actorUserId: trustedActorId } : {}),
      snapshotAfter: { ...result, externalEvidence: parsed.success ? parsed.data.externalEvidence : null },
    }
  },
}

registerCommand(reconcileAttemptCommand)
