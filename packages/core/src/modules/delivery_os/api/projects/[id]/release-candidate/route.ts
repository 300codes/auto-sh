import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DELIVERY_OS_OPENAPI_TAG } from '../../../openapi'
import { deliveryErrorResponse, executeDeliveryCommand, readRouteBody, readRouteId, resolveDeliveryRouteContext, requireProjectIncludingArchived, resolveRouteEm, type DeliveryRouteContext } from '../../../routeSupport'
import { deliveryErrorBodySchema } from '../../../schemas'
import { DELIVERY_PROJECT_RESOURCE_KIND, resolveDeliveryScope } from '../../../../commands/shared'
import { loadReportContext } from '../../../../commands/reportContext'
import type { CandidateCommandResult } from '../../../../commands/candidates'
import { nominateReleaseCandidateSchema, releaseCandidateResponseSchema } from '../../../../lib/reportContracts'
import { uuidSchema } from '../../../../lib/contracts'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.deploy.approve'] },
}
export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const em = resolveRouteEm(ctx)
    const project = await requireProjectIncludingArchived(em, projectId, scope)
    const { currentCandidate } = await loadReportContext(em, scope, project)
    return NextResponse.json({ currentCandidate, projectUpdatedAt: project.updatedAt.toISOString() })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.release_candidates.read') }
}
export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const outcome = await executeDeliveryCommand<CandidateCommandResult>(ctx, scope, { commandId: 'delivery_os.release_candidates.nominate', body: await readRouteBody(request), pathInput: { projectId }, resourceKind: DELIVERY_PROJECT_RESOURCE_KIND, resourceId: projectId, operation: 'custom' })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: 201 })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.release_candidates.nominate') }
}
export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG, summary: 'Explicit release candidate nomination', pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: { summary: 'Read current immutable nomination', responses: [{ status: 200, description: 'Current candidate', schema: releaseCandidateResponseSchema }] },
    POST: { summary: 'Nominate an integrated revision under the project version lock', requestBody: { contentType: 'application/json', schema: nominateReleaseCandidateSchema }, responses: [{ status: 201, description: 'Candidate nominated', schema: releaseCandidateResponseSchema }], errors: [{ status: 409, description: 'Stale project', schema: deliveryErrorBodySchema }, { status: 422, description: 'Baseline, evidence or publish gate invalid', schema: deliveryErrorBodySchema }] },
  },
}
