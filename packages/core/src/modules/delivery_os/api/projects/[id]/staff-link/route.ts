import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { DeliveryOsCommentQueries } from '@open-mercato/core/modules/delivery_os/commands/commentQueries'
import { DELIVERY_PROJECT_RESOURCE_KIND, deliveryHttpError, parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { buildDeliveryError, deliveryFlowErrorBodySchema, uuidSchema, staffLinkSchema, staffLinkRequestSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import { deliveryErrorResponse, executeDeliveryCommand, readCappedRouteBody, readRouteId, requireDeliveryFeatures, resolveDeliveryRouteContext, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'

import type { StaffLinkCommandResult } from '@open-mercato/core/modules/delivery_os/commands/staffLink'
export const metadata = { GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] }, PUT: { requireAuth: true, requireFeatures: ['delivery_os.flow.manage'] } }
export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.projects.view'])
    const queries = ctx.container.resolve('deliveryOsCommentQueries') as DeliveryOsCommentQueries
    const link = await queries.staffLink(await readRouteId(context), scope)
    if (!link) throw deliveryHttpError(buildDeliveryError('not_found', 'The project is not linked to a staff project', [{ path: 'staffLink', code: 'not_found' }]))
    return NextResponse.json(link)
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.staff.link.read') }
}
export async function PUT(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.flow.manage'])
    const projectId = await readRouteId(context)
    const body = parseDeliveryInput(staffLinkRequestSchema, await readCappedRouteBody(request, 16_000))
    const outcome = await executeDeliveryCommand<StaffLinkCommandResult>(ctx, scope, {
      commandId: 'delivery_os.staff.link', body, pathInput: { projectId }, resourceKind: DELIVERY_PROJECT_RESOURCE_KIND, resourceId: projectId, operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { unchanged, ...link } = outcome.result
    return NextResponse.json(link)
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.staff.link') }
}
export const openApi: OpenApiRouteDoc = { tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Scoped Staff project link', pathParams: z.object({ id: uuidSchema }), methods: {
 GET: { summary: 'Read Staff link', responses: [{ status: 200, description: 'Staff link', schema: staffLinkSchema }], errors: [{ status: 403, description: 'Feature required', schema: deliveryFlowErrorBodySchema }, { status: 404, description: 'Not found in scope', schema: deliveryFlowErrorBodySchema }, { status: 409, description: 'Conflict', schema: deliveryFlowErrorBodySchema }, { status: 422, description: 'Invalid reference or input', schema: deliveryFlowErrorBodySchema }] },
 PUT: { summary: 'Link a Staff project with project version', requestBody: { contentType: 'application/json', schema: staffLinkRequestSchema }, responses: [{ status: 200, description: 'Linked project', schema: staffLinkSchema }], errors: [{ status: 400, description: 'Invalid input', schema: deliveryFlowErrorBodySchema }, { status: 403, description: 'Feature required', schema: deliveryFlowErrorBodySchema }, { status: 404, description: 'Not found in scope', schema: deliveryFlowErrorBodySchema }, { status: 409, description: 'Conflict', schema: deliveryFlowErrorBodySchema }, { status: 422, description: 'Invalid reference or input', schema: deliveryFlowErrorBodySchema }, { status: 428, description: 'Project version required', schema: deliveryFlowErrorBodySchema }] },
} }
