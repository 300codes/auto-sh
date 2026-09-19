import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { DeliveryOsAttemptQueries } from '@open-mercato/core/modules/delivery_os/commands/attemptQueries'
import { parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { packageQuerySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { taskPackageV1Schema, uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  readRouteId,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { deliveryErrorBodySchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.attempts.manage'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const taskId = await readRouteId(context)
    const { attemptId } = parseDeliveryInput(packageQuerySchema, {
      attemptId: new URL(request.url).searchParams.get('attemptId') ?? undefined,
    })
    const queries = ctx.container.resolve('deliveryOsAttemptQueries') as DeliveryOsAttemptQueries
    return NextResponse.json(await queries.buildTaskPackage(scope, taskId, attemptId))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.tasks.package')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Task package export',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'Export the TaskPackage v1 of a reserved attempt',
      description:
        'Read-only: builds the package from the pinned baseline and the reserved attempt and never writes. An unknown `attemptId` answers 404 and creates nothing.',
      query: packageQuerySchema,
      responses: [{ status: 200, description: 'TaskPackage v1', schema: taskPackageV1Schema }],
      errors: [
        { status: 400, description: 'Missing or malformed attemptId', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Task or attempt not found in this scope', schema: deliveryErrorBodySchema },
        { status: 409, description: 'Attempt cancelled, closed or awaiting reconciliation', schema: deliveryErrorBodySchema },
        { status: 422, description: 'Pinned baseline, profile or revision no longer matches', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
