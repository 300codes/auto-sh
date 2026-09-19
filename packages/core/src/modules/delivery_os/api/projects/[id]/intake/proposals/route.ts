import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { ScopingProposalImportCommandResult } from '@open-mercato/core/modules/delivery_os/commands/intake'
import { DELIVERY_INTAKE_RESOURCE_KIND, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  deliveryFlowErrorBodySchema,
  parseFlowVersioned,
  scopingProposalImportResponseSchema,
  scopingProposalV1Schema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readRouteId,
  resolveDeliveryRouteContext,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { optimisticLockConflictSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

const MAX_PROPOSAL_BODY_BYTES = 1_000_000

const SCOPING_PROPOSAL_SCHEMAS = { [DELIVERY_FLOW_SCHEMA_VERSIONS.scopingProposal]: scopingProposalV1Schema }

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.results.import'] },
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    const parsed = parseFlowVersioned(SCOPING_PROPOSAL_SCHEMAS, await readCappedRouteBody(request, MAX_PROPOSAL_BODY_BYTES))
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status })
    const outcome = await executeDeliveryCommand<ScopingProposalImportCommandResult>(ctx, scope, {
      commandId: 'delivery_os.intake.import_proposal',
      body: { proposal: parsed.data },
      pathInput: { projectId },
      resourceKind: DELIVERY_INTAKE_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    return NextResponse.json(outcome.result, { status: outcome.result.duplicate ? 200 : 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.intake.import_proposal')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Scoping proposals',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Import a ScopingProposal v1 produced by the scoping agent',
      description:
        'F3. The agent proposes; the intake stores questions and a proposal reference (id + hash), never a decision. Same `manifestId` and same content → `200 duplicate: true` without a write and without the lock header; a new manifest requires the intake optimistic-lock header.',
      requestBody: { contentType: 'application/json', schema: scopingProposalV1Schema },
      responses: [
        { status: 201, description: 'Proposal imported', schema: scopingProposalImportResponseSchema },
        { status: 200, description: 'Replay of an already imported proposal (duplicate: true)', schema: scopingProposalImportResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryFlowErrorBodySchema },
        { status: 403, description: 'Missing feature or signed-in user', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        {
          status: 409,
          description: 'idempotency_conflict (same manifestId, other content), or optimistic_lock_conflict (stale intake version)',
          schema: z.union([deliveryFlowErrorBodySchema, optimisticLockConflictSchema]),
        },
        { status: 413, description: 'Body too large or nested too deeply', schema: deliveryFlowErrorBodySchema },
        {
          status: 422,
          description: 'unsupported_schema_version, foreign_reference (projectId differs from the path), manifest_required, target_profile_frozen',
          schema: deliveryFlowErrorBodySchema,
        },
        { status: 428, description: 'Intake version header missing (new manifest only)', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
