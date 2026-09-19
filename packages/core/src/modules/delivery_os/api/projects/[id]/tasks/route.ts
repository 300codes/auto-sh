import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { DELIVERY_PROJECT_RESOURCE_KIND, parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import type { TaskCommandResult } from '@open-mercato/core/modules/delivery_os/commands/tasks'
import { DeliveryTask } from '@open-mercato/core/modules/delivery_os/data/entities'
import { taskCreateSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readRouteBody,
  readRouteId,
  requireDeliveryFeatures,
  requireProjectIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { deliveryErrorBodySchema, taskCreateResponseSchema, taskListResponseSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { serializeTask } from '@open-mercato/core/modules/delivery_os/api/serializers'

const FEATURE_BY_SOURCE = {
  manual: 'delivery_os.projects.manage',
  plan_proposal: 'delivery_os.results.import',
} as const

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const em = resolveRouteEm(ctx)
    const project = await requireProjectIncludingArchived(em, projectId, scope)
    const tasks = await findWithDecryption(
      em,
      DeliveryTask,
      { projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
      scope,
    )
    const items = tasks.map(serializeTask)
    return NextResponse.json({ items, total: items.length })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.tasks.list')
  }
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const body = parseDeliveryInput(taskCreateSchema, await readRouteBody(request))
    await requireDeliveryFeatures(ctx, scope, [FEATURE_BY_SOURCE[body.source]])
    const outcome = await executeDeliveryCommand<TaskCommandResult>(ctx, scope, {
      commandId: 'delivery_os.tasks.create',
      body,
      pathInput: { projectId },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'create',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json({ id: outcome.result.taskId, updatedAt: outcome.result.updatedAt }, { status: 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.tasks.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Project tasks',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'List the tasks of a project',
      description: 'Live (not archived) tasks, oldest first, each with `updatedAt` and its attempt register.',
      responses: [{ status: 200, description: 'Tasks', schema: taskListResponseSchema }],
      errors: [{ status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema }],
    },
    POST: {
      summary: 'Create a task',
      description:
        '`source: manual` needs `delivery_os.projects.manage`; `source: plan_proposal` needs `delivery_os.results.import` and is not supported yet.',
      requestBody: { contentType: 'application/json', schema: taskCreateSchema },
      responses: [{ status: 201, description: 'Task created', schema: taskCreateResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed or unsupported source', schema: deliveryErrorBodySchema },
        { status: 403, description: 'Missing the feature for this source', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema },
        { status: 422, description: 'Cycle, foreign dependency, unknown AC or foreign baseline', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
