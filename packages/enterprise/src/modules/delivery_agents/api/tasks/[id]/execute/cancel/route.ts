import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AttemptCancelResult } from '@open-mercato/core/modules/delivery_os/commands/attempts'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  requireDeliveryFeatures,
  readRouteId,
  resolveDeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { resolveDeliveryScope, parseDeliveryInput } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['delivery_agents.execute', 'delivery_os.attempts.manage'],
  },
}

const cancelBodySchema = z.object({
  attemptId: uuidSchema,
  reason: z.string().max(500).optional(),
})

type RouteParams = { params: { id: string } | Promise<{ id: string }> }

export async function POST(request: Request, context: RouteParams): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_agents.execute', 'delivery_os.attempts.manage'])
    const taskId = await readRouteId(context)
    const body = parseDeliveryInput(cancelBodySchema, await readCappedRouteBody(request, 16_000))
    const outcome = await executeDeliveryCommand<AttemptCancelResult>(ctx, scope, {
      commandId: 'delivery_os.attempts.cancel', body, pathInput: { taskId },
      resourceKind: 'delivery_os.task', resourceId: taskId, operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result)
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_agents.cancel')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Delivery Agents',
  summary: 'Cancel a delivery task execution attempt',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Request cancellation of a running attempt',
      requestBody: { contentType: 'application/json', schema: cancelBodySchema },
      responses: [{ status: 200, description: 'Cancellation requested' }],
      errors: [
        { status: 400, description: 'Invalid body' },
        { status: 403, description: 'Missing required features' },
        { status: 404, description: 'Attempt not found' },
      ],
    },
  },
}
