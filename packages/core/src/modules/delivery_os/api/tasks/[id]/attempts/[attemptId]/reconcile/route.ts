import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { AttemptReconcileResult } from '@open-mercato/core/modules/delivery_os/commands/reconcile'
import {
  DELIVERY_TASK_RESOURCE_KIND,
  parseDeliveryInput,
  requireScopedTask,
  resolveDeliveryScope,
} from '@open-mercato/core/modules/delivery_os/commands/shared'
import { reconcileAttemptSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readRouteId,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import {
  attemptReconcileResponseSchema,
  deliveryErrorBodySchema,
  optimisticLockConflictSchema,
} from '@open-mercato/core/modules/delivery_os/api/schemas'

const MAX_RECONCILE_BODY_BYTES = 8_000_000

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.attempts.reconcile'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const taskId = await readRouteId(context)
    const attemptId = await readRouteId(context, 'attemptId')
    await requireScopedTask(resolveRouteEm(ctx), taskId, scope)
    const body = await readCappedRouteBody(request, MAX_RECONCILE_BODY_BYTES)
    const { resolution, externalEvidence, manifest } = parseDeliveryInput(reconcileAttemptSchema, body)
    const outcome = await executeDeliveryCommand<AttemptReconcileResult>(ctx, scope, {
      commandId: 'delivery_os.attempts.reconcile',
      body: manifest === undefined ? { resolution, externalEvidence } : { resolution, externalEvidence, manifest },
      pathInput: { taskId, attemptId },
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: taskId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { taskStatus, taskUpdatedAt, evidenceId } = outcome.result
    return NextResponse.json({
      attemptId: outcome.result.attemptId,
      resolution: outcome.result.resolution,
      taskStatus,
      taskUpdatedAt,
      ...(evidenceId ? { evidenceId } : {}),
    })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.attempts.reconcile')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Reconcile an execution attempt',
  pathParams: z.object({ id: uuidSchema, attemptId: uuidSchema }),
  methods: {
    POST: {
      summary: 'Record what really happened to an uncertain execution attempt',
      description:
        'A human states the observed external state; the system decides what follows and never restarts or dispatches anything. `not_started` / `stopped` close the attempt and return the task to `ready` (`changes_requested` in a correction round; `blocked` when the task no longer passes the ready gate). `completed` needs the ResultManifest v1 and runs exactly the validation of the result import; the task ends `awaiting_review`, never `verified`. `unknown` moves the attempt to `reconciliation_required` and the task to `blocked` / `reconciliation_required`, which keeps refusing a new reservation and archiving until a later reconcile. Works on an active (`reserved`, `claimed`, `cancel_requested`) or unknown attempt. Requires the task optimistic-lock header and the separate feature `delivery_os.attempts.reconcile`.',
      requestBody: { contentType: 'application/json', schema: reconcileAttemptSchema },
      responses: [{ status: 200, description: 'Resolution recorded', schema: attemptReconcileResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
        { status: 403, description: 'No user id to record as the actor', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Task or attempt not found in this scope', schema: deliveryErrorBodySchema },
        {
          status: 409,
          description:
            'Attempt is not reconcilable (result received or closed), the attempt register is unreadable, or a result-import conflict',
          schema: deliveryErrorBodySchema,
        },
        { status: 409, description: 'Stale task version', schema: optimisticLockConflictSchema },
        { status: 413, description: 'Body or manifest above the size limit', schema: deliveryErrorBodySchema },
        {
          status: 422,
          description: '`completed` without a manifest (`manifest_required`) or any result-import validation error',
          schema: deliveryErrorBodySchema,
        },
        { status: 428, description: 'Task version header missing', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
