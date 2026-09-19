import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { DeliveryOsFlowQueries } from '../../commands/flowQueries'
import { parseDeliveryInput, resolveDeliveryScope } from '../../commands/shared'
import { flowStatusV1Schema, uuidSchema } from '../../lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '../openapi'
import { deliveryErrorResponse, requireDeliveryFeatures, resolveDeliveryRouteContext } from '../routeSupport'
const querySchema = z.object({ ids: z.string().transform((value) => value.split(',')).pipe(z.array(uuidSchema).min(1).max(50)) })
export const metadata = { GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] } }
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, metadata.GET.requireFeatures)
    const query = parseDeliveryInput(querySchema, Object.fromEntries(new URL(request.url).searchParams))
    const service = ctx.container.resolve('deliveryOsFlowQueries') as DeliveryOsFlowQueries
    return NextResponse.json({ items: await service.portfolio([...new Set(query.ids)], scope) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.portfolio.read') }
}
export const openApi: OpenApiRouteDoc = { tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Scoped project portfolio', methods: { GET: { summary: 'Read flow projections for up to 50 project IDs in one batch', query: querySchema, responses: [{ status: 200, description: 'Visible project flow summaries; foreign IDs omitted', schema: z.object({ items: z.array(flowStatusV1Schema) }) }] } } }
