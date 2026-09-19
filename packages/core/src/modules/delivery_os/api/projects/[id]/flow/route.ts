import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { DeliveryOsFlowQueries } from '@open-mercato/core/modules/delivery_os/commands/flowQueries'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { deliveryFlowErrorBodySchema, flowStatusV1Schema, uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  readRouteId,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const queries = ctx.container.resolve('deliveryOsFlowQueries') as DeliveryOsFlowQueries
    return NextResponse.json(await queries.flowStatus(projectId, scope))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.flow.status')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Project flow status',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'Get the FlowStatus v1 of a project',
      description:
        'F6. Read-only: current stage, per-stage currency, pending approvals, blockers, dispatch/publish gates and the next action, derived from the pinned template snapshot and the append-only stage rows. A project without a pinned template answers `template: null`, an informational `template_not_pinned` blocker and open gates (the v1 gates still apply). An unreadable pinned snapshot fails closed. Archived projects stay readable.',
      responses: [{ status: 200, description: 'FlowStatus v1', schema: flowStatusV1Schema }],
      errors: [
        { status: 403, description: 'Missing feature or signed-in user', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
