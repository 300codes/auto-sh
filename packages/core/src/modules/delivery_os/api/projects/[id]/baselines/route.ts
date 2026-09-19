import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import type { BaselineCommandResult } from '@open-mercato/core/modules/delivery_os/commands/baselines'
import { DELIVERY_PROJECT_RESOURCE_KIND, parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { DeliveryBaseline, DeliveryDecision } from '@open-mercato/core/modules/delivery_os/data/entities'
import { baselineCreateSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readRouteId,
  requireDeliveryFeatures,
  requireProjectIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import {
  baselineCreateResponseSchema,
  baselineListResponseSchema,
  deliveryErrorBodySchema,
  optimisticLockConflictSchema,
} from '@open-mercato/core/modules/delivery_os/api/schemas'
import { serializeBaseline } from '@open-mercato/core/modules/delivery_os/api/serializers'

const FEATURE_BY_SOURCE = {
  manual: 'delivery_os.projects.manage',
  requirements_proposal: 'delivery_os.results.import',
} as const

const COMMAND_BY_SOURCE = {
  manual: 'delivery_os.baselines.create',
  requirements_proposal: 'delivery_os.baselines.import_requirements',
} as const

const MAX_BASELINE_BODY_BYTES = 8_000_000

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const em = resolveRouteEm(ctx)
    const project = await requireProjectIncludingArchived(em, projectId, scope)
    const where = { projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId }
    const baselines = await findWithDecryption(em, DeliveryBaseline, where, { orderBy: { version: 'desc' } }, scope)
    const decisions = await findWithDecryption(
      em,
      DeliveryDecision,
      { ...where, subjectType: 'baseline' },
      { orderBy: { decidedAt: 'asc' } },
      scope,
    )
    const items = baselines.map((baseline) => serializeBaseline(baseline, decisions, project.activeBaselineId ?? null))
    return NextResponse.json({ items, total: items.length })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.baselines.list')
  }
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const body = parseDeliveryInput(baselineCreateSchema, await readCappedRouteBody(request, MAX_BASELINE_BODY_BYTES))
    await requireDeliveryFeatures(ctx, scope, [FEATURE_BY_SOURCE[body.source]])
    const outcome = await executeDeliveryCommand<BaselineCommandResult>(ctx, scope, {
      commandId: COMMAND_BY_SOURCE[body.source],
      body,
      pathInput: { projectId },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { baselineId, version, contentHash, duplicate, openCommentIds, projectUpdatedAt } = outcome.result
    return NextResponse.json(
      { baselineId, version, contentHash, duplicate, openCommentIds, projectUpdatedAt },
      { status: duplicate ? 200 : 201 },
    )
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.baselines.write')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Project baselines',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'List the baselines of a project',
      description: 'Append-only baseline versions, newest first, each with its content, decisions and the active flag.',
      responses: [{ status: 200, description: 'Baselines', schema: baselineListResponseSchema }],
      errors: [{ status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema }],
    },
    POST: {
      summary: 'Freeze the draft specification or import a requirements proposal into the next baseline',
      description:
        '`source: manual` needs `delivery_os.projects.manage` and freezes the project draft. `source: requirements_proposal` needs `delivery_os.results.import`: the `RequirementsProposal v1` manifest replaces requirements, acceptance criteria, questions and risks of the draft and the merged draft is frozen as the next version in the same transaction (screens are optional for this source). Both need the project optimistic-lock header, except a replay: the same `manifestId` with the same content answers `200 duplicate: true` with the first baseline, writes nothing and needs no current header. `projectUpdatedAt` is the project version to send next.',
      requestBody: { contentType: 'application/json', schema: baselineCreateSchema },
      responses: [
        { status: 201, description: 'Baseline created', schema: baselineCreateResponseSchema },
        { status: 200, description: 'Identical content or manifest already frozen (duplicate)', schema: baselineCreateResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed or unsupported source', schema: deliveryErrorBodySchema },
        { status: 403, description: 'Missing the feature for this source', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema },
        { status: 409, description: 'Stale project version', schema: optimisticLockConflictSchema },
        { status: 409, description: '`idempotency_conflict`: the manifestId was imported with different content', schema: deliveryErrorBodySchema },
        { status: 413, description: 'Request body is too large', schema: deliveryErrorBodySchema },
        { status: 422, description: 'Draft cannot be frozen, unsupported manifest version or foreign project reference', schema: deliveryErrorBodySchema },
        { status: 428, description: 'Project version header missing', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
