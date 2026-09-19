import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { hasFeature } from '@open-mercato/shared/security/features'
import { DeliveryCommentThread, DeliveryStaffLink } from '../data/entities'
import { staffLinkCommandSchema, type StaffLinkCommandInput } from '../data/validators'
import { buildDeliveryError, buildDeliveryFlowError, staffLinkSchema, type StaffLink } from '../lib/contracts'
import {
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

export const DELIVERY_STAFF_LINK_RESOURCE_KIND = 'delivery_os.staff_link'
export const STAFF_ACCESS_RESOLVER_KEY = 'timeTrackingAccessResolver'
export const STAFF_MANAGE_ALL_FEATURE = 'staff.timesheets.projects.manage'
export const STAFF_TIME_PROJECT_ENTITY_ID = 'staff:staff_time_project'

export type StaffLinkCommandResult = StaffLink & { unchanged: boolean }

type StaffProjectAccess = { canManageAll: boolean; projectIds: string[] }

type StaffAccessResolver = {
  resolveProjectAccess(ctx: {
    em: EntityManager
    userId: string
    tenantId: string
    organizationId: string
    userFeatures: readonly string[]
    canManageAll: boolean
  }): Promise<StaffProjectAccess>
}

type StaffProjectProbe = {
  query(entity: string, options: { fields: string[]; filters: Record<string, unknown>; page: { page: number; pageSize: number }; tenantId: string; organizationId: string }): Promise<{ items?: unknown[] }>
}

type FeatureGrantReader = {
  getGrantedFeatures(userId: string, scope: { tenantId: string | null; organizationId: string | null }): Promise<string[]>
}

const logger = createLogger('delivery_os')

function tryResolveStaffAccess(ctx: CommandRuntimeContext): StaffAccessResolver | null {
  try {
    const resolved = ctx.container.resolve(STAFF_ACCESS_RESOLVER_KEY) as Partial<StaffAccessResolver> | undefined
    return resolved && typeof resolved.resolveProjectAccess === 'function' ? (resolved as StaffAccessResolver) : null
  } catch {
    return null
  }
}

function staffLinkRequired(): ReturnType<typeof deliveryFlowHttpError> {
  return deliveryFlowHttpError(
    buildDeliveryFlowError('staff_link_required', 'The staff time-tracking module is not available', [
      { path: 'staffProjectId', code: 'staff_module_unavailable' },
    ]),
  )
}

function staffProjectNotFound(): ReturnType<typeof deliveryHttpError> {
  return deliveryHttpError(buildDeliveryError('not_found', 'Staff project not found', [{ path: 'staffProjectId', code: 'not_found' }]))
}

function linkConflict(detailCode: 'staff_link_in_use' | 'staff_project_already_linked', message: string): ReturnType<typeof deliveryHttpError> {
  return deliveryHttpError(buildDeliveryError('invalid_transition', message, [{ path: 'staffProjectId', code: detailCode }]))
}

/** Wildcard-aware and fail closed: a failing RBAC lookup grants nothing, so only an explicit membership can pass. */
async function resolveGrantedFeatures(ctx: CommandRuntimeContext, scope: DeliveryScope, userId: string): Promise<string[]> {
  try {
    const rbac = ctx.container.resolve('rbacService') as FeatureGrantReader
    const granted = await rbac.getGrantedFeatures(userId, scope)
    return Array.isArray(granted) ? granted.filter((feature): feature is string => typeof feature === 'string') : []
  } catch (error) {
    logger.warn('staff link feature lookup failed closed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.feature_check_failed' })
    return []
  }
}

/**
 * The staff project id is accepted only when the caller reaches it through the staff module's own access resolver.
 * A foreign, deleted or inaccessible id answers the same `404 not_found`, so the route is no existence oracle.
 */
async function assertStaffProjectAccess(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: DeliveryScope,
  userId: string,
  staffProjectId: string,
): Promise<void> {
  const resolver = tryResolveStaffAccess(ctx)
  if (!resolver) throw staffLinkRequired()
  const userFeatures = await resolveGrantedFeatures(ctx, scope, userId)
  let access: StaffProjectAccess
  try {
    access = await resolver.resolveProjectAccess({
      em,
      userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userFeatures,
      canManageAll: hasFeature(userFeatures, STAFF_MANAGE_ALL_FEATURE),
    })
  } catch (error) {
    logger.warn('staff project access lookup failed closed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.staff_access_failed' })
    throw staffProjectNotFound()
  }
  const reachable = access?.canManageAll === true || (Array.isArray(access?.projectIds) && access.projectIds.includes(staffProjectId))
  if (reachable && (await staffProjectExists(ctx, scope, staffProjectId))) return
  throw staffProjectNotFound()
}

/**
 * `canManageAll` means unrestricted, so the resolver lists no ids, and a membership can outlive its soft-deleted project:
 * the id is always probed through the query engine, scoped to the caller's tenant and organization (soft-deleted rows
 * excluded). An unavailable probe fails closed.
 */
async function staffProjectExists(ctx: CommandRuntimeContext, scope: DeliveryScope, staffProjectId: string): Promise<boolean> {
  try {
    const probe = ctx.container.resolve('queryEngine') as StaffProjectProbe
    const result = await probe.query(STAFF_TIME_PROJECT_ENTITY_ID, {
      fields: ['id'],
      filters: { id: { $eq: staffProjectId } },
      page: { page: 1, pageSize: 1 },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return Array.isArray(result?.items) && result.items.length > 0
  } catch (error) {
    logger.warn('staff project existence probe failed closed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.staff_access_failed' })
    return false
  }
}

export function loadStaffLink(em: EntityManager, projectId: string, scope: DeliveryScope, lock = false): Promise<DeliveryStaffLink | null> {
  return findOneWithDecryption(
    em,
    DeliveryStaffLink,
    { projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    scope,
  )
}

export function toStaffLink(row: DeliveryStaffLink): StaffLink {
  return staffLinkSchema.parse({
    projectId: row.projectId,
    staffProjectId: row.staffProjectId,
    linkedBy: row.linkedBy,
    linkedAt: row.linkedAt.toISOString(),
    syncCursors: row.syncCursors ?? {},
    updatedAt: row.updatedAt.toISOString(),
  })
}

async function assertRelinkAllowed(tx: EntityManager, projectId: string, staffProjectId: string, scope: DeliveryScope): Promise<void> {
  const carded = await findOneWithDecryption(
    tx,
    DeliveryCommentThread,
    { projectId, tenantId: scope.tenantId, organizationId: scope.organizationId, staffTaskId: { $ne: null } },
    undefined,
    scope,
  )
  if (carded) throw linkConflict('staff_link_in_use', 'Imported comment cards already live in the linked staff project')
  await assertStaffProjectFree(tx, projectId, staffProjectId, scope)
}

async function assertStaffProjectFree(tx: EntityManager, projectId: string, staffProjectId: string, scope: DeliveryScope): Promise<void> {
  const taken = await findOneWithDecryption(
    tx,
    DeliveryStaffLink,
    { staffProjectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  if (taken && taken.projectId !== projectId) throw linkConflict('staff_project_already_linked', 'The staff project is linked to another delivery project')
}

const linkStaffCommand: CommandHandler<StaffLinkCommandInput, StaffLinkCommandResult> = {
  id: 'delivery_os.staff.link',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(staffLinkCommandSchema, rawInput)
    const actor = requireActorUserId(ctx)

    const probeEm = resolveDeliveryEm(ctx)
    await requireScopedProject(probeEm, parsed.projectId, scope)
    await assertStaffProjectAccess(ctx, probeEm, scope, actor, parsed.staffProjectId)
    const probe = await loadStaffLink(probeEm, parsed.projectId, scope)
    if (probe && probe.staffProjectId === parsed.staffProjectId) return { ...toStaffLink(probe), unchanged: true }
    requireLockHeader(ctx)

    const em = resolveDeliveryEm(ctx)
    try {
      return await em.transactional(async (tx) => {
        const project = await lockScopedProject(tx, parsed.projectId, scope)
        const existing = await loadStaffLink(tx, project.id, scope, true)
        if (existing && existing.staffProjectId === parsed.staffProjectId) return { ...toStaffLink(existing), unchanged: true }
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
          resourceId: project.id,
          current: project.updatedAt,
          request: ctx.request ?? null,
        })
        const now = new Date()
        if (existing) {
          await assertRelinkAllowed(tx, project.id, parsed.staffProjectId, scope)
          existing.staffProjectId = parsed.staffProjectId
          existing.linkedBy = actor
          existing.linkedAt = now
          existing.syncCursors = {}
          existing.updatedAt = now
          project.updatedAt = now
          return { ...toStaffLink(existing), unchanged: false }
        }
        await assertStaffProjectFree(tx, project.id, parsed.staffProjectId, scope)
        const row = tx.create(DeliveryStaffLink, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          staffProjectId: parsed.staffProjectId,
          linkedBy: actor,
          linkedAt: now,
          syncCursors: {},
          createdAt: now,
          updatedAt: now,
        })
        tx.persist(row)
        project.updatedAt = now
        return { ...toStaffLink(row), unchanged: false }
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const winner = await loadStaffLink(resolveDeliveryEm(ctx), parsed.projectId, scope)
      if (winner && winner.staffProjectId === parsed.staffProjectId) return { ...toStaffLink(winner), unchanged: true }
      throw linkConflict('staff_project_already_linked', 'The staff project is linked to another delivery project')
    }
  },
  buildLog: async ({ result, ctx }) => {
    if (result.unchanged) return null
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.staff.link', 'Link delivery project to a staff project'),
      resourceKind: DELIVERY_STAFF_LINK_RESOURCE_KIND,
      resourceId: result.projectId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: { projectId: result.projectId, staffProjectId: result.staffProjectId, linkedBy: result.linkedBy, linkedAt: result.linkedAt },
    }
  },
}

registerCommand(linkStaffCommand)
