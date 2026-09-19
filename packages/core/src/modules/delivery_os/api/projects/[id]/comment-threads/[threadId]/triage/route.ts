import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { CommentThreadTriageCommandResult } from '@open-mercato/core/modules/delivery_os/commands/comments'
import { DELIVERY_COMMENT_THREAD_RESOURCE_KIND } from '@open-mercato/core/modules/delivery_os/commands/comments'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import {
  commentThreadTriageRequestSchema,
  deliveryFlowErrorBodySchema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readRouteId,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { commentThreadTriageResponseSchema, optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

const MAX_TRIAGE_BODY_BYTES = 256_000

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.comments.import'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const threadId = await readRouteId(context, 'threadId')
    const triage = await readCappedRouteBody(request, MAX_TRIAGE_BODY_BYTES)
    const outcome = await executeDeliveryCommand<CommentThreadTriageCommandResult>(ctx, scope, {
      commandId: 'delivery_os.comments.triage',
      body: { triage },
      pathInput: { projectId, threadId },
      resourceKind: DELIVERY_COMMENT_THREAD_RESOURCE_KIND,
      resourceId: threadId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(commentThreadTriageResponseSchema.parse(outcome.result))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.comments.triage')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Comment thread triage',
  pathParams: z.object({ id: uuidSchema, threadId: uuidSchema }),
  methods: {
    POST: {
      summary: 'Record the triage of one imported comment thread',
      description:
        'F13. Moves the thread between `new`, `triaged`, `deferred` and `resolved` and optionally links it to a delivery task; the imported source fields and the replies stay untouched. A deferral must name the artifact version it was decided for (`artifactId` + its `contentHash`) and a reason — only that artifact hash is then unblocked for approval. Requires the **thread** optimistic-lock header (`updatedAt` from the thread list), not the project version. Neither resolving the source thread nor moving the staff card approves a stage.',
      requestBody: { contentType: 'application/json', schema: commentThreadTriageRequestSchema },
      responses: [{ status: 200, description: 'Triage recorded', schema: commentThreadTriageResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed or malformed version header', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing feature or signed-in user', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project or thread not found in this scope', schema: deliveryFlowErrorBodySchema },
        {
          status: 409,
          description: 'optimistic_lock_conflict (stale thread version)',
          schema: z.union([deliveryFlowErrorBodySchema, optimisticLockConflictSchema]),
        },
        { status: 413, description: 'Request body is too large', schema: deliveryFlowErrorBodySchema },
        {
          status: 422,
          description: 'foreign_reference (artifact or delivery task of another project/stage), hash_mismatch, reason_required',
          schema: deliveryFlowErrorBodySchema,
        },
        { status: 428, description: 'Thread version header missing', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
