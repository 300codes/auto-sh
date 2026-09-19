import { flowBaselineResponseSchema } from '@open-mercato/core/modules/delivery_os/lib/flowBaseline'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { FlowBaselineResult } from '@open-mercato/core/modules/delivery_os/commands/flowBaseline'
import { DELIVERY_PROJECT_RESOURCE_KIND, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import {
  deliveryFlowErrorBodySchema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readRouteBody,
  readRouteId,
  requireDeliveryFeatures,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.flow.manage'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.flow.manage'])
    const projectId = await readRouteId(context)
    const body = await readRouteBody(request)
    const outcome = await executeDeliveryCommand<FlowBaselineResult>(ctx, scope, {
      commandId: 'delivery_os.flow.materialize_baseline',
      body,
      pathInput: { projectId },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result)
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.flow.materialize_baseline')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Materialize a draft from approved process stages',
  pathParams: z.object({ id: uuidSchema }),
  methods: { POST: {
    summary: 'Materialize a versioned draft without technical approvals',
    requestBody: { contentType: 'application/json', schema: z.object({}) },
    responses: [{ status: 200, description: 'Draft materialized', schema: flowBaselineResponseSchema }],
    errors: [
      { status: 403, description: 'Missing feature', schema: deliveryFlowErrorBodySchema },
      { status: 404, description: 'Project not found', schema: deliveryFlowErrorBodySchema },
      { status: 409, description: 'Stale project version', schema: optimisticLockConflictSchema },
      { status: 422, description: 'Stages are not current and approved', schema: deliveryFlowErrorBodySchema },
      { status: 428, description: 'Project version required', schema: deliveryFlowErrorBodySchema },
    ],
  } },
}
