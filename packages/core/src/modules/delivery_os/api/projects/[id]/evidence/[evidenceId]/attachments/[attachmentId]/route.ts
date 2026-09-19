import { z } from 'zod'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { requireScopedEvidence } from '@open-mercato/core/modules/delivery_os/commands/evidenceQueries'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { deliveryErrorBodySchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import { deliveryErrorResponse, readRouteId, requireDeliveryFeatures, resolveDeliveryRouteContext, resolveRouteEm, type DeliveryRouteContext } from '@open-mercato/core/modules/delivery_os/api/routeSupport'
export const metadata = { GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] } }
export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.projects.view'])
    const evidence = await requireScopedEvidence(resolveRouteEm(ctx), scope, await readRouteId(context), await readRouteId(context, 'evidenceId'))
    const attachmentId = await readRouteId(context, 'attachmentId')
    if (!evidence.attachmentIds.includes(attachmentId)) throw new CrudHttpError(404, { error: 'Not found' })
    if (!ctx.auth) throw new CrudHttpError(401, { error: 'Unauthorized' })
    const service = ctx.container.resolve('attachmentService') as AttachmentService
    if (!service.describeScoped) throw new CrudHttpError(503, { error: 'Attachment service unavailable' })
    const auth = { ...ctx.auth, tenantId: scope.tenantId, orgId: scope.organizationId }
    const description = await service.describeScoped({ attachmentId, auth })
    const preview = evidence.kind === 'screenshot' && evidence.payload.attachmentId === attachmentId && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(description.mimeType)
    const file = await service.readScoped({ attachmentId, auth, expectedOwner: { entityId: description.entityId, recordId: description.recordId }, forceDownload: !preview || new URL(request.url).searchParams.get('download') === '1' })
    return new Response(new Uint8Array(file.buffer), { headers: {
      'Content-Type': preview && new URL(request.url).searchParams.get('download') !== '1' ? description.mimeType : 'application/octet-stream',
      'Content-Disposition': file.contentDisposition, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    } })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.evidence.attachment') }
}
export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Read evidence attachment bytes', pathParams: z.object({ id: uuidSchema, evidenceId: uuidSchema, attachmentId: uuidSchema }),
  methods: { GET: { summary: 'Preview a raster screenshot or download an attachment', description: 'Requires view feature, project/evidence membership, exact tenant/organization and attachment partition access on every read. download=1 forces download. Never follows remote URLs or serves HTML inline.', responses: [{ status: 200, description: 'Authorized bytes', schema: z.string() }], errors: [{ status: 403, description: 'Access denied', schema: deliveryErrorBodySchema }, { status: 404, description: 'Evidence, attachment or file unavailable', schema: deliveryErrorBodySchema }] } },
}
