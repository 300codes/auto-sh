import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { StaffLinkCommandResult } from '@open-mercato/core/modules/delivery_os/commands/staffLink'
import { loadStaffLink } from '@open-mercato/core/modules/delivery_os/commands/staffLink'
import {
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryHttpError,
  resolveDeliveryScope,
} from '@open-mercato/core/modules/delivery_os/commands/shared'
import {
  buildDeliveryError,
  deliveryFlowErrorBodySchema,
  staffLinkRequestSchema,
  staffLinkSchema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readRouteBody,
  readRouteId,
  requireProjectIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { serializeStaffLink } from '@open-mercato/core/modules/delivery_os/api/serializers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  PUT: { requireAuth: true, requireFeatures: ['delivery_os.flow.manage'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const em = resolveRouteEm(ctx)
    const project = await requireProjectIncludingArchived(em, projectId, scope)
    const link = await loadStaffLink(em, project.id, scope)
    if (!link) {
      throw deliveryHttpError(
        buildDeliveryError('not_found', 'The project is not linked to a staff project', [{ path: 'staffLink', code: 'not_found' }]),
      )
    }
    return NextResponse.json(serializeStaffLink(link))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.staff.read_link')
  }
}

export async function PUT(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const body = await readRouteBody(request)
    const outcome = await executeDeliveryCommand<StaffLinkCommandResult>(ctx, scope, {
      commandId: 'delivery_os.staff.link',
      body,
      pathInput: { projectId },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(staffLinkSchema.parse(outcome.result))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.staff.link')
  }
}

const staffLinkErrors = {
  forbidden: { status: 403, description: 'Missing feature or signed-in user', schema: deliveryFlowErrorBodySchema },
  notFound: {
    status: 404,
    description: 'Project not found in this scope, no link yet (GET), or a staff project the caller cannot reach (PUT)',
    schema: deliveryFlowErrorBodySchema,
  },
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Staff Kanban link',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'Read the staff project linked to this delivery project',
      description:
        'F10. Returns the link with its per-file comment sync cursors. A project without a link answers 404 `not_found` (detail path `staffLink`).',
      responses: [{ status: 200, description: 'Staff link', schema: staffLinkSchema }],
      errors: [staffLinkErrors.forbidden, staffLinkErrors.notFound],
    },
    PUT: {
      summary: 'Link the delivery project to a staff project',
      description:
        'F10. The staff project is accepted only when the staff module\'s own access resolver reaches it for this caller, so a foreign, deleted or inaccessible id answers the same 404 and the route is no existence oracle. Linking the same staff project again answers 200 with the stored link and needs no version header; every other write requires the project optimistic-lock header. Re-linking is refused once an imported thread has a staff card.',
      requestBody: { contentType: 'application/json', schema: staffLinkRequestSchema },
      responses: [{ status: 200, description: 'Linked staff project', schema: staffLinkSchema }],
      errors: [
        { status: 400, description: 'Validation failed or malformed version header', schema: deliveryFlowErrorBodySchema },
        staffLinkErrors.forbidden,
        staffLinkErrors.notFound,
        {
          status: 409,
          description:
            'staff_link_in_use (cards already imported), staff_project_already_linked (taken by another delivery project), or optimistic_lock_conflict (stale project version)',
          schema: z.union([deliveryFlowErrorBodySchema, optimisticLockConflictSchema]),
        },
        { status: 422, description: 'staff_link_required (the staff module is not available)', schema: deliveryFlowErrorBodySchema },
        { status: 428, description: 'Project version header missing', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
