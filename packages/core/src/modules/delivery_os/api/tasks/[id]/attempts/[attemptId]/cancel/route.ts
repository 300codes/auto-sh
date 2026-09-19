import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { AttemptCancelResult } from '@open-mercato/core/modules/delivery_os/commands/attempts'
import {
  DELIVERY_TASK_RESOURCE_KIND,
  parseDeliveryInput,
  resolveDeliveryScope,
} from '@open-mercato/core/modules/delivery_os/commands/shared'
import { cancelAttemptSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readRouteBody,
  readRouteId,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import {
  attemptCancelResponseSchema,
  deliveryErrorBodySchema,
  optimisticLockConflictSchema,
} from '@open-mercato/core/modules/delivery_os/api/schemas'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.attempts.manage'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const taskId = await readRouteId(context)
    const attemptId = await readRouteId(context, 'attemptId')
    const { reason } = parseDeliveryInput(cancelAttemptSchema, await readRouteBody(request))
    const outcome = await executeDeliveryCommand<AttemptCancelResult>(ctx, scope, {
      commandId: 'delivery_os.attempts.cancel',
      body: reason === undefined ? {} : { reason },
      pathInput: { taskId, attemptId },
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: taskId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { state, stopConfirmation, taskStatus, taskUpdatedAt } = outcome.result
    return NextResponse.json({ attemptId: outcome.result.attemptId, state, stopConfirmation, taskStatus, taskUpdatedAt })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.attempts.cancel')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Cancel an execution attempt',
  pathParams: z.object({ id: uuidSchema, attemptId: uuidSchema }),
  methods: {
    POST: {
      summary: 'Request the cancellation of an active execution attempt',
      description:
        'Records the request only: the attempt moves to `cancel_requested` with `stopConfirmation: stop_unconfirmed`. The external process is NOT confirmed stopped; the attempt keeps blocking a new reservation, archiving and late results until it is reconciled. The task stays `executing`. Requires the task optimistic-lock header. Repeating the request for an attempt that already awaits a stop answers 200 with the same state and writes nothing, also with a stale version header (the header must still be present) — the reason of a repeat is not recorded. The optional `reason` is kept in the audit log.',
      requestBody: { contentType: 'application/json', schema: cancelAttemptSchema },
      responses: [{ status: 200, description: 'Cancellation requested, stop not confirmed', schema: attemptCancelResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Task or attempt not found in this scope', schema: deliveryErrorBodySchema },
        {
          status: 409,
          description: 'Attempt is not active (result received, closed or unknown) or the attempt register is unreadable',
          schema: deliveryErrorBodySchema,
        },
        { status: 409, description: 'Stale task version', schema: optimisticLockConflictSchema },
        { status: 428, description: 'Task version header missing', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
