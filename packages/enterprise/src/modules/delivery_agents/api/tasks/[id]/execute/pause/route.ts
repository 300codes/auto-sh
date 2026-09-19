import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  deliveryErrorResponse,
  resolveDeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'

const logger = createLogger('delivery_agents').child({ route: 'execute/pause' })

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['delivery_agents.execute', 'delivery_os.attempts.manage'],
  },
}

const pauseBodySchema = z.object({
  instanceId: z.string().uuid(),
})

type RouteParams = { params: { id: string } | Promise<{ id: string }> }

type WorkflowExecutorLike = {
  pauseWorkflow?: (em: EntityManager, instanceId: string) => Promise<unknown>
}

export async function POST(request: Request, context: RouteParams): Promise<Response> {
  try {
    const routeCtx = await resolveDeliveryRouteContext(request)
    resolveDeliveryScope(routeCtx)
    await Promise.resolve(context.params)

    const body = await request.json().catch(() => ({}))
    const parsed = pauseBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', code: 'validation_failed' }, { status: 400 })
    }

    let workflowExecutor: WorkflowExecutorLike | null = null
    try {
      workflowExecutor = routeCtx.container.resolve('workflowExecutor') as WorkflowExecutorLike
    } catch {
      workflowExecutor = null
    }

    if (!workflowExecutor?.pauseWorkflow) {
      logger.warn('workflowExecutor.pauseWorkflow unavailable', { instanceId: parsed.data.instanceId })
      return NextResponse.json(
        { error: 'Pause not available in this configuration', code: 'not_implemented' },
        { status: 501 },
      )
    }

    const em = (routeCtx.container.resolve('em') as EntityManager).fork()
    await workflowExecutor.pauseWorkflow(em, parsed.data.instanceId)

    return NextResponse.json({ paused: true, instanceId: parsed.data.instanceId }, { status: 200 })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    return deliveryErrorResponse(error, 'delivery_agents.pause')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Delivery Agents',
  summary: 'Pause a running attempt workflow',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Pause the workflow instance for an attempt',
      requestBody: { contentType: 'application/json', schema: pauseBodySchema },
      responses: [{ status: 200, description: 'Workflow paused' }],
      errors: [
        { status: 400, description: 'Invalid body' },
        { status: 403, description: 'Missing required features' },
        { status: 501, description: 'Pause not available' },
      ],
    },
  },
}
