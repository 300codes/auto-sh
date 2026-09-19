import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { CommentImportCommandResult } from '@open-mercato/core/modules/delivery_os/commands/comments'
import { DELIVERY_PROJECT_RESOURCE_KIND, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  commentImportBatchV1Schema,
  commentImportResultSchema,
  deliveryFlowErrorBodySchema,
  parseFlowVersioned,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readIdempotencyKeyHeader,
  readRouteId,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'

const MAX_IMPORT_BODY_BYTES = 1_000_000

const COMMENT_IMPORT_SCHEMAS = { [DELIVERY_FLOW_SCHEMA_VERSIONS.commentImport]: commentImportBatchV1Schema }

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.comments.import'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const idempotencyKey = readIdempotencyKeyHeader(request)
    const parsed = parseFlowVersioned(COMMENT_IMPORT_SCHEMAS, await readCappedRouteBody(request, MAX_IMPORT_BODY_BYTES))
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status })
    const outcome = await executeDeliveryCommand<CommentImportCommandResult>(ctx, scope, {
      commandId: 'delivery_os.comments.import',
      body: { batch: parsed.data },
      pathInput: { projectId, idempotencyKey },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: outcome.result.replayed ? 200 : 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.comments.import')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Design comment import',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Import one normalized page of design comments',
      description:
        'F11. Body is a `CommentImportBatch v1` fetched by a comment provider; one source thread becomes one staff Kanban card and one reply becomes one card comment. Requires the `Idempotency-Key` header, read before the body. A replay of the same key with the same batch answers 200 `replayed: true` without touching the board; the file cursor and the batch key advance only when every thread succeeded, so a partially failed batch is retried by the same key. No optimistic-lock header: the import is a system sync and never bumps the project version.',
      requestBody: { contentType: 'application/json', schema: commentImportBatchV1Schema },
      responses: [
        { status: 201, description: 'Batch imported', schema: commentImportResultSchema },
        { status: 200, description: 'Same key and batch already imported (replayed: true)', schema: commentImportResultSchema },
      ],
      errors: [
        { status: 400, description: 'idempotency_key_required or validation_failed', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing feature or signed-in user', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        {
          status: 409,
          description: 'idempotency_conflict (same key, another batch) or sync_cursor_conflict (the batch does not continue the stored cursor)',
          schema: deliveryFlowErrorBodySchema,
        },
        { status: 413, description: 'Request body is too large', schema: deliveryFlowErrorBodySchema },
        {
          status: 422,
          description: 'unsupported_schema_version, duplicate_stable_id, staff_link_required, flow_not_pinned, stage_unknown, foreign_reference',
          schema: deliveryFlowErrorBodySchema,
        },
      ],
    },
  },
}
