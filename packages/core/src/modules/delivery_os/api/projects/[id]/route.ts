import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { DeliveryBaseline, DeliveryDecision, DeliveryEvidence, DeliveryTask } from '@open-mercato/core/modules/delivery_os/data/entities'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { deriveProjectStatus } from '@open-mercato/core/modules/delivery_os/lib/projectStatus'
import { DELIVERY_OS_OPENAPI_TAG } from '../../openapi'
import {
  deliveryErrorResponse,
  readRouteId,
  requireProjectIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '../../routeSupport'
import { deliveryErrorBodySchema, projectDetailSchema } from '../../schemas'
import { readBaselineAcIds, serializeProjectDetail } from '../../serializers'

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
    const where = { projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId }
    const baselines = await findWithDecryption(em, DeliveryBaseline, where, undefined, scope)
    const tasks = await findWithDecryption(em, DeliveryTask, { ...where, deletedAt: null }, undefined, scope)
    const evidence = await findWithDecryption(
      em,
      DeliveryEvidence,
      { ...where, kind: 'result_manifest' },
      { fields: ['id', 'kind', 'baselineId', 'sourceRevision', 'createdAt'] },
      scope,
    )
    const decisions = await findWithDecryption(em, DeliveryDecision, { ...where, kind: 'release' }, undefined, scope)
    const summary = deriveProjectStatus({
      project: { deletedAt: project.deletedAt ?? null, activeBaselineId: project.activeBaselineId ?? null },
      baselines: baselines.map((baseline) => ({ id: baseline.id, acIds: readBaselineAcIds(baseline) })),
      tasks,
      evidence: evidence.map((item) => ({
        kind: item.kind,
        baselineId: item.baselineId,
        sourceRevision: item.sourceRevision ?? null,
        createdAt: item.createdAt,
      })),
      decisions: decisions.map((decision) => ({
        kind: decision.kind,
        verdict: decision.verdict,
        sourceRevision: decision.sourceRevision ?? null,
        decidedAt: decision.decidedAt,
      })),
    })
    return NextResponse.json(serializeProjectDetail(project, summary))
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.projects.detail')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Delivery project detail',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'Get a delivery project',
      description:
        'Returns the project with its draft specification, the computed status and the acceptance-criteria progress (proven of total). Archived projects stay readable.',
      responses: [{ status: 200, description: 'Project detail', schema: projectDetailSchema }],
      errors: [{ status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema }],
    },
  },
}
