import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { DeliveryOsEvidenceQueries } from '@open-mercato/core/modules/delivery_os/commands/evidenceQueries'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { evidenceDetailResponseSchema } from '@open-mercato/core/modules/delivery_os/lib/evidenceReadContracts'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { deliveryErrorBodySchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import { deliveryErrorResponse, readRouteId, requireDeliveryFeatures, resolveDeliveryRouteContext, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'
export const metadata = { GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] } }
export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.projects.view'])
    const queries = ctx.container.resolve('deliveryOsEvidenceQueries') as DeliveryOsEvidenceQueries
    const detail = await queries.detail(scope, await readRouteId(context), await readRouteId(context, 'evidenceId'))
    const service = ctx.container.resolve('attachmentService') as AttachmentService
    if (service.describeScoped && ctx.auth) {
      const auth = { ...ctx.auth, tenantId: scope.tenantId, orgId: scope.organizationId }
      detail.attachments = await Promise.all(detail.attachments.map(async (attachment) => {
        try {
          const metadata = await service.describeScoped!({ attachmentId: attachment.id, auth })
          return { ...attachment, mimeType: metadata.mimeType, fileSize: metadata.fileSize, available: true }
        } catch (error) {
          if (isCrudHttpError(error) && (error.status === 404 || error.status === 403)) return { ...attachment, mimeType: null, fileSize: null, available: false }
          throw error
        }
      }))
    }
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.evidence.detail') }
}
export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Scoped evidence details', pathParams: z.object({ id: uuidSchema, evidenceId: uuidSchema }),
  methods: { GET: { summary: 'Read safe evidence payload and attachment links', description: 'Optional metadata is nullable. Free text, actors, credentials, external URLs and server paths are omitted. Attachments are capped at 100 and every byte read is authorized independently. Missing and foreign records return the same 404.', responses: [{ status: 200, description: 'Evidence read v1', schema: evidenceDetailResponseSchema }], errors: [{ status: 403, description: 'Missing view feature', schema: deliveryErrorBodySchema }, { status: 404, description: 'Not found', schema: deliveryErrorBodySchema }] } },
}
