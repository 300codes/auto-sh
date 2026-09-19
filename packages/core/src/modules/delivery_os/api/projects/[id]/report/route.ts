import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { DeliveryOsReportQueries } from '@open-mercato/core/modules/delivery_os/commands/reportQueries'
import { parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { reportQuerySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { deliveryReportV1Schema, uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  readRouteId,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { deliveryErrorBodySchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const params = new URL(request.url).searchParams
    const query = parseDeliveryInput(reportQuerySchema, {
      baselineId: params.get('baselineId') ?? undefined,
      revision: params.get('revision') ?? undefined,
      limit: params.get('limit') ?? undefined,
    })
    const queries = ctx.container.resolve('deliveryOsReportQueries') as DeliveryOsReportQueries
    return NextResponse.json(await queries.buildReport(scope, projectId, query))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.projects.report')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Delivery report',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'Get the DeliveryReport v1 of a project',
      description:
        'Read-only: evaluates every acceptance criterion of the baseline (default: the active baseline) on one revision (default: the newest accepted result) and the project target profile, from stored evidence and decisions only. `revision` is `git:<commitSha>` or `snapshot:<sha256>:<externalWorkspaceId>`. Rows are capped by `limit` (default and maximum 1000) with `truncated`. Archived projects stay readable.',
      query: reportQuerySchema,
      responses: [{ status: 200, description: 'DeliveryReport v1', schema: deliveryReportV1Schema }],
      errors: [
        { status: 400, description: 'Malformed baselineId or limit', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Project or baseline not found in this scope, or no active baseline', schema: deliveryErrorBodySchema },
        {
          status: 422,
          description: 'invalid_revision (unparsable or wrong kind for the profile), unknown_target_profile, hash_mismatch',
          schema: deliveryErrorBodySchema,
        },
      ],
    },
  },
}
