import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DESIGN_IMPORT_RESOURCE_KIND } from '@open-mercato/core/modules/delivery_os/commands/designImports'
import type { DeliveryOsDesignImportQueries } from '@open-mercato/core/modules/delivery_os/commands/designImportQueries'
import { resolveDeliveryScope, parseDeliveryInput } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { designImportListSchema, designImportManifestSchema, designImportSessionSchema, type DesignImportSession } from '@open-mercato/core/modules/delivery_os/lib/designImportContracts'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import { deliveryErrorResponse, executeDeliveryCommand, readCappedRouteBody, readRouteId, requireDeliveryFeatures, resolveDeliveryRouteContext, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'
const querySchema = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
}
export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, metadata.GET.requireFeatures)
    const projectId = await readRouteId(context)
    const query = parseDeliveryInput(querySchema, Object.fromEntries(new URL(request.url).searchParams))
    const service = ctx.container.resolve('deliveryOsDesignImportQueries') as DeliveryOsDesignImportQueries
    return NextResponse.json(await service.list(scope, projectId, query.offset), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.design_imports.list') }
}
export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, metadata.POST.requireFeatures)
    const projectId = await readRouteId(context)
    const body = await readCappedRouteBody(request, 1_000_000)
    const outcome = await executeDeliveryCommand<DesignImportSession>(ctx, scope, {
      commandId: 'delivery_os.design_imports.create', body, pathInput: { projectId }, resourceKind: DESIGN_IMPORT_RESOURCE_KIND, resourceId: projectId, operation: 'create',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: 201 })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.design_imports.create') }
}
export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Durable design imports', pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: { summary: 'Read import history (20 per page)', query: querySchema, responses: [{ status: 200, description: 'Scoped sessions', schema: designImportListSchema }] },
    POST: { summary: 'Start or resume an identical manifest', description: 'Project optimistic-lock header required. Identical normalized manifest hashes return the existing session. New sessions mark the project draft as incomplete until all renders are verified.', requestBody: { contentType: 'application/json', schema: z.object({ manifest: designImportManifestSchema }) }, responses: [{ status: 201, description: 'Session', schema: designImportSessionSchema }] },
  },
}
