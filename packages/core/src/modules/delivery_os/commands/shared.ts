import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
  readOptimisticLockExpected,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { normalizeIsoToken } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryBaseline, DeliveryIntake, DeliveryProject, DeliveryTask } from '../data/entities'
import {
  buildDeliveryError,
  deliveryErrorFromZod,
  type DeliveryCheckResult,
  type DeliveryErrorResult,
  type DeliveryFlowErrorResult,
  uuidSchema,
} from '../lib/contracts'

export const DELIVERY_PROJECT_RESOURCE_KIND = 'delivery_os.project'
export const DELIVERY_TASK_RESOURCE_KIND = 'delivery_os.task'
export const DELIVERY_BASELINE_RESOURCE_KIND = 'delivery_os.baseline'
export const DELIVERY_DECISION_RESOURCE_KIND = 'delivery_os.decision'
export const DELIVERY_EVIDENCE_RESOURCE_KIND = 'delivery_os.evidence'
export const DELIVERY_INTAKE_RESOURCE_KIND = 'delivery_os.intake'

export type DeliveryScope = {
  tenantId: string
  organizationId: string
}

type ScopedLoadOptions = { lock?: boolean }

type ProjectWriteLockOptions = { force?: boolean }

export function deliveryHttpError(failure: DeliveryErrorResult): CrudHttpError {
  const httpError = new CrudHttpError(failure.status, failure.body)
  httpError.message = `[internal] delivery_os ${failure.body.code}: ${failure.body.error}`
  return httpError
}

export function assertDeliveryCheck(result: DeliveryCheckResult): void {
  if (result.ok) return
  throw deliveryHttpError({ status: result.status, body: result.body })
}

export function deliveryFlowHttpError(failure: DeliveryFlowErrorResult): CrudHttpError {
  const httpError = new CrudHttpError(failure.status, failure.body)
  httpError.message = `[internal] delivery_os ${failure.body.code}: ${failure.body.error}`
  return httpError
}

export function parseDeliveryInput<TSchema extends z.ZodType>(schema: TSchema, rawInput: unknown): z.infer<TSchema> {
  const parsed = schema.safeParse(rawInput)
  if (!parsed.success) throw deliveryHttpError(deliveryErrorFromZod(parsed.error))
  return parsed.data
}

function forbiddenScopeError(detailCode: string): CrudHttpError {
  return deliveryHttpError(
    buildDeliveryError('forbidden', 'Tenant and organization scope are required', [{ code: detailCode }]),
  )
}

export function resolveDeliveryScope(ctx: CommandRuntimeContext): DeliveryScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const selectedOrganizationId = ctx.organizationScope ? ctx.selectedOrganizationId : null
  const organizationId = selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw forbiddenScopeError('scope_required')
  try {
    ensureTenantScope(ctx, tenantId)
    ensureOrganizationScope(ctx, organizationId)
  } catch (error) {
    if (isCrudHttpError(error) && error.status === 403) throw forbiddenScopeError('scope_not_allowed')
    throw error
  }
  return { tenantId, organizationId }
}

export function requireLockHeader(ctx: CommandRuntimeContext): string {
  const expected = readOptimisticLockExpected(ctx.request ?? null)
  if (!expected) {
    throw deliveryHttpError(
      buildDeliveryError('optimistic_lock_required', 'The project version header is required', [
        { path: 'headers', code: 'optimistic_lock_required' },
      ]),
    )
  }
  const normalized = normalizeIsoToken(expected)
  if (normalized) return normalized
  throw deliveryHttpError(
    buildDeliveryError('validation_failed', 'The project version header is not a timestamp', [
      { path: 'headers', code: 'optimistic_lock_invalid' },
    ]),
  )
}

export function requireActorUserId(ctx: CommandRuntimeContext): string {
  const parsed = uuidSchema.safeParse(ctx.auth?.sub)
  if (parsed.success) return parsed.data
  throw deliveryHttpError(
    buildDeliveryError('forbidden', 'A signed-in user is required', [{ path: 'actorUserId', code: 'actor_required' }]),
  )
}

export function resolveDeliveryEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function notFoundError(path: string): CrudHttpError {
  return deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path, code: 'not_found' }]))
}

function lockOptions(options: ScopedLoadOptions): { lockMode: LockMode.PESSIMISTIC_WRITE } | undefined {
  return options.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined
}

export async function findScopedProject(
  em: EntityManager,
  id: string,
  scope: DeliveryScope,
  options: ScopedLoadOptions = {},
): Promise<DeliveryProject | null> {
  return findOneWithDecryption(
    em,
    DeliveryProject,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    lockOptions(options),
    scope,
  )
}

export async function requireScopedProject(
  em: EntityManager,
  id: string,
  scope: DeliveryScope,
  options: ScopedLoadOptions = {},
): Promise<DeliveryProject> {
  const project = await findScopedProject(em, id, scope, options)
  if (!project) throw notFoundError('projectId')
  return project
}

export async function requireScopedTask(
  em: EntityManager,
  id: string,
  scope: DeliveryScope,
  options: ScopedLoadOptions = {},
): Promise<DeliveryTask> {
  const task = await findOneWithDecryption(
    em,
    DeliveryTask,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    lockOptions(options),
    scope,
  )
  if (!task) throw notFoundError('taskId')
  return task
}

export async function findScopedBaseline(
  em: EntityManager,
  id: string,
  scope: DeliveryScope,
): Promise<DeliveryBaseline | null> {
  return findOneWithDecryption(
    em,
    DeliveryBaseline,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

export async function requireScopedBaseline(
  em: EntityManager,
  id: string,
  scope: DeliveryScope,
): Promise<DeliveryBaseline> {
  const baseline = await findScopedBaseline(em, id, scope)
  if (!baseline) throw notFoundError('baselineId')
  return baseline
}

export async function findScopedIntake(
  em: EntityManager,
  projectId: string,
  scope: DeliveryScope,
  options: ScopedLoadOptions = {},
): Promise<DeliveryIntake | null> {
  return findOneWithDecryption(
    em,
    DeliveryIntake,
    { projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    lockOptions(options),
    scope,
  )
}

export function lockScopedProject(tx: EntityManager, id: string, scope: DeliveryScope): Promise<DeliveryProject> {
  return requireScopedProject(tx, id, scope, { lock: true })
}

export function lockScopedTask(tx: EntityManager, id: string, scope: DeliveryScope): Promise<DeliveryTask> {
  return requireScopedTask(tx, id, scope, { lock: true })
}

export async function lockProjectForWrite(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
  scope: DeliveryScope,
  options: ProjectWriteLockOptions = {},
): Promise<DeliveryProject> {
  const envValue = options.force ? 'all' : undefined
  const project = await findScopedProject(tx, id, scope, { lock: true })
  if (!project) {
    enforceRecordGoneIsConflict({
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: id,
      request: ctx.request ?? null,
      envValue,
    })
    throw notFoundError('projectId')
  }
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
    resourceId: project.id,
    current: project.updatedAt,
    request: ctx.request ?? null,
    envValue,
  })
  return project
}

export async function lockScopedProjectTasks(
  tx: EntityManager,
  projectId: string,
  scope: DeliveryScope,
): Promise<DeliveryTask[]> {
  return findWithDecryption(
    tx,
    DeliveryTask,
    { projectId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } },
    scope,
  )
}

export type LockedTaskForWrite = {
  project: DeliveryProject
  tasks: DeliveryTask[]
  task: DeliveryTask
}

export async function lockTaskForWrite(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
  scope: DeliveryScope,
): Promise<LockedTaskForWrite> {
  const found = await findOneWithDecryption(
    tx.fork({ keepTransactionContext: true }),
    DeliveryTask,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  const project = found ? await findScopedProject(tx, found.projectId, scope, { lock: true }) : null
  const tasks = project ? await lockScopedProjectTasks(tx, project.id, scope) : []
  const task = tasks.find((candidate) => candidate.id === id)
  if (!project || !task) {
    enforceRecordGoneIsConflict({ resourceKind: DELIVERY_TASK_RESOURCE_KIND, resourceId: id, request: ctx.request ?? null })
    throw notFoundError('taskId')
  }
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: DELIVERY_TASK_RESOURCE_KIND,
    resourceId: task.id,
    current: task.updatedAt,
    request: ctx.request ?? null,
  })
  return { project, tasks, task }
}
