import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { deliveryFlowErrorBodySchema, uuidSchema, commentThreadTriageRequestSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import { deliveryErrorResponse, executeDeliveryCommand, readCappedRouteBody, readRouteId, requireDeliveryFeatures, resolveDeliveryRouteContext, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'

import { DELIVERY_COMMENT_THREAD_RESOURCE_KIND, type CommentThreadTriageCommandResult } from '@open-mercato/core/modules/delivery_os/commands/comments'
const resultSchema = z.object({ threadId: uuidSchema, triageStatus: z.enum(['new', 'triaged', 'deferred', 'resolved']), updatedAt: z.string() })
export const metadata = { POST: { requireAuth: true, requireFeatures: ['delivery_os.comments.import'] } }
export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.comments.import'])
    const projectId = await readRouteId(context)
    const threadId = await readRouteId(context, 'threadId')
    const triage = parseDeliveryInput(commentThreadTriageRequestSchema, await readCappedRouteBody(request, 32_000))
    const outcome = await executeDeliveryCommand<CommentThreadTriageCommandResult>(ctx, scope, {
      commandId: 'delivery_os.comments.triage', body: { triage }, pathInput: { projectId, threadId }, resourceKind: DELIVERY_COMMENT_THREAD_RESOURCE_KIND, resourceId: threadId, operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result)
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.comments.triage') }
}
export const openApi: OpenApiRouteDoc = { tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Triage a scoped comment thread', pathParams: z.object({ id: uuidSchema, threadId: uuidSchema }), methods: {
 POST: { summary: 'Triage using the thread own updatedAt version', requestBody: { contentType: 'application/json', schema: commentThreadTriageRequestSchema }, responses: [{ status: 200, description: 'Triage result', schema: resultSchema }], errors: [{ status: 403, description: 'Feature required', schema: deliveryFlowErrorBodySchema }, { status: 404, description: 'Not found in scope', schema: deliveryFlowErrorBodySchema }, { status: 409, description: 'Conflict', schema: deliveryFlowErrorBodySchema }, { status: 422, description: 'Invalid reference or input', schema: deliveryFlowErrorBodySchema }] },
} }
