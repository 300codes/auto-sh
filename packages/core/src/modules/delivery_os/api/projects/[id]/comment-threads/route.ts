import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { DeliveryOsCommentQueries } from '@open-mercato/core/modules/delivery_os/commands/commentQueries'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { deliveryFlowErrorBodySchema, uuidSchema, commentThreadListResponseSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import { deliveryErrorResponse, readRouteId, requireDeliveryFeatures, resolveDeliveryRouteContext, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'

import { commentThreadListQuerySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
export const metadata = { GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] } }
export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.projects.view'])
    const queries = ctx.container.resolve('deliveryOsCommentQueries') as DeliveryOsCommentQueries
    return NextResponse.json(await queries.list(await readRouteId(context), Object.fromEntries(new URL(request.url).searchParams), scope))
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.comments.list') }
}
export const openApi: OpenApiRouteDoc = { tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Scoped comment threads', pathParams: z.object({ id: uuidSchema }), methods: {
 GET: { summary: 'Read filtered, paginated threads and latest reply revisions', query: commentThreadListQuerySchema, responses: [{ status: 200, description: 'Threads', schema: commentThreadListResponseSchema }], errors: [{ status: 403, description: 'Feature required', schema: deliveryFlowErrorBodySchema }, { status: 404, description: 'Not found in scope', schema: deliveryFlowErrorBodySchema }, { status: 409, description: 'Conflict', schema: deliveryFlowErrorBodySchema }, { status: 422, description: 'Invalid reference or input', schema: deliveryFlowErrorBodySchema }] },
} }
