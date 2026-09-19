import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import type { StageArtifactCommandResult } from '@open-mercato/core/modules/delivery_os/commands/stages'
import { DELIVERY_PROJECT_RESOURCE_KIND, parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { DeliveryFlowStageArtifact } from '@open-mercato/core/modules/delivery_os/data/entities'
import { stageHistoryListQuerySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  deliveryFlowErrorBodySchema,
  flowStageIdSchema,
  parseFlowVersioned,
  stageArtifactCreateResponseSchema,
  stageArtifactListResponseSchema,
  stageArtifactV1Schema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  requireDeliveryFeatures,
  requireRouteStage,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { serializeStageArtifact } from '@open-mercato/core/modules/delivery_os/api/serializers'

const MAX_ARTIFACT_BODY_BYTES = 1_000_000

const STAGE_ARTIFACT_SCHEMAS = { [DELIVERY_FLOW_SCHEMA_VERSIONS.stageArtifact]: stageArtifactV1Schema }

const FEATURE_BY_SOURCE = {
  manual: 'delivery_os.projects.manage',
  intake: 'delivery_os.projects.manage',
  agent: 'delivery_os.results.import',
  figma: 'delivery_os.results.import',
} as const

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const { project, stageId } = await requireRouteStage(ctx, scope, context)
    const { page, pageSize } = parseDeliveryInput(
      stageHistoryListQuerySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    )
    const em = resolveRouteEm(ctx)
    const where = { projectId: project.id, stageId, tenantId: scope.tenantId, organizationId: scope.organizationId }
    const rows = await findWithDecryption(
      em,
      DeliveryFlowStageArtifact,
      where,
      { orderBy: { version: 'desc' }, limit: pageSize, offset: (page - 1) * pageSize },
      scope,
    )
    const total = await em.count(DeliveryFlowStageArtifact, where)
    return NextResponse.json({ items: rows.map(serializeStageArtifact), total })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.stages.list_artifacts')
  }
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const { project, stageId } = await requireRouteStage(ctx, scope, context)
    const parsed = parseFlowVersioned(STAGE_ARTIFACT_SCHEMAS, await readCappedRouteBody(request, MAX_ARTIFACT_BODY_BYTES))
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status })
    await requireDeliveryFeatures(ctx, scope, [FEATURE_BY_SOURCE[parsed.data.source]])
    const outcome = await executeDeliveryCommand<StageArtifactCommandResult>(ctx, scope, {
      commandId: 'delivery_os.stages.create_artifact',
      body: { artifact: parsed.data },
      pathInput: { projectId: project.id, stageId },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: project.id,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: outcome.result.duplicate ? 200 : 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.stages.create_artifact')
  }
}

const pathParams = z.object({ id: uuidSchema, stageId: flowStageIdSchema })

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Stage artifacts',
  pathParams,
  methods: {
    GET: {
      summary: 'List the artifact versions of a stage',
      description:
        'F9. History of one approval stage, newest version first; nothing is ever deleted. `pageSize` is at most 100. The path `stageId` must be an approval stage of the pinned process template.',
      query: stageHistoryListQuerySchema,
      responses: [{ status: 200, description: 'Artifact versions', schema: stageArtifactListResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid page or pageSize', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        { status: 422, description: 'flow_not_pinned, stage_unknown', schema: deliveryFlowErrorBodySchema },
      ],
    },
    POST: {
      summary: 'Record a new artifact version for a stage',
      description:
        'F7. Body is a `StageArtifact v1` whose `stageId` equals the path. `source: manual|intake` needs `delivery_os.projects.manage`, `agent|figma` needs `delivery_os.results.import`. The path stage is checked before the body is read. Identical content answers `200 duplicate: true` without a write and without the lock header; a new version requires the project optimistic-lock header and makes every downstream approval stale (`downstreamNowStale`).',
      requestBody: { contentType: 'application/json', schema: stageArtifactV1Schema },
      responses: [
        { status: 201, description: 'Artifact version recorded', schema: stageArtifactCreateResponseSchema },
        { status: 200, description: 'Same content already recorded (duplicate: true)', schema: stageArtifactCreateResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed (including a stageId in the body that is not an approval stage)', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing the feature for this source', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        {
          status: 409,
          description: 'attempt_active, reconciliation_required, stage_artifact_stale, or optimistic_lock_conflict (stale project version)',
          schema: z.union([deliveryFlowErrorBodySchema, optimisticLockConflictSchema]),
        },
        { status: 413, description: 'Request body is too large', schema: deliveryFlowErrorBodySchema },
        {
          status: 422,
          description:
            'unsupported_schema_version, flow_not_pinned, stage_unknown, foreign_reference, foreign_dependency, stage_not_approved, stage_dependency_stale, target_profile_frozen, unknown_ac, attachment_*',
          schema: deliveryFlowErrorBodySchema,
        },
        { status: 428, description: 'Project version header missing (new version only)', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
