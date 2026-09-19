import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '../../openapi'
import {
  deliveryErrorResponse,
  readRouteId,
  requireTaskIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '../../routeSupport'
import { deliveryErrorBodySchema, taskDtoSchema } from '../../schemas'
import { serializeTask } from '../../serializers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const taskId = await readRouteId(context)
    const task = await requireTaskIncludingArchived(resolveRouteEm(ctx), taskId, scope)
    return NextResponse.json(serializeTask(task))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.tasks.detail')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Delivery task detail',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'Get a delivery task',
      description: 'Returns the task with `updatedAt` and its execution-attempt register. Archived tasks stay readable.',
      responses: [{ status: 200, description: 'Task detail', schema: taskDtoSchema }],
      errors: [{ status: 404, description: 'Task not found in this scope', schema: deliveryErrorBodySchema }],
    },
  },
}
