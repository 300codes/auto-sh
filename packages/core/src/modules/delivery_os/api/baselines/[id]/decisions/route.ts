import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { DecisionCommandResult } from '@open-mercato/core/modules/delivery_os/commands/decisions'
import { DELIVERY_BASELINE_RESOURCE_KIND, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { baselineDecisionSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
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
import { decisionCreateResponseSchema, deliveryErrorBodySchema, optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.baselines.approve'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const baselineId = await readRouteId(context)
    const body = await readRouteBody(request)
    const outcome = await executeDeliveryCommand<DecisionCommandResult>(ctx, scope, {
      commandId: 'delivery_os.decisions.record',
      body,
      pathInput: { baselineId },
      resourceKind: DELIVERY_BASELINE_RESOURCE_KIND,
      resourceId: baselineId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { decisionId, activeBaselineId, projectUpdatedAt } = outcome.result
    return NextResponse.json({ decisionId, activeBaselineId, projectUpdatedAt }, { status: 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.decisions.record')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Baseline decisions',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Record a requirements or design decision for a baseline',
      description:
        'The decision is bound to the baseline hash and version. Requires the project optimistic-lock header; the baseline becomes active once both kinds are approved.',
      requestBody: { contentType: 'application/json', schema: baselineDecisionSchema },
      responses: [{ status: 201, description: 'Decision recorded', schema: decisionCreateResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Baseline not found in this scope', schema: deliveryErrorBodySchema },
        { status: 409, description: 'Subject hash mismatch or stale project version', schema: deliveryErrorBodySchema },
        { status: 409, description: 'Stale project version', schema: optimisticLockConflictSchema },
        { status: 422, description: 'Reason required or stored content altered', schema: deliveryErrorBodySchema },
        { status: 428, description: 'Project version header missing', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
