import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { deliveryHttpError, requireScopedProject, resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { DeliveryBaseline } from '@open-mercato/core/modules/delivery_os/data/entities'
import {
  baselineContentV1Schema,
  buildDeliveryError,
  deliveryErrorBodySchema,
  planProposalV1Schema,
  uuidSchema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { getLatestTargetProfile, getTargetProfile } from '@open-mercato/core/modules/delivery_os/lib/targetProfiles'
import { completeDeliveryJson } from '@open-mercato/core/modules/delivery_os/lib/jsonCompletion'
import {
  PLAN_DRAFT_JSON_CONTRACT,
  PLAN_DRAFT_SYSTEM_PROMPT,
  buildPlanDraftPrompt,
  buildPlanProposal,
  normalizePlanDraft,
  planDraftSchema,
  uncoveredCriteria,
} from '@open-mercato/core/modules/delivery_os/lib/planDrafting'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  readRouteId,
  requireDeliveryFeatures,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'

const logger = createLogger('delivery_os').child({ route: 'plan-draft' })

/**
 * The paths a task may write come from the pinned target profile, never from a guess: the import refuses anything
 * outside those roots, so the agent has to be told the real ones.
 */
function pathHintFor(profileId: string, profileVersion: number): string {
  const profile = getTargetProfile(profileId, profileVersion) ?? getLatestTargetProfile(profileId)
  if (!profile) return 'A source repository; keep each task inside the directories it owns.'
  return `${profile.label}. Every allowedPaths entry must be one of these roots, spelled exactly like this: ${profile.allowedPathRoots.join(', ')}.`
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
}

const planDraftResponseSchema = z.object({
  proposal: planProposalV1Schema,
  tool: z.string().min(1),
  uncoveredAcIds: z.array(z.string()),
})

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.projects.manage'])
    const em = resolveRouteEm(ctx)
    const project = await requireScopedProject(em, projectId, scope)
    if (!project.activeBaselineId) {
      throw deliveryHttpError(buildDeliveryError('baseline_not_approved', 'The project has no active baseline to plan against', [{ path: 'activeBaselineId', code: 'baseline_not_approved' }]))
    }
    const baselineRow = await findOneWithDecryption(
      em,
      DeliveryBaseline,
      { id: project.activeBaselineId, projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      undefined,
      scope,
    )
    const baseline = baselineContentV1Schema.safeParse(baselineRow?.content)
    if (!baselineRow || !baseline.success) {
      throw deliveryHttpError(buildDeliveryError('baseline_not_approved', 'The active baseline cannot be read', [{ path: 'activeBaselineId', code: 'baseline_unreadable' }]))
    }
    const acceptanceCriterionIds = baseline.data.acceptanceCriteria.map((criterion) => criterion.id)
    const completion = await completeDeliveryJson(
      ctx.container as unknown as { resolve: <T = unknown>(name: string) => T },
      {
        system: [PLAN_DRAFT_SYSTEM_PROMPT, PLAN_DRAFT_JSON_CONTRACT].join(' '),
        prompt: buildPlanDraftPrompt({
          baseline: baseline.data,
          projectName: project.name,
          targetProfileId: project.targetProfileId,
          pathHint: pathHintFor(project.targetProfileId, project.targetProfileVersion),
        }),
      },
      planDraftSchema,
    )
    const draft = planDraftSchema.safeParse(normalizePlanDraft(completion?.value))
    if (!draft.success) {
      logger.info('plan drafting did not return a usable proposal', {
        projectId: project.id,
        tool: completion?.tool ?? null,
        issues: draft.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).slice(0, 10),
      })
      return NextResponse.json(
        buildDeliveryError('validation_failed', 'The connected agent did not return a usable plan').body,
        { status: 503 },
      )
    }
    const proposal = buildPlanProposal({
      draft: draft.data,
      projectId: project.id,
      baselineId: baselineRow.id,
      baselineHash: baselineRow.contentHash,
      acceptanceCriterionIds,
      manifestId: `plan-${randomUUID()}`,
      producedBy: { tool: completion?.tool ?? 'agent-cli', sessionRef: null },
    })
    return NextResponse.json({
      proposal,
      tool: completion?.tool ?? 'agent-cli',
      uncoveredAcIds: uncoveredCriteria(draft.data, acceptanceCriterionIds),
    })
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.plan_draft_failed' })
    return deliveryErrorResponse(error, 'delivery_os.plan.draft')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Plan draft',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    POST: {
      summary: 'Draft a plan proposal from the active baseline',
      description:
        'Builds a `PlanProposal v1` out of the active baseline with the agent CLI the operator connected, falling back to a configured API model. Nothing is persisted: the operator reviews the manifest, sees which acceptance criteria it leaves uncovered, and imports it through the tasks route.',
      responses: [{ status: 200, description: 'Plan proposal for review', schema: planDraftResponseSchema }],
      errors: [
        { status: 403, description: 'Missing delivery_os.projects.manage', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema },
        { status: 422, description: 'The project has no readable active baseline', schema: deliveryErrorBodySchema },
        { status: 503, description: 'No connected agent answered with a usable plan', schema: deliveryErrorBodySchema },
      ],
    },
  },
}
