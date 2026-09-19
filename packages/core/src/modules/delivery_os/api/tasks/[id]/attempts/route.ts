import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { AttemptReserveResult } from '@open-mercato/core/modules/delivery_os/commands/attempts'
import {
  DELIVERY_TASK_RESOURCE_KIND,
  parseDeliveryInput,
  resolveDeliveryScope,
} from '@open-mercato/core/modules/delivery_os/commands/shared'
import { reserveAttemptBodySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { reserveAttemptResponseSchema, uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readIdempotencyKeyHeader,
  readRouteBody,
  readRouteId,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { deliveryErrorBodySchema, optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.attempts.manage'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const taskId = await readRouteId(context)
    const idempotencyKey = readIdempotencyKeyHeader(request)
    const { mode, baseRevision } = parseDeliveryInput(reserveAttemptBodySchema, await readRouteBody(request))
    const outcome = await executeDeliveryCommand<AttemptReserveResult>(ctx, scope, {
      commandId: 'delivery_os.attempts.reserve',
      body: { mode, baseRevision },
      pathInput: { taskId, idempotencyKey },
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: taskId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { created, ...reservation } = outcome.result
    return NextResponse.json(reservation, { status: created ? 201 : 200 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.attempts.reserve')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Execution attempts',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Reserve an execution attempt for a manual hand-off',
      description:
        'Requires the `Idempotency-Key` header. A new key needs the task optimistic-lock header and answers 201; the same key with the same payload answers 200 with the existing attempt, even when the lock header is stale or missing. `mode` is always `manual_handoff`; automatic execution is reserved for the trusted in-process executor.',
      requestBody: { contentType: 'application/json', schema: reserveAttemptBodySchema },
      responses: [
        { status: 201, description: 'Attempt reserved', schema: reserveAttemptResponseSchema },
        { status: 200, description: 'Existing attempt for this key', schema: reserveAttemptResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing Idempotency-Key or validation failed', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Task not found in this scope', schema: deliveryErrorBodySchema },
        {
          status: 409,
          description: 'Key reused with another payload, active attempt, attempt limit, task or dependency not ready, reconciliation required',
          schema: deliveryErrorBodySchema,
        },
        { status: 409, description: 'Stale task version', schema: optimisticLockConflictSchema },
        { status: 422, description: 'Revision kind does not match the target profile', schema: deliveryErrorBodySchema },
        { status: 428, description: 'Task version header missing for a new key', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
