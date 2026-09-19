import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  deliveryErrorResponse,
  readRouteId,
  resolveDeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
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
    const routeCtx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(routeCtx)
    const taskId = await readRouteId(context)

    const body = await request.json().catch(() => ({}))
    const parsed = cancelBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', code: 'validation_failed' }, { status: 400 })
    }

    const commandBus = routeCtx.container.resolve('commandBus') as CommandBus
    const ctx: CommandRuntimeContext = {
      container: routeCtx.container as unknown as CommandRuntimeContext['container'],
      auth: routeCtx.auth,
      organizationScope: routeCtx.organizationScope,
      selectedOrganizationId: routeCtx.selectedOrganizationId,
      organizationIds: routeCtx.organizationIds,
      request,
    }

    const result = await commandBus.execute('delivery_os.attempts.cancel', {
      input: {
        taskId,
        attemptId: parsed.data.attemptId,
        reason: parsed.data.reason ?? null,
      },
      ctx,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
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
