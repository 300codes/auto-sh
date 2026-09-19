import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DESIGN_IMPORT_RESOURCE_KIND } from '@open-mercato/core/modules/delivery_os/commands/designImports'
import type { DeliveryOsDesignImportQueries } from '@open-mercato/core/modules/delivery_os/commands/designImportQueries'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { designImportUpdateBodySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { designImportSessionSchema, type DesignImportSession } from '@open-mercato/core/modules/delivery_os/lib/designImportContracts'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import { deliveryErrorResponse, executeDeliveryCommand, readCappedRouteBody, readRouteId, requireDeliveryFeatures, resolveDeliveryRouteContext, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  PUT: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
}
export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, metadata.GET.requireFeatures)
    const projectId = await readRouteId(context)
    const sessionId = await readRouteId(context, 'sessionId')
    const service = ctx.container.resolve('deliveryOsDesignImportQueries') as DeliveryOsDesignImportQueries
    return NextResponse.json(await service.read(scope, projectId, sessionId), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.design_imports.read') }
}
export async function PUT(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, metadata.PUT.requireFeatures)
    const projectId = await readRouteId(context)
    const sessionId = await readRouteId(context, 'sessionId')
    const body = await readCappedRouteBody(request, 100_000)
    const outcome = await executeDeliveryCommand<DesignImportSession>(ctx, scope, {
      commandId: 'delivery_os.design_imports.update', body, pathInput: { projectId, sessionId }, resourceKind: DESIGN_IMPORT_RESOURCE_KIND, resourceId: sessionId, operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result)
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.design_imports.update') }
}
export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Resume a design import', pathParams: z.object({ id: uuidSchema, sessionId: uuidSchema }),
  methods: {
    GET: { summary: 'Read persisted progress and screen versions', responses: [{ status: 200, description: 'Session', schema: designImportSessionSchema }] },
    PUT: { summary: 'Verify renders, finalize a selection or cancel', description: 'Requires the session updatedAt optimistic-lock header, independent of the project version. Each render is verified against stored attachment bytes and project ownership. Per-screen verification failures persist as partial progress; complete requires every render verified and exactly one selected version per screen identity.', requestBody: { contentType: 'application/json', schema: designImportUpdateBodySchema }, responses: [{ status: 200, description: 'Persisted progress', schema: designImportSessionSchema }] },
  },
}
