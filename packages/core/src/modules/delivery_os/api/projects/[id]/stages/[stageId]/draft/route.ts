import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { findScopedIntake, deliveryFlowHttpError, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { toIntakeDocument } from '@open-mercato/core/modules/delivery_os/commands/intake'
import {
  buildDeliveryFlowError,
  deliveryFlowErrorBodySchema,
  flowStageIdSchema,
  stageArtifactV1Schema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { completeDeliveryJson } from '@open-mercato/core/modules/delivery_os/lib/jsonCompletion'
import {
  SCOPE_DRAFT_JSON_CONTRACT,
  SCOPE_DRAFT_SYSTEM_PROMPT,
  buildScopeArtifact,
  buildScopeDraftPrompt,
  scopeDraftSchema,
} from '@open-mercato/core/modules/delivery_os/lib/stageDrafting'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  requireDeliveryFeatures,
  requireRouteStage,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'

const logger = createLogger('delivery_os').child({ route: 'stage-draft' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
}

const draftResponseSchema = z.object({ artifact: stageArtifactV1Schema, tool: z.string().min(1) })

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const { project, stageId } = await requireRouteStage(ctx, scope, context)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.projects.manage'])
    if (stageId !== 'scope') {
      throw deliveryFlowHttpError(buildDeliveryFlowError('stage_unknown', 'Only the scope stage can be drafted from the intake', [{ path: 'stageId', code: 'stage_unknown' }]))
    }
    const intakeRow = await findScopedIntake(resolveRouteEm(ctx), project.id, scope)
    const intake = intakeRow ? toIntakeDocument(intakeRow) : null
    if (!intake || intake.step !== 'submitted') {
      throw deliveryFlowHttpError(buildDeliveryFlowError('intake_step_invalid', 'The brief must be submitted before a stage draft can be generated', [{ path: 'intake.step', code: 'intake_step_invalid' }]))
    }
    const completion = await completeDeliveryJson(
      ctx.container as unknown as { resolve: <T = unknown>(name: string) => T },
      {
        system: [SCOPE_DRAFT_SYSTEM_PROMPT, SCOPE_DRAFT_JSON_CONTRACT].join(' '),
        prompt: buildScopeDraftPrompt(intake, project.name, project.targetProfileId),
      },
      scopeDraftSchema,
    )
    const draft = scopeDraftSchema.safeParse(completion?.value)
    if (!draft.success) {
      logger.info('stage draft generation did not return a usable document', { projectId: project.id, tool: completion?.tool ?? null })
      return NextResponse.json(
        buildDeliveryFlowError('stage_unknown', 'The connected agent did not return a usable scope draft').body,
        { status: 503 },
      )
    }
    const artifact = buildScopeArtifact({
      draft: draft.data,
      projectId: project.id,
      intake,
      targetProfileId: project.targetProfileId,
      targetProfileVersion: project.targetProfileVersion,
      producedBy: { tool: completion?.tool ?? 'agent-cli', sessionRef: null },
    })
    return NextResponse.json({ artifact, tool: completion?.tool ?? 'agent-cli' })
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.stage_draft_failed' })
    return deliveryErrorResponse(error, 'delivery_os.stages.draft_artifact')
  }
}

const pathParams = z.object({ id: uuidSchema, stageId: flowStageIdSchema })

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Stage draft',
  pathParams,
  methods: {
    POST: {
      summary: 'Draft a stage artifact from the submitted brief',
      description:
        'Builds a `StageArtifact v1` proposal for the `scope` stage out of the submitted intake, using the agent CLI the operator connected (falling back to a configured API model). Nothing is persisted: the operator reviews the document and records it through the artifacts route.',
      responses: [{ status: 200, description: 'Draft artifact for review', schema: draftResponseSchema }],
      errors: [
        { status: 403, description: 'Missing delivery_os.projects.manage', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        { status: 422, description: 'flow_not_pinned, stage_unknown (not the scope stage), intake_step_invalid (brief not submitted)', schema: deliveryFlowErrorBodySchema },
        { status: 503, description: 'No connected agent answered with a usable draft', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
