import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { ResultAcceptCommandResult } from '@open-mercato/core/modules/delivery_os/commands/evidence'
import {
  DELIVERY_TASK_RESOURCE_KIND,
  parseDeliveryInput,
  requireScopedTask,
  resolveDeliveryScope,
} from '@open-mercato/core/modules/delivery_os/commands/shared'
import { resultsImportSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
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
import { deliveryErrorBodySchema, resultAcceptResponseSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

const MAX_RESULT_BODY_BYTES = 8_000_000

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.results.import'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const taskId = await readRouteId(context)
    await requireScopedTask(resolveRouteEm(ctx), taskId, scope)
    const body = await readCappedRouteBody(request, MAX_RESULT_BODY_BYTES)
    const { attemptId, manifest } = parseDeliveryInput(resultsImportSchema, body)
    const outcome = await executeDeliveryCommand<ResultAcceptCommandResult>(ctx, scope, {
      commandId: 'delivery_os.results.accept',
      body: { attemptId, manifest },
      pathInput: { taskId, source: 'manual' },
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: taskId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { evidenceId, duplicate, taskStatus, taskUpdatedAt } = outcome.result
    return NextResponse.json({ evidenceId, duplicate, taskStatus, taskUpdatedAt }, { status: duplicate ? 200 : 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.results.accept')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Result import',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Import the ResultManifest v1 of an attempt',
      description:
        'Runs the same domain validation as the worker path. Idempotent by attempt and manifest hash: an identical replay answers 200 with `duplicate: true`, writes no new evidence and re-emits `delivery_os.evidence.recorded`.',
      requestBody: { contentType: 'application/json', schema: resultsImportSchema },
      responses: [
        { status: 201, description: 'Result accepted, task awaits review', schema: resultAcceptResponseSchema },
        { status: 200, description: 'Identical replay', schema: resultAcceptResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Task or attempt not found in this scope', schema: deliveryErrorBodySchema },
        {
          status: 409,
          description: 'Different result for this attempt, attempt cancelled or closed, reconciliation required',
          schema: deliveryErrorBodySchema,
        },
        { status: 413, description: 'Manifest above the size limit', schema: deliveryErrorBodySchema },
        {
          status: 422,
          description: 'Unsupported schema version or a task, baseline or revision mismatch',
          schema: deliveryErrorBodySchema,
        },
      ],
    },
  },
}
