import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { deliveryHttpError, type DeliveryScope } from '../commands/shared'
import { DeliveryProject, DeliveryTask } from '../data/entities'
import { buildDeliveryError, uuidSchema } from '../lib/contracts'

const logger = createLogger('delivery_os')

type RouteParams = { params?: Record<string, unknown> | Promise<Record<string, unknown>> }

type FeatureChecker = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export type DeliveryRouteContext = RouteParams

export type DeliveryCommandCall = {
  commandId: string
  body: Record<string, unknown>
  pathInput: Record<string, string>
  resourceKind: string
  resourceId: string
  operation: 'create' | 'custom'
}

export type DeliveryCommandOutcome<TResult> = { blocked: Response } | { blocked: null; result: TResult }

export async function resolveDeliveryRouteContext(request: Request): Promise<CommandRuntimeContext> {
  const rawAuth = await getAuthFromRequest(request)
  if (!rawAuth || !rawAuth.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth: rawAuth, request }).catch(() => null)
  if (scope?.selectionRejected) {
    throw new CrudHttpError(422, {
      error: 'Your selected organization is no longer available. Please re-select an organization and try again.',
      code: 'organization_selection_invalid',
    })
  }
  const organizationId = scope ? (scope.selectedId ?? null) : (rawAuth.orgId ?? null)
  const filterIds = scope?.filterIds?.filter((id) => typeof id === 'string' && id.length > 0) ?? null
  return {
    container,
    auth: { ...rawAuth, tenantId: scope?.tenantId ?? rawAuth.tenantId, orgId: organizationId },
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: filterIds && filterIds.length > 0 ? filterIds : organizationId ? [organizationId] : null,
    request,
  }
}

function forbiddenFeatureError(features: readonly string[]): CrudHttpError {
  return deliveryHttpError(
    buildDeliveryError(
      'forbidden',
      'Missing required features',
      features.map((feature) => ({ path: 'features', code: 'feature_required', message: feature })),
    ),
  )
}

export async function requireDeliveryFeatures(
  ctx: CommandRuntimeContext,
  scope: DeliveryScope,
  features: string[],
): Promise<void> {
  const userId = ctx.auth?.sub
  if (!userId) throw forbiddenFeatureError(features)
  let granted = false
  try {
    const rbac = ctx.container.resolve('rbacService') as FeatureChecker
    granted = (await rbac.userHasAllFeatures(userId, features, scope)) === true
  } catch (error) {
    logger.warn('feature check failed closed', { features, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.feature_check_failed' })
  }
  if (!granted) throw forbiddenFeatureError(features)
}

export async function readRouteId(context: RouteParams, key: string = 'id'): Promise<string> {
  const params = (await context.params) ?? {}
  const parsed = uuidSchema.safeParse(params[key])
  if (parsed.success) return parsed.data
  throw deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path: key, code: 'not_found' }]))
}

export async function readRouteBody(request: Request): Promise<Record<string, unknown>> {
  const body = await readJsonSafe<unknown>(request, {})
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

export function resolveRouteEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

export async function requireProjectIncludingArchived(
  em: EntityManager,
  id: string,
  scope: DeliveryScope,
): Promise<DeliveryProject> {
  const project = await findOneWithDecryption(
    em,
    DeliveryProject,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  if (project) return project
  throw deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path: 'projectId', code: 'not_found' }]))
}

export async function requireTaskIncludingArchived(
  em: EntityManager,
  id: string,
  scope: DeliveryScope,
): Promise<DeliveryTask> {
  const task = await findOneWithDecryption(
    em,
    DeliveryTask,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  if (task) return task
  throw deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path: 'taskId', code: 'not_found' }]))
}

export async function executeDeliveryCommand<TResult>(
  ctx: CommandRuntimeContext,
  scope: DeliveryScope,
  call: DeliveryCommandCall,
): Promise<DeliveryCommandOutcome<TResult>> {
  const request = ctx.request
  const userId = ctx.auth?.sub
  if (!request || !userId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const guard = await runRouteMutationGuards({
    container: ctx.container,
    req: request,
    auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: call.resourceKind,
      resourceId: call.resourceId,
      operation: call.operation,
      mutationPayload: { ...call.body, ...call.pathInput },
    },
  })
  if (!guard.ok) return { blocked: guard.response }
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const { result } = await commandBus.execute<Record<string, unknown>, TResult>(call.commandId, {
    input: { ...call.body, ...(guard.modifiedPayload ?? {}), ...call.pathInput },
    ctx,
  })
  await guard.runAfterSuccess()
  return { blocked: null, result }
}

export function deliveryErrorResponse(error: unknown, routeId: string): Response {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  const rejection = getCommandInterceptorHttpRejection(error)
  if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
  logger.error('delivery_os route failed', { route: routeId, err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.route_failed', attributes: { route: routeId } })
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
