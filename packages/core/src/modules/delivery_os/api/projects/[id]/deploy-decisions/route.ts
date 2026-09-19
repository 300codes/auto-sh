import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { DecisionCommandResult } from '@open-mercato/core/modules/delivery_os/commands/decisions'
import { DELIVERY_PROJECT_RESOURCE_KIND, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { deployDecisionSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
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
  deliveryErrorBodySchema,
  deployDecisionCreateResponseSchema,
  optimisticLockConflictSchema,
} from '@open-mercato/core/modules/delivery_os/api/schemas'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.deploy.approve'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const body = await readRouteBody(request)
    const outcome = await executeDeliveryCommand<DecisionCommandResult>(ctx, scope, {
      commandId: 'delivery_os.decisions.record',
      body,
      pathInput: { projectId, kind: 'deploy' },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { decisionId, projectUpdatedAt } = outcome.result
    return NextResponse.json({ decisionId, projectUpdatedAt }, { status: 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.decisions.record')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Deploy decisions',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Record the publish consent (deploy decision) for the active baseline on a revision',
      description:
        'Append-only. An approved verdict is accepted only when the delivery report of the active baseline is publishable on sourceRevision; a reject is always allowed with a reason. Requires the project optimistic-lock header.',
      requestBody: { contentType: 'application/json', schema: deployDecisionSchema },
      responses: [{ status: 201, description: 'Deploy decision recorded', schema: deployDecisionCreateResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
        { status: 403, description: 'Missing feature or signed-in user', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema },
        { status: 409, description: 'Stale project version, candidate or decision context', schema: z.union([optimisticLockConflictSchema, deliveryErrorBodySchema]) },
        {
          status: 422,
          description:
            'report_not_green (details = publish blockers, path <kind>:<id>, code = status), baseline_not_active, invalid_revision, reason_required, unknown_target_profile, hash_mismatch',
          schema: deliveryErrorBodySchema,
        },
        { status: 428, description: 'Project version header missing', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
