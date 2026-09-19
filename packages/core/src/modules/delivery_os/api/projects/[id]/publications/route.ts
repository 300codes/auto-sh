import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import type { PublicationRecordCommandResult } from '@open-mercato/core/modules/delivery_os/commands/publications'
import {
  DELIVERY_PROJECT_RESOURCE_KIND,
  parseDeliveryInput,
  requireScopedProject,
  resolveDeliveryScope,
} from '@open-mercato/core/modules/delivery_os/commands/shared'
import { DeliveryPublication } from '@open-mercato/core/modules/delivery_os/data/entities'
import { publicationListQuerySchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  deliveryFlowErrorBodySchema,
  parseFlowVersioned,
  publicationListResponseSchema,
  publicationRecordResponseSchema,
  publicationResultV1Schema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readRouteId,
  requireProjectIncludingArchived,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { serializePublication } from '@open-mercato/core/modules/delivery_os/api/serializers'

const MAX_PUBLICATION_BODY_BYTES = 1_000_000

const PUBLICATION_SCHEMAS = { [DELIVERY_FLOW_SCHEMA_VERSIONS.publicationResult]: publicationResultV1Schema }

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.results.import'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const em = resolveRouteEm(ctx)
    const project = await requireProjectIncludingArchived(em, projectId, scope)
    const { page, pageSize } = parseDeliveryInput(
      publicationListQuerySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    )
    const where = { projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId }
    const rows = await findWithDecryption(
      em,
      DeliveryPublication,
      where,
      { orderBy: { createdAt: 'desc', id: 'desc' }, limit: pageSize, offset: (page - 1) * pageSize },
      scope,
    )
    const total = await em.count(DeliveryPublication, where)
    return NextResponse.json({ items: rows.map(serializePublication), total })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.publications.list')
  }
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    await requireScopedProject(resolveRouteEm(ctx), projectId, scope)
    const parsed = parseFlowVersioned(PUBLICATION_SCHEMAS, await readCappedRouteBody(request, MAX_PUBLICATION_BODY_BYTES))
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status })
    const outcome = await executeDeliveryCommand<PublicationRecordCommandResult>(ctx, scope, {
      commandId: 'delivery_os.publications.record',
      body: { publication: parsed.data },
      pathInput: { projectId },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: outcome.result.duplicate ? 200 : 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.publications.record')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Project publications',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'List the publications of a project',
      description:
        'F14. Append-only history of recorded publications, newest first; readable also for an archived project. Items carry the stored `PublicationResult v1` fields (without `releaseDecisionId`, which has no column) plus `publicationId`, `deploymentEvidenceId`, `recordedBy` and `createdAt`; `publishedAt` is answered normalised to UTC. `pageSize` is at most 100.',
      query: publicationListQuerySchema,
      responses: [{ status: 200, description: 'Publications', schema: publicationListResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid page or pageSize', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing delivery_os.projects.view', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
      ],
    },
    POST: {
      summary: 'Record a publication of an approved revision',
      description:
        'F14. Body is a `PublicationResult v1`. The named `deployDecisionId` must be an approved deploy decision of this project for the same baseline and `sourceRevision`, and no newer reject may exist on that revision; a pinned project also needs all four approval stages approved and current. The system records a v1 `deployment` evidence row from the same payload in the same transaction (so the report and release consent keep working): it is `verified` only when the publication is verified with method, checkedAt and a project evidence id. The project is checked before the body is read. An identical replay answers `200 duplicate: true` without a write and without the lock header (the consent and stage gates are not re-checked for a replay, because nothing new is recorded); a new publication requires the project optimistic-lock header.',
      requestBody: { contentType: 'application/json', schema: publicationResultV1Schema },
      responses: [
        { status: 201, description: 'Publication recorded', schema: publicationRecordResponseSchema },
        { status: 200, description: 'Identical publication already recorded (duplicate: true)', schema: publicationRecordResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing delivery_os.results.import or signed-in user', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        { status: 409, description: 'Stale project version', schema: optimisticLockConflictSchema },
        { status: 413, description: 'Request body is too large', schema: deliveryFlowErrorBodySchema },
        {
          status: 422,
          description:
            'unsupported_schema_version, deploy_decision_missing (no approved deploy decision for baselineId + sourceRevision, or a newer reject), revision_mismatch (deployDecisionId bound to another revision), stage_not_approved (flow gate, pinned projects), deployment_unverified (verified without method, checkedAt or evidenceId), foreign_reference (baseline, project or verification evidence of another project), unsupported_evidence_kind (verification evidence is not a passed test/scan or approved review), baseline_mismatch (verification evidence recorded on another baseline), revision_mismatch (verification evidence recorded on another sourceRevision)',
          schema: deliveryFlowErrorBodySchema,
        },
        { status: 428, description: 'Project version header missing (new publication only)', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
