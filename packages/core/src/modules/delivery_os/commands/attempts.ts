import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DeliveryTask } from '../data/entities'
import {
  cancelAttemptCommandSchema,
  claimAttemptCommandSchema,
  linkAttemptWorkflowCommandSchema,
  markAttemptDeliveryCommandSchema,
  reserveAttemptCommandSchema,
  type ReserveAttemptCommandInput,
  type TrustedExecution,
} from '../data/validators'
import {
  claimAttempt,
  linkAttemptWorkflow,
  markAttemptDelivery,
  parseAttemptRegister,
  requestCancellation,
  reserveAttempt,
  type AttemptChangeResult,
  type AttemptRegister,
} from '../lib/attempts'
import {
  buildDeliveryError,
  buildPackageUrl,
  type DeliveryCheckResult,
  type DeliveryErrorDetail,
  type ExecutionAttempt,
  type ReserveAttemptResponse,
  type TaskStatus,
} from '../lib/contracts'
import { canTransition } from '../lib/taskLifecycle'
import { assertRevisionKind, getTargetProfile } from '../lib/targetProfiles'
import { isIssuedTrustedExecution, readTrustedExecutionOption } from '../lib/trustedExecution'
import {
  assertDeliveryCheck,
  DELIVERY_TASK_RESOURCE_KIND,
  deliveryHttpError,
  lockScopedProject,
  lockScopedTask,
  parseDeliveryInput,
  requireLockHeader,
  requireScopedTask,
  resolveDeliveryEm,
  resolveDeliveryScope,
} from './shared'
import { emitTaskSideEffects, emitTaskUpdated, findProjectBaseline, loadCorrectionBudget } from './tasks'

export type AttemptReserveResult = ReserveAttemptResponse & { created: boolean }

type ReservableTask = {
  status: TaskStatus
  statusReason?: string | null
  dependsOnTaskIds: readonly string[]
}

type DependencyState = { id: string; status: TaskStatus }

const RESERVABLE_STATUSES: readonly TaskStatus[] = ['ready', 'changes_requested']

function readIdempotencyKey(rawInput: unknown): unknown {
  return typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>).idempotencyKey : undefined
}

export function requireIdempotencyKey(rawInput: unknown): void {
  const key = readIdempotencyKey(rawInput)
  if (typeof key === 'string' && key.length > 0) return
  throw deliveryHttpError(
    buildDeliveryError('idempotency_key_required', 'The Idempotency-Key header is required', [
      { path: 'idempotencyKey', code: 'idempotency_key_required' },
    ]),
  )
}

export function unreadableRegisterError(): ReturnType<typeof deliveryHttpError> {
  return deliveryHttpError(
    buildDeliveryError('reconciliation_required', 'Reconcile the unknown attempt before continuing', [
      { path: 'executionAttempts', code: 'unreadable_attempt_register' },
    ]),
  )
}

function assertExecutionModeAllowed(parsed: ReserveAttemptCommandInput, rawInput: unknown, ctx: CommandRuntimeContext): void {
  const isTrusted = !ctx.request && isIssuedTrustedExecution(readTrustedExecutionOption(rawInput))
  const isAllowed = parsed.mode === 'automatic' ? isTrusted : parsed.trustedExecution === undefined
  if (isAllowed) return
  throw deliveryHttpError(
    buildDeliveryError('forbidden', 'Automatic execution is reserved for the trusted in-process executor', [
      { path: 'mode', code: 'trusted_execution_required' },
    ]),
  )
}

export function checkTaskReservable(task: ReservableTask, dependencies: readonly DependencyState[]): DeliveryCheckResult {
  if (!RESERVABLE_STATUSES.includes(task.status)) {
    const reason = task.statusReason ? ` (${task.statusReason})` : ''
    return {
      ok: false,
      ...buildDeliveryError('task_not_ready', 'Task is not ready for a new attempt', [
        {
          path: 'status',
          code: task.status === 'blocked' ? 'task_blocked' : 'task_not_ready',
          message: `Task is ${task.status}${reason}; an attempt starts from ready or changes_requested`,
        },
      ]),
    }
  }
  const statusById = new Map(dependencies.map((dependency) => [dependency.id, dependency.status]))
  const details: DeliveryErrorDetail[] = task.dependsOnTaskIds
    .filter((dependencyId) => statusById.get(dependencyId) !== 'verified')
    .map((dependencyId) => ({
      path: `dependsOnTaskIds.${dependencyId}`,
      code: 'dependency_not_verified',
      message: `Dependency is ${statusById.get(dependencyId) ?? 'missing'}`,
    }))
  if (details.length === 0) return { ok: true }
  return { ok: false, ...buildDeliveryError('dependency_not_verified', 'Every dependency must be verified first', details) }
}

function toResult(task: DeliveryTask, attempt: ExecutionAttempt, created: boolean): AttemptReserveResult {
  return {
    created,
    attemptId: attempt.attemptId,
    taskId: task.id,
    baselineId: attempt.baselineId,
    baselineHash: attempt.baselineHash,
    taskUpdatedAt: (task.updatedAt ?? new Date()).toISOString(),
    packageUrl: buildPackageUrl(task.id, attempt.attemptId),
  }
}

const reserveAttemptCommand: CommandHandler<unknown, AttemptReserveResult> = {
  id: 'delivery_os.attempts.reserve',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    requireIdempotencyKey(rawInput)
    const parsed = parseDeliveryInput(reserveAttemptCommandSchema, rawInput)
    assertExecutionModeAllowed(parsed, rawInput, ctx)

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx) => {
      const found = await requireScopedTask(tx.fork({ keepTransactionContext: true }), parsed.taskId, scope)
      const project = await lockScopedProject(tx, found.projectId, scope)
      const task = await lockScopedTask(tx, parsed.taskId, scope)
      const register = parseAttemptRegister(task.executionAttempts)
      if (!register.ok) throw unreadableRegisterError()
      const baseline = await findProjectBaseline(tx, task.baselineId, project.id, scope)
      const reservation = reserveAttempt(register.register, {
        idempotencyKey: parsed.idempotencyKey,
        payload: { mode: parsed.mode, baseRevision: parsed.baseRevision },
        mode: parsed.mode,
        baselineId: task.baselineId,
        baselineHash: baseline?.contentHash ?? '',
        baseRevision: parsed.baseRevision,
        now: new Date().toISOString(),
        newAttemptId: randomUUID(),
      })
      if (reservation.ok && reservation.outcome === 'existing') return { task, attempt: reservation.attempt, created: false }
      if (!reservation.ok && reservation.body.code === 'idempotency_conflict') throw deliveryHttpError(reservation)

      if (ctx.request) {
        requireLockHeader(ctx)
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DELIVERY_TASK_RESOURCE_KIND,
          resourceId: task.id,
          current: task.updatedAt,
          request: ctx.request,
          envValue: 'all',
        })
      }
      if (!reservation.ok && reservation.body.code !== 'validation_failed') throw deliveryHttpError(reservation)

      const dependencies =
        task.dependsOnTaskIds.length === 0
          ? []
          : await findWithDecryption(
              tx,
              DeliveryTask,
              {
                id: { $in: task.dependsOnTaskIds },
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                deletedAt: null,
              },
              undefined,
              scope,
            )
      assertDeliveryCheck(checkTaskReservable(task, dependencies))

      const profile = getTargetProfile(task.targetProfileId, task.targetProfileVersion)
      if (!profile) {
        throw deliveryHttpError(
          buildDeliveryError('unknown_target_profile', 'Unknown target profile', [
            {
              path: 'targetProfileId',
              code: 'unknown_target_profile',
              message: `No profile ${task.targetProfileId} v${task.targetProfileVersion}`,
            },
          ]),
        )
      }
      assertDeliveryCheck(assertRevisionKind(profile, parsed.baseRevision))

      if (!baseline) {
        throw deliveryHttpError(
          buildDeliveryError('foreign_reference', 'Baseline does not belong to this project', [
            { path: 'baselineId', code: 'foreign_baseline' },
          ]),
        )
      }
      if (task.baselineId !== project.activeBaselineId) {
        throw deliveryHttpError(
          buildDeliveryError('baseline_not_active', 'Task baseline is not the active approved baseline', [
            {
              path: 'baselineId',
              code: 'baseline_not_active',
              message: `Active baseline is ${project.activeBaselineId ?? 'not set'}`,
            },
          ]),
        )
      }
      assertDeliveryCheck(
        canTransition(task.status, 'executing', {
          source: 'command',
          currentStatusReason: task.statusReason ?? null,
          correction: await loadCorrectionBudget(tx, task, project, scope),
        }),
      )
      if (!reservation.ok) throw deliveryHttpError(reservation)

      task.executionAttempts = reservation.register
      task.attemptNumber = reservation.register.length
      task.status = 'executing'
      task.statusReason = null
      return { task, attempt: reservation.attempt, created: true }
    })

    if (outcome.created) {
      await emitTaskSideEffects(ctx, 'updated', outcome.task)
      await emitTaskUpdated(outcome.task)
    }
    return toResult(outcome.task, outcome.attempt, outcome.created)
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result.created) return null
    const scope = resolveDeliveryScope(ctx)
    const parsed = reserveAttemptCommandSchema.safeParse(input)
    const trustedActorId = parsed.success ? parsed.data.trustedExecution?.actorUserId : undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.attempts.reserve', 'Reserve execution attempt'),
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: result.taskId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(trustedActorId ? { actorUserId: trustedActorId } : {}),
      snapshotAfter: result,
    }
  },
}

registerCommand(reserveAttemptCommand)

export type AttemptCancelResult = {
  taskId: string
  attemptId: string
  changed: boolean
  state: 'cancel_requested'
  stopConfirmation: 'stop_unconfirmed'
  cancellationRequestedAt: string
  taskStatus: TaskStatus
  taskUpdatedAt: string
  attempt: ExecutionAttempt
}

function toCancelResult(task: DeliveryTask, attempt: ExecutionAttempt, changed: boolean): AttemptCancelResult {
  if (attempt.state !== 'cancel_requested' || attempt.stopConfirmation !== 'stop_unconfirmed' || !attempt.cancellationRequestedAt) {
    throw unreadableRegisterError()
  }
  return {
    taskId: task.id,
    attemptId: attempt.attemptId,
    changed,
    state: attempt.state,
    stopConfirmation: attempt.stopConfirmation,
    cancellationRequestedAt: attempt.cancellationRequestedAt,
    taskStatus: task.status,
    taskUpdatedAt: (task.updatedAt ?? new Date()).toISOString(),
    attempt,
  }
}

const cancelAttemptCommand: CommandHandler<unknown, AttemptCancelResult> = {
  id: 'delivery_os.attempts.cancel',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(cancelAttemptCommandSchema, rawInput)

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx) => {
      const task = await lockScopedTask(tx, parsed.taskId, scope)
      if (ctx.request) requireLockHeader(ctx)
      const register = parseAttemptRegister(task.executionAttempts)
      if (!register.ok) throw unreadableRegisterError()
      const cancellation = requestCancellation(register.register, { attemptId: parsed.attemptId, now: new Date().toISOString() })
      if (cancellation.ok && cancellation.alreadyRequested) return { task, attempt: cancellation.attempt, changed: false }

      if (ctx.request) {
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DELIVERY_TASK_RESOURCE_KIND,
          resourceId: task.id,
          current: task.updatedAt,
          request: ctx.request,
          envValue: 'all',
        })
      }
      if (!cancellation.ok) throw deliveryHttpError(cancellation)
      task.executionAttempts = cancellation.register
      return { task, attempt: cancellation.attempt, changed: true }
    })

    if (outcome.changed) {
      await emitTaskSideEffects(ctx, 'updated', outcome.task)
      await emitTaskUpdated(outcome.task)
    }
    return toCancelResult(outcome.task, outcome.attempt, outcome.changed)
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result.changed) return null
    const scope = resolveDeliveryScope(ctx)
    const parsed = cancelAttemptCommandSchema.safeParse(input)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.attempts.cancel', 'Request execution attempt cancellation'),
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: result.taskId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: { ...result, reason: parsed.success ? (parsed.data.reason ?? null) : null },
    }
  },
}

registerCommand(cancelAttemptCommand)

export type AttemptInternalCommandResult = {
  taskId: string
  attemptId: string
  changed: boolean
  attempt: ExecutionAttempt
  taskUpdatedAt: string
}

type InternalAttemptInput = { taskId: string; attemptId: string; trustedExecution?: TrustedExecution }

type InternalAttemptCommandConfig<TInput extends InternalAttemptInput> = {
  id: string
  schema: z.ZodType<TInput>
  auditKey: string
  auditLabel: string
  apply: (register: AttemptRegister, input: TInput, now: string) => AttemptChangeResult
}

function trustedExecutionRequired(): ReturnType<typeof deliveryHttpError> {
  return deliveryHttpError(
    buildDeliveryError('forbidden', 'This command is reserved for the trusted in-process executor', [
      { path: 'trustedExecution', code: 'trusted_execution_required' },
    ]),
  )
}

function registerInternalAttemptCommand<TInput extends InternalAttemptInput>(config: InternalAttemptCommandConfig<TInput>): void {
  const command: CommandHandler<unknown, AttemptInternalCommandResult> = {
    id: config.id,
    async execute(rawInput, ctx) {
      if (ctx.request || !isIssuedTrustedExecution(readTrustedExecutionOption(rawInput))) throw trustedExecutionRequired()
      const scope = resolveDeliveryScope(ctx)
      const parsed = parseDeliveryInput(config.schema, rawInput)

      const em = resolveDeliveryEm(ctx)
      const outcome = await em.transactional(async (tx) => {
        const task = await lockScopedTask(tx, parsed.taskId, scope)
        const register = parseAttemptRegister(task.executionAttempts)
        if (!register.ok) throw unreadableRegisterError()
        const applied = config.apply(register.register, parsed, new Date().toISOString())
        if (!applied.ok) throw deliveryHttpError(applied)
        if (applied.changed) task.executionAttempts = applied.register
        return { task, attempt: applied.attempt, changed: applied.changed }
      })

      if (outcome.changed) await emitTaskSideEffects(ctx, 'updated', outcome.task)
      return {
        taskId: outcome.task.id,
        attemptId: outcome.attempt.attemptId,
        changed: outcome.changed,
        attempt: outcome.attempt,
        taskUpdatedAt: (outcome.task.updatedAt ?? new Date()).toISOString(),
      }
    },
    buildLog: async ({ input, result, ctx }) => {
      if (!result.changed) return null
      const scope = resolveDeliveryScope(ctx)
      const parsed = config.schema.safeParse(input)
      const trustedActorId = parsed.success ? parsed.data.trustedExecution?.actorUserId : undefined
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate(config.auditKey, config.auditLabel),
        resourceKind: DELIVERY_TASK_RESOURCE_KIND,
        resourceId: result.taskId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ...(trustedActorId ? { actorUserId: trustedActorId } : {}),
        snapshotAfter: result,
      }
    },
  }
  registerCommand(command)
}

registerInternalAttemptCommand({
  id: 'delivery_os.attempts.claim',
  schema: claimAttemptCommandSchema,
  auditKey: 'delivery_os.audit.attempts.claim',
  auditLabel: 'Claim execution attempt',
  apply: (register, input, now) => {
    const claimed = claimAttempt(register, { attemptId: input.attemptId, workerRef: input.workerRef, now })
    if (!claimed.ok) return claimed
    return { ok: true, attempt: claimed.attempt, register: claimed.register, changed: !claimed.alreadyClaimed }
  },
})

registerInternalAttemptCommand({
  id: 'delivery_os.attempts.link_workflow',
  schema: linkAttemptWorkflowCommandSchema,
  auditKey: 'delivery_os.audit.attempts.link_workflow',
  auditLabel: 'Link execution attempt to a workflow',
  apply: (register, input, now) =>
    linkAttemptWorkflow(register, {
      attemptId: input.attemptId,
      workflowRef: input.workflowRef,
      workflowStepId: input.workflowStepId,
      dispatched: input.dispatched,
      now,
    }),
})

registerInternalAttemptCommand({
  id: 'delivery_os.attempts.mark_delivery',
  schema: markAttemptDeliveryCommandSchema,
  auditKey: 'delivery_os.audit.attempts.mark_delivery',
  auditLabel: 'Mark completion delivery',
  apply: (register, input, now) =>
    markAttemptDelivery(register, {
      attemptId: input.attemptId,
      outcome: input.outcome,
      error: input.outcome === 'failed' ? input.error : null,
      now,
    }),
})
