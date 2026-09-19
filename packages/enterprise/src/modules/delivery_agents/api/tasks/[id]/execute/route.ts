import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  requireDeliveryFeatures,
  readCappedRouteBody,
  readRouteId,
  resolveDeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { resolveDeliveryScope, parseDeliveryInput } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { uuidSchema, sourceRevisionSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { ExecutionBridgeStartResult } from '../../../../lib/executionBridge'

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['delivery_agents.execute', 'delivery_os.attempts.manage'],
  },
}

const executeBodySchema = z.object({
  baseRevision: sourceRevisionSchema.optional(),
  idempotencyKey: z.string().min(1).max(200),
  targetProfileId: z.string().uuid().optional(),
})

type RouteParams = { params: { id: string } | Promise<{ id: string }> }

export async function POST(request: Request, context: RouteParams): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_agents.execute', 'delivery_os.attempts.manage'])
    const taskId = await readRouteId(context)
    const body = parseDeliveryInput(executeBodySchema, await readCappedRouteBody(request, 16_000))
    const outcome = await executeDeliveryCommand<ExecutionBridgeStartResult>(ctx, scope, {
      commandId: 'delivery_agents.executions.trigger', body, pathInput: { taskId },
      resourceKind: 'delivery_os.task', resourceId: taskId, operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: 202 })
  } catch (error) {
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
