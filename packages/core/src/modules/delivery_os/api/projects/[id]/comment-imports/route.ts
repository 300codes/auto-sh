import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DELIVERY_PROJECT_RESOURCE_KIND, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { deliveryFlowErrorBodySchema, uuidSchema, commentImportBatchV1Schema, commentImportResultSchema, parseFlowVersioned, DELIVERY_FLOW_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import { deliveryErrorResponse, executeDeliveryCommand, readCappedRouteBody, readIdempotencyKeyHeader, readRouteId, requireDeliveryFeatures, resolveDeliveryRouteContext, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'

import type { CommentImportCommandResult } from '@open-mercato/core/modules/delivery_os/commands/comments'
export const metadata = { POST: { requireAuth: true, requireFeatures: ['delivery_os.comments.import'] } }
export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.comments.import'])
    const projectId = await readRouteId(context)
    const idempotencyKey = readIdempotencyKeyHeader(request)
    const parsed = parseFlowVersioned({ [DELIVERY_FLOW_SCHEMA_VERSIONS.commentImport]: commentImportBatchV1Schema }, await readCappedRouteBody(request, 1_000_000))
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status })
    const batch = parsed.data
    const outcome = await executeDeliveryCommand<CommentImportCommandResult>(ctx, scope, {
      commandId: 'delivery_os.comments.import', body: { batch }, pathInput: { projectId, idempotencyKey }, resourceKind: DELIVERY_PROJECT_RESOURCE_KIND, resourceId: projectId, operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: outcome.result.replayed ? 200 : 201 })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.comments.import') }
}
export const openApi: OpenApiRouteDoc = { tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Import a scoped comment batch', pathParams: z.object({ id: uuidSchema }), methods: {
 POST: { summary: 'Import with Idempotency-Key header; replay precedes cursor validation', requestBody: { contentType: 'application/json', schema: commentImportBatchV1Schema }, responses: [{ status: 201, description: 'Imported', schema: commentImportResultSchema }, { status: 200, description: 'Replayed', schema: commentImportResultSchema }], errors: [{ status: 403, description: 'Feature required', schema: deliveryFlowErrorBodySchema }, { status: 404, description: 'Not found in scope', schema: deliveryFlowErrorBodySchema }, { status: 409, description: 'Conflict', schema: deliveryFlowErrorBodySchema }, { status: 422, description: 'Invalid reference or input', schema: deliveryFlowErrorBodySchema }] },
} }
