import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { DELIVERY_PROJECT_RESOURCE_KIND, parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import type { PlanImportCommandResult } from '@open-mercato/core/modules/delivery_os/commands/planImport'
import type { TaskCommandResult } from '@open-mercato/core/modules/delivery_os/commands/tasks'
import { DeliveryTask } from '@open-mercato/core/modules/delivery_os/data/entities'
import { taskCreateSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readRouteId,
  requireDeliveryFeatures,
  requireProjectIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import {
  deliveryErrorBodySchema,
  optimisticLockConflictSchema,
  planImportResponseSchema,
  taskCreateResponseSchema,
  taskListResponseSchema,
} from '@open-mercato/core/modules/delivery_os/api/schemas'
import { serializeTask } from '@open-mercato/core/modules/delivery_os/api/serializers'

const FEATURE_BY_SOURCE = {
  manual: 'delivery_os.projects.manage',
  plan_proposal: 'delivery_os.results.import',
} as const

const MAX_TASK_BODY_BYTES = 1_000_000

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
    const body = parseDeliveryInput(taskCreateSchema, await readCappedRouteBody(request, MAX_TASK_BODY_BYTES))
    await requireDeliveryFeatures(ctx, scope, [FEATURE_BY_SOURCE[body.source]])
    if (body.source === 'plan_proposal') {
      const imported = await executeDeliveryCommand<PlanImportCommandResult>(ctx, scope, {
        commandId: 'delivery_os.tasks.import_plan',
        body,
        pathInput: { projectId },
        resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
        resourceId: projectId,
        operation: 'custom',
      })
      if (imported.blocked) return imported.blocked
      const { baselineId, version, contentHash, duplicate, tasks, projectUpdatedAt } = imported.result
      return NextResponse.json(
        { baselineId, version, contentHash, duplicate, tasks, projectUpdatedAt },
        { status: duplicate ? 200 : 201 },
      )
    }
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
      summary: 'Create a manual task or import a plan proposal',
      description:
        '`source: manual` needs `delivery_os.projects.manage` and answers `201 { id, updatedAt }`. `source: plan_proposal` needs `delivery_os.results.import` and the project optimistic-lock header: the `PlanProposal v1` manifest must reference the active baseline with requirements and design approved for its hash; one transaction creates the merged baseline (next version, `parentBaselineId`, plan section, frozen AC to test map) and the draft tasks keyed by `proposalTaskKey`. The merged baseline is not activated: it needs both decisions again before its tasks can become `ready`. A replay of the same `manifestId` with the same content answers `200 duplicate: true` with the same ids, writes nothing and needs no current header. `projectUpdatedAt` is the project version to send next.',
      requestBody: { contentType: 'application/json', schema: taskCreateSchema },
      responses: [
        { status: 201, description: 'Task created, or plan imported', schema: z.union([taskCreateResponseSchema, planImportResponseSchema]) },
        { status: 200, description: 'Plan manifest already imported (duplicate)', schema: planImportResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
        { status: 403, description: 'Missing the feature for this source', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema },
        { status: 409, description: 'Stale project version (plan import)', schema: optimisticLockConflictSchema },
        { status: 409, description: '`idempotency_conflict`: the manifestId was imported with different content', schema: deliveryErrorBodySchema },
        { status: 413, description: 'Request body is too large', schema: deliveryErrorBodySchema },
        {
          status: 422,
          description:
            'Cycle, foreign dependency, unknown AC, path not allowed or foreign baseline; plan import also `baseline_not_approved`, `unknown_test_id`, `missing_required_tests`, `duplicate_stable_id`, `unsupported_schema_version`',
          schema: deliveryErrorBodySchema,
        },
        { status: 428, description: 'Project version header missing (plan import)', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
