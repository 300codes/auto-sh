import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { bridgeLegacyGuard, runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import {
  deliveryErrorResponse,
  resolveDeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { startExecution } from '../../../../lib/executionBridge'

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['delivery_agents.execute', 'delivery_os.attempts.manage'],
  },
}

const executeBodySchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  targetProfileId: z.string().uuid().optional(),
})

type RouteParams = { params: { id: string } | Promise<{ id: string }> }

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((f): f is string => typeof f === 'string')
}

export async function POST(request: Request, context: RouteParams): Promise<Response> {
  try {
    const routeCtx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(routeCtx)
    const params = await Promise.resolve(context.params)
    const taskId = uuidSchema.parse(params.id)

    const body = await request.json().catch(() => ({}))
    const parsed = executeBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          code: 'validation_failed',
          details: parsed.error.issues,
        },
        { status: 400 },
      )
    }

    // Wire mutation guard registry
    const legacyGuard = bridgeLegacyGuard(routeCtx.container)
    if (legacyGuard) {
      const guardResult = await runMutationGuards(
        [legacyGuard],
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: (routeCtx.auth as { sub?: string }).sub ?? '',
          resourceKind: 'delivery_os.task',
          resourceId: taskId,
          operation: 'update',
          requestMethod: request.method,
          requestHeaders: request.headers,
          mutationPayload: parsed.data,
        },
        { userFeatures: resolveUserFeatures(routeCtx.auth) },
      )
      if (!guardResult.ok && guardResult.errorBody) {
        return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus ?? 422 })
      }
    }

    const em = (routeCtx.container.resolve('em') as EntityManager).fork()
    const result = await startExecution({
      taskId,
      idempotencyKey: parsed.data.idempotencyKey,
      userId: (routeCtx.auth as { sub?: string }).sub ?? '',
      scope,
      container: routeCtx.container as Parameters<typeof startExecution>[0]['container'],
      em,
      targetProfileId: parsed.data.targetProfileId ?? null,
    })

    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    return deliveryErrorResponse(error, 'delivery_agents.execute')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Delivery Agents',
  summary: 'Execute a delivery task via Cezar',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Start execution of a delivery task',
      requestBody: { contentType: 'application/json', schema: executeBodySchema },
      responses: [
        {
          status: 202,
          description: 'Execution started — attempt reserved and workflow parked',
          schema: z.object({
            attemptId: uuidSchema,
            workflowInstanceId: z.string(),
            state: z.literal('reserved'),
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Missing or invalid body' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing required features' },
        { status: 409, description: 'Idempotency key conflict or task not ready' },
      ],
    },
  },
}
