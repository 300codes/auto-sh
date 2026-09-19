import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { parseDeliveryInput, resolveDeliveryScope, type DeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { DeliveryCommentReply, DeliveryCommentThread } from '@open-mercato/core/modules/delivery_os/data/entities'
import { commentThreadListQuerySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import {
  commentThreadListResponseSchema,
  deliveryFlowErrorBodySchema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  readRouteId,
  requireProjectIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { serializeCommentThread } from '@open-mercato/core/modules/delivery_os/api/serializers'

/** The frozen list item carries at most 500 replies; a longer history is read through the staff card. */
const MAX_REPLIES_PER_THREAD = 500

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const em = resolveRouteEm(ctx)
    const project = await requireProjectIncludingArchived(em, projectId, scope)
    const query = parseDeliveryInput(
      commentThreadListQuerySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    )
    const where = {
      projectId: project.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(query.stageId ? { stageId: query.stageId } : {}),
      ...(query.status ? { sourceStatus: query.status } : {}),
      ...(query.triage ? { triageStatus: query.triage } : {}),
    }
    const threads = await findWithDecryption(
      em,
      DeliveryCommentThread,
      where,
      { orderBy: { updatedAt: 'desc', id: 'desc' }, limit: query.pageSize, offset: (query.page - 1) * query.pageSize },
      scope,
    )
    const total = await em.count(DeliveryCommentThread, where)
    const repliesByThread = await loadReplies(em, threads, scope)
    const items = threads.map((thread) => serializeCommentThread(thread, repliesByThread.get(thread.id) ?? []))
    return NextResponse.json({ items, total })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.comments.list_threads')
  }
}

async function loadReplies(
  em: EntityManager,
  threads: DeliveryCommentThread[],
  scope: DeliveryScope,
): Promise<Map<string, DeliveryCommentReply[]>> {
  const grouped = new Map<string, DeliveryCommentReply[]>()
  if (threads.length === 0) return grouped
  const rows = await findWithDecryption(
    em,
    DeliveryCommentReply,
    { threadId: { $in: threads.map((thread) => thread.id) }, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { sourceCreatedAt: 'asc', revision: 'asc' } },
    scope,
  )
  for (const row of rows) {
    const current = grouped.get(row.threadId) ?? []
    if (current.length >= MAX_REPLIES_PER_THREAD) continue
    current.push(row)
    grouped.set(row.threadId, current)
  }
  return grouped
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Imported design comment threads',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'List the imported comment threads of a project',
      description:
        'F12. Newest activity first, with the staff card id, the triage state, the recorded deferral and the replies of each thread. Filters: `stageId`, `status` (the source thread state), `triage`. `pageSize` is at most 100.',
      query: commentThreadListQuerySchema,
      responses: [{ status: 200, description: 'Comment threads', schema: commentThreadListResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid filter, page or pageSize', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing feature or signed-in user', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
