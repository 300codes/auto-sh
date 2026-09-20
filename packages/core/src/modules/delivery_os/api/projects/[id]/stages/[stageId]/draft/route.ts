import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { findScopedIntake, deliveryFlowHttpError, resolveDeliveryScope, type DeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { toIntakeDocument } from '@open-mercato/core/modules/delivery_os/commands/intake'
import { loadFlowGateStates } from '@open-mercato/core/modules/delivery_os/commands/flowGate'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryFlowStageArtifact, type DeliveryProject } from '@open-mercato/core/modules/delivery_os/data/entities'
import {
  buildDeliveryFlowError,
  deliveryFlowErrorBodySchema,
  flowStageIdSchema,
  scopeContentSchema,
  stageArtifactV1Schema,
  uuidSchema,
  type FlowStageId,
  type ScopeContent,
  type StageArtifactDependency,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { completeDeliveryJson } from '@open-mercato/core/modules/delivery_os/lib/jsonCompletion'
import { stageRenderDir, storeStageRenders } from '@open-mercato/core/modules/delivery_os/lib/stageRenders'
import { figmaDesignResultSchema, tryResolveDesignAgent } from '@open-mercato/core/modules/delivery_os/lib/designAgent'
import {
  SCOPE_DRAFT_JSON_CONTRACT,
  SCOPE_DRAFT_SYSTEM_PROMPT,
  buildDesignAgentInstructions,
  buildDesignArtifact,
  buildDesignDraftPrompt,
  buildScopeArtifact,
  buildScopeDraftPrompt,
  isDesignStageId,
  readDesignFileKey,
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
import type { EntityManager } from '@mikro-orm/postgresql'

const logger = createLogger('delivery_os').child({ route: 'stage-draft' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
}

const draftResponseSchema = z.object({ artifact: stageArtifactV1Schema, tool: z.string().min(1) })

type UpstreamBinding = { dependsOn: StageArtifactDependency[]; scope: ScopeContent | null; fileKey: string | null }

/**
 * Binds the draft to the artifacts its stage depends on, exactly as `stages.create_artifact` will demand: every
 * upstream stage of the pinned template must be approved and the draft must carry its current artifact.
 */
async function resolveUpstream(em: EntityManager, project: DeliveryProject, stageId: FlowStageId, scope: DeliveryScope): Promise<UpstreamBinding> {
  const loaded = await loadFlowGateStates(em, project, scope)
  if (loaded === null || loaded === 'unreadable') {
    throw deliveryFlowHttpError(buildDeliveryFlowError('flow_not_pinned', 'The project has no readable pinned process', [{ path: 'flowTemplateId', code: 'flow_not_pinned' }]))
  }
  const templateStage = loaded.template.stages.find((stage) => stage.kind === stageId)
  const upstreamIds = (templateStage?.dependsOn ?? []).filter((id): id is FlowStageId => flowStageIdSchema.safeParse(id).success)
  const dependsOn: StageArtifactDependency[] = []
  let scopeContent: ScopeContent | null = null
  for (const upstreamId of upstreamIds) {
    const state = loaded.states[upstreamId]
    if (state.currency !== 'approved' || !state.currentArtifact) {
      throw deliveryFlowHttpError(buildDeliveryFlowError('stage_not_approved', `Upstream stage ${upstreamId} is not approved and current`, [{ path: `dependsOn.${upstreamId}`, code: 'stage_not_approved' }]))
    }
    dependsOn.push({ stageId: upstreamId, artifactId: state.currentArtifact.artifactId, version: state.currentArtifact.version, contentHash: state.currentArtifact.contentHash })
  }
  const approvedScope = loaded.states.scope.approvedArtifact
  if (approvedScope) scopeContent = scopeContentSchema.safeParse((await loadArtifactRow(em, project.id, approvedScope.artifactId, scope))?.content).data ?? null
  const designContents: unknown[] = []
  for (const designStage of ['design_system_ui', 'key_visual', 'ux'] as const) {
    const ref = loaded.states[designStage].currentArtifact
    if (!ref) continue
    const row = await loadArtifactRow(em, project.id, ref.artifactId, scope)
    if (row) designContents.push(row.content)
  }
  return { dependsOn, scope: scopeContent, fileKey: readDesignFileKey(designContents) }
}

function loadArtifactRow(em: EntityManager, projectId: string, artifactId: string, scope: DeliveryScope): Promise<DeliveryFlowStageArtifact | null> {
  return findOneWithDecryption(
    em,
    DeliveryFlowStageArtifact,
    { id: artifactId, projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const { project, stageId } = await requireRouteStage(ctx, scope, context)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.projects.manage'])
    const em = resolveRouteEm(ctx)
    const intakeRow = await findScopedIntake(em, project.id, scope)
    const intake = intakeRow ? toIntakeDocument(intakeRow) : null
    if (!intake || intake.step !== 'submitted') {
      throw deliveryFlowHttpError(buildDeliveryFlowError('intake_step_invalid', 'The brief must be submitted before a stage draft can be generated', [{ path: 'intake.step', code: 'intake_step_invalid' }]))
    }
    const container = ctx.container as unknown as { resolve: <T = unknown>(name: string) => T }
    const producedByTool = (tool: string | undefined) => ({ tool: tool ?? 'agent-cli', sessionRef: null })

    if (stageId === 'scope') {
      const completion = await completeDeliveryJson(
        container,
        {
          system: [SCOPE_DRAFT_SYSTEM_PROMPT, SCOPE_DRAFT_JSON_CONTRACT].join(' '),
          prompt: buildScopeDraftPrompt(intake, project.name, project.targetProfileId),
        },
        scopeDraftSchema,
      )
      const draft = scopeDraftSchema.safeParse(completion?.value)
      if (!draft.success) return unusableDraft(project.id, stageId, completion?.tool ?? null)
      const artifact = buildScopeArtifact({
        draft: draft.data,
        projectId: project.id,
        intake,
        targetProfileId: project.targetProfileId,
        targetProfileVersion: project.targetProfileVersion,
        producedBy: producedByTool(completion?.tool),
      })
      return NextResponse.json({ artifact, tool: completion?.tool ?? 'agent-cli' })
    }

    if (!isDesignStageId(stageId)) {
      throw deliveryFlowHttpError(buildDeliveryFlowError('stage_unknown', 'This stage cannot be drafted', [{ path: 'stageId', code: 'stage_unknown' }]))
    }
    const agent = tryResolveDesignAgent(container)
    if (!agent) {
      throw deliveryFlowHttpError(buildDeliveryFlowError('stage_unknown', 'No design agent is connected on this host', [{ path: 'figma', code: 'mcp_not_configured' }]))
    }
    const upstream = await resolveUpstream(em, project, stageId, scope)
    const answer = await agent.design({
      stageId,
      projectName: project.name,
      targetProfileId: project.targetProfileId,
      fileKey: upstream.fileKey,
      brief: buildDesignDraftPrompt({ stageId, intake, scope: upstream.scope, projectName: project.name, targetProfileId: project.targetProfileId }),
      instructions: buildDesignAgentInstructions(stageId),
      renderDir: stageRenderDir(project.id, stageId),
    })
    const design = figmaDesignResultSchema.safeParse(answer)
    if (!design.success) {
      logger.info('the design agent reported something the contract refuses', {
        projectId: project.id,
        stageId,
        answer: JSON.stringify(answer)?.slice(0, 1000) ?? null,
        issues: design.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).slice(0, 10),
      })
      return unusableDraft(project.id, stageId, 'figma-mcp')
    }
    const screens = await storeStageRenders({
      em,
      dataEngine: ctx.container.resolve('dataEngine') as Parameters<typeof storeStageRenders>[0]['dataEngine'],
      design: design.data,
      projectId: project.id,
      stageId,
      scope,
    })
    const artifact = buildDesignArtifact({
      stageId,
      design: design.data,
      projectId: project.id,
      dependsOn: upstream.dependsOn,
      producedBy: { tool: 'figma-mcp', sessionRef: design.data.fileKey },
      screens,
    })
    return NextResponse.json({ artifact, tool: 'figma-mcp' })
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.stage_draft_failed' })
    return deliveryErrorResponse(error, 'delivery_os.stages.draft_artifact')
  }
}

function unusableDraft(projectId: string, stageId: FlowStageId, tool: string | null): Response {
  logger.info('stage draft generation did not return a usable document', { projectId, stageId, tool })
  return NextResponse.json(
    buildDeliveryFlowError('stage_unknown', 'The connected agent did not return a usable stage draft').body,
    { status: 503 },
  )
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
        'Builds a `StageArtifact v1` proposal for the path stage out of the submitted intake and the approved upstream artifacts, using the agent CLI the operator connected (falling back to a configured API model). Scope drafts carry requirements and acceptance criteria; design stages carry prose only — screens and Figma refs come from a real design import. Nothing is persisted: the operator reviews the document and records it through the artifacts route.',
      responses: [{ status: 200, description: 'Draft artifact for review', schema: draftResponseSchema }],
      errors: [
        { status: 403, description: 'Missing delivery_os.projects.manage', schema: deliveryFlowErrorBodySchema },
        { status: 404, description: 'Project not found in this scope', schema: deliveryFlowErrorBodySchema },
        { status: 422, description: 'flow_not_pinned, stage_unknown, intake_step_invalid (brief not submitted), stage_not_approved (upstream stage not approved and current)', schema: deliveryFlowErrorBodySchema },
        { status: 503, description: 'No connected agent answered with a usable draft', schema: deliveryFlowErrorBodySchema },
      ],
    },
  },
}
