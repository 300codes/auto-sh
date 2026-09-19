import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { IntakeUpdateCommandResult } from '@open-mercato/core/modules/delivery_os/commands/intake'
import {
  DELIVERY_INTAKE_RESOURCE_KIND,
  findScopedIntake,
  resolveDeliveryScope,
} from '@open-mercato/core/modules/delivery_os/commands/shared'
import {
  deliveryFlowErrorBodySchema,
  intakeResponseSchema,
  intakeUpdateRequestSchema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readRouteId,
  requireProjectIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { serializeIntakeResponse } from '@open-mercato/core/modules/delivery_os/api/serializers'

const MAX_INTAKE_BODY_BYTES = 1_000_000

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  PUT: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const em = resolveRouteEm(ctx)
    const project = await requireProjectIncludingArchived(em, projectId, scope)
    const intake = await findScopedIntake(em, project.id, scope)
    return NextResponse.json(serializeIntakeResponse(project, intake))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.intake.read')
  }
}

export async function PUT(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const intake = await readCappedRouteBody(request, MAX_INTAKE_BODY_BYTES)
    const outcome = await executeDeliveryCommand<IntakeUpdateCommandResult>(ctx, scope, {
      commandId: 'delivery_os.intake.update',
      body: { intake },
      pathInput: { projectId },
      resourceKind: DELIVERY_INTAKE_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result)
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.intake.update')
  }
}

const intakeErrors = {
  forbidden: { status: 403, description: 'Missing feature or signed-in user', schema: deliveryFlowErrorBodySchema },
  notFound: { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Project intake (brief wizard and scoping draft)',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'Read the intake draft of a project',
      description:
        'F1. Returns the stored draft, or an empty default with `step: brief` when none exists. `updatedAt` is the intake version for the PUT header: the stored row, or the project `createdAt` before the first write. Archived projects stay readable.',
      responses: [{ status: 200, description: 'Intake draft', schema: intakeResponseSchema }],
      errors: [intakeErrors.forbidden, intakeErrors.notFound],
    },
    PUT: {
      summary: 'Save the whole intake draft (wizard autosave)',
      description:
        'F2. Body is the whole draft without `proposals` (server-owned, written only by the proposal import; a `proposals` key is ignored). Requires the intake optimistic-lock header set to the `updatedAt` from GET; the intake version is independent of the project version.',
      requestBody: { contentType: 'application/json', schema: intakeUpdateRequestSchema },
      responses: [{ status: 200, description: 'Saved intake draft', schema: intakeResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed or malformed version header', schema: deliveryFlowErrorBodySchema },
        intakeErrors.forbidden,
        intakeErrors.notFound,
        { status: 409, description: 'Stale intake version', schema: optimisticLockConflictSchema },
        { status: 413, description: 'Body too large', schema: deliveryFlowErrorBodySchema },
        {
          status: 422,
          description:
            'target_profile_frozen (platform.chosen differs from the project profile), intake_step_invalid, duplicate_stable_id, attachment_* (brief materials)',
          schema: deliveryFlowErrorBodySchema,
        },
        { status: 428, description: 'Intake version header missing', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
