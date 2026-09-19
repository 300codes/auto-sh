import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import type { StageDecisionCommandResult } from '@open-mercato/core/modules/delivery_os/commands/stages'
import { DELIVERY_PROJECT_RESOURCE_KIND, parseDeliveryInput, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { DeliveryFlowStageDecision } from '@open-mercato/core/modules/delivery_os/data/entities'
import { stageHistoryListQuerySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import {
  deliveryFlowErrorBodySchema,
  deliveryFlowErrorFromZod,
  flowStageIdSchema,
  stageDecisionListResponseSchema,
  stageDecisionRequestSchema,
  stageDecisionResponseSchema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readIdempotencyKeyHeader,
  readCappedRouteBody,
  requireRouteStage,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { serializeStageDecision } from '@open-mercato/core/modules/delivery_os/api/serializers'

const MAX_DECISION_BODY_BYTES = 256_000

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.stages.approve'] },
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
      DeliveryFlowStageDecision,
      where,
      { orderBy: { decidedAt: 'desc', id: 'desc' }, limit: pageSize, offset: (page - 1) * pageSize },
      scope,
    )
    const total = await em.count(DeliveryFlowStageDecision, where)
    return NextResponse.json({ items: rows.map(serializeStageDecision), total })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.stages.list_decisions')
  }
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const { project, stageId } = await requireRouteStage(ctx, scope, context)
    const idempotencyKey = readIdempotencyKeyHeader(request)
    const parsed = stageDecisionRequestSchema.safeParse(await readCappedRouteBody(request, MAX_DECISION_BODY_BYTES))
    if (!parsed.success) {
      const failure = deliveryFlowErrorFromZod(parsed.error)
      return NextResponse.json(failure.body, { status: failure.status })
    }
    const outcome = await executeDeliveryCommand<StageDecisionCommandResult>(ctx, scope, {
      commandId: 'delivery_os.stages.decide',
      body: { decision: parsed.data },
      pathInput: { projectId: project.id, stageId, idempotencyKey },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: project.id,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: outcome.result.duplicate ? 200 : 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.stages.decide')
  }
}

const pathParams = z.object({ id: uuidSchema, stageId: flowStageIdSchema })

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Stage decisions',
  pathParams,
  methods: {
    GET: {
      summary: 'List the decisions of a stage',
      description:
        'F9. Append-only decision history of one approval stage, newest first; the latest decision wins. Client approver fields are decrypted for the session scope. `pageSize` is at most 100.',
      query: stageHistoryListQuerySchema,
      responses: [{ status: 200, description: 'Decisions', schema: stageDecisionListResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid page or pageSize', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        { status: 422, description: 'flow_not_pinned, stage_unknown', schema: deliveryFlowErrorBodySchema },
      ],
    },
    POST: {
      summary: 'Approve or reject the current artifact of a stage',
      description:
        'F8. Needs `delivery_os.stages.approve` plus the stage `approverFeatures` of the pinned template, and the `Idempotency-Key` header. The decision binds the artifact hash and version; the same key with the same body answers `200 duplicate: true` without a write and without the lock header; a new key requires the project optimistic-lock header and always writes a new row (latest decision wins). Stages with `requiresClientApproval` need `clientApproval` (approver name and evidence) to approve.',
      requestBody: { contentType: 'application/json', schema: stageDecisionRequestSchema },
      responses: [
        { status: 201, description: 'Decision recorded', schema: stageDecisionResponseSchema },
        { status: 200, description: 'Replay of the same key and body (duplicate: true)', schema: stageDecisionResponseSchema },
      ],
      errors: [
        { status: 400, description: 'idempotency_key_required or validation failed', schema: deliveryFlowErrorBodySchema },
        { status: 413, description: 'Request body is too large', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing stages.approve or a stage approver feature', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        {
          status: 409,
          description:
            'idempotency_conflict (same key, other body), subject_hash_mismatch, stage_artifact_stale, or optimistic_lock_conflict (stale project version)',
          schema: z.union([deliveryFlowErrorBodySchema, optimisticLockConflictSchema]),
        },
        {
          status: 422,
          description:
            'flow_not_pinned, stage_unknown, stage_not_approved, stage_dependency_stale, client_approval_required, blocking_comments_open, reason_required, foreign_reference',
          schema: deliveryFlowErrorBodySchema,
        },
        { status: 428, description: 'Project version header missing (new key only)', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
