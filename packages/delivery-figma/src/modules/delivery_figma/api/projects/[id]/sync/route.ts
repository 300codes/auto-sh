import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { flowStageIdSchema, commentImportResultSchema, type CommentImportResult } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { DELIVERY_STAFF_LINK_RESOURCE_KIND } from '@open-mercato/core/modules/delivery_os/commands/staffLink'
import { deliveryErrorResponse, executeDeliveryCommand, readCappedRouteBody, requireDeliveryFeatures, requireRouteStage, resolveDeliveryRouteContext, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { FigmaReadError } from '../../../../lib/client'
import type { createDeliveryFigmaProvider } from '../../../../lib/provider'

const bodySchema = z.object({
  fileKey: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  stageId: flowStageIdSchema,
  artifactId: z.string().uuid().nullable(),
})
const responseSchema = z.object({ schemaVersion: z.literal('delivery.figma-sync/v1'), complete: z.boolean(), results: z.array(commentImportResultSchema) })

export const metadata = { POST: { requireAuth: true, requireFeatures: ['delivery_os.comments.import'] } }

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.comments.import'])
    const input = parseDeliveryInput(bodySchema, await readCappedRouteBody(request, 10000))
    const { project } = await requireRouteStage(ctx, scope, { params: { ...await context.params, stageId: input.stageId } })
    const provider = ctx.container.resolve('deliveryFigmaProvider') as ReturnType<typeof createDeliveryFigmaProvider>
    const prepared = await provider.prepare(ctx, { ...input, projectId: project.id })
    const results: CommentImportResult[] = []
    for (const page of prepared) {
      const outcome = await executeDeliveryCommand<CommentImportResult>(ctx, scope, {
        commandId: 'delivery_os.comments.import', body: page, pathInput: { projectId: project.id },
        resourceKind: DELIVERY_STAFF_LINK_RESOURCE_KIND, resourceId: project.id, operation: 'custom',
      })
      if (outcome.blocked) return outcome.blocked
      results.push(outcome.result)
      if (outcome.result.counts.skipped > 0) return NextResponse.json({ schemaVersion: 'delivery.figma-sync/v1', complete: false, results }, { status: 207 })
    }
    return NextResponse.json({ schemaVersion: 'delivery.figma-sync/v1', complete: true, results })
  } catch (error) {
    if (error instanceof FigmaReadError) return NextResponse.json({ code: error.code, error: `delivery_figma.errors.${error.code}` }, { status: error.code === 'figma_rate_limited' ? 429 : 422 })
    return deliveryErrorResponse(error, 'delivery_figma.sync')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Delivery Figma', summary: 'Synchronize Figma comments', pathParams: z.object({ id: z.string().uuid() }),
  methods: { POST: {
    summary: 'Read a complete bounded Figma snapshot and import guarded batches into Staff',
    requestBody: { contentType: 'application/json', schema: bodySchema },
    responses: [{ status: 200, description: 'Synchronized', schema: responseSchema }, { status: 207, description: 'Partial import; retry required', schema: responseSchema }],
    errors: [{ status: 403, description: 'Missing permission' }, { status: 404, description: 'Project outside scope' }, { status: 409, description: 'Cursor or idempotency conflict' }, { status: 422, description: 'Provider, source or stage unavailable' }, { status: 429, description: 'Figma rate limit' }],
  } },
}
