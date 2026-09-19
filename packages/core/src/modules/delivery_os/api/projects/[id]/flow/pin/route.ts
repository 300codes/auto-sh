import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { FlowPinCommandResult } from '@open-mercato/core/modules/delivery_os/commands/flow'
import { DELIVERY_PROJECT_RESOURCE_KIND, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import {
  deliveryFlowErrorBodySchema,
  flowPinRequestSchema,
  flowPinResponseSchema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readRouteBody,
  readRouteId,
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
    const projectId = await readRouteId(context)
    const body = await readRouteBody(request)
    const outcome = await executeDeliveryCommand<FlowPinCommandResult>(ctx, scope, {
      commandId: 'delivery_os.flow.pin',
      body,
      pathInput: { projectId },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { duplicate, ...response } = outcome.result
    return NextResponse.json(response, { status: duplicate ? 200 : 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.flow.pin')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Process template pinning',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Pin a published process template to the project',
      description:
        'F4. Write-once: stores the template snapshot and its hash on the project, so later template versions never change this project. Pinning the same template again answers 200 with the stored body; another template answers 409 flow_already_pinned. Requires the project optimistic-lock header on the first pin.',
      requestBody: { contentType: 'application/json', schema: flowPinRequestSchema },
      responses: [
        { status: 201, description: 'Template pinned', schema: flowPinResponseSchema },
        { status: 200, description: 'Already pinned to this template (replay)', schema: flowPinResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed or malformed version header', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing feature or signed-in user', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        {
          status: 409,
          description: 'flow_already_pinned (another template), or optimistic_lock_conflict (stale project version)',
          schema: z.union([deliveryFlowErrorBodySchema, optimisticLockConflictSchema]),
        },
        { status: 422, description: 'unknown_flow_template, flow_template_hash_mismatch', schema: deliveryFlowErrorBodySchema },
        { status: 428, description: 'Project version header missing', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
