import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { DeliveryIntake, DeliveryProject } from '../data/entities'
import { BRIEF_STRUCTURING_SYSTEM_PROMPT, buildBriefStructuringPrompt, extractedBriefSchema } from '../lib/briefStructuring'

const logger = createLogger('delivery_os').child({ subscriber: 'project-brief-intake' })

export const metadata = {
  event: 'delivery_os.project.created',
  persistent: true,
  id: 'delivery_os:project-brief-intake',
}

type ProjectCreatedPayload = { projectId: string; tenantId: string; organizationId: string }
type Scope = { tenantId: string; organizationId: string }
type Container = { resolve: <T = unknown>(name: string) => T }

const MAX_BRIEF_CHARS = 20000

function buildContext(container: Container, scope: Scope): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: null, tenantId: scope.tenantId, orgId: scope.organizationId } as unknown as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

async function structureBrief(container: Container, brief: string, targetProfileId: string): Promise<unknown | null> {
  const [{ createModelFactory }, { generateObject }] = await Promise.all([
    import('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'),
    import('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-sdk'),
  ])
  const resolution = createModelFactory(container as never).resolveModel({ moduleId: 'delivery_os' })
  const generated = await generateObject({
    model: resolution.model as Parameters<typeof generateObject>[0]['model'],
    schema: extractedBriefSchema,
    system: BRIEF_STRUCTURING_SYSTEM_PROMPT,
    prompt: buildBriefStructuringPrompt(brief.slice(0, MAX_BRIEF_CHARS), targetProfileId),
  })
  return generated.object
}

export default async function handle(payload: ProjectCreatedPayload, container: Container): Promise<void> {
  if (!payload?.projectId || !payload?.tenantId || !payload?.organizationId) return
  const scope: Scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const em = (container.resolve('em') as EntityManager).fork()
  const project = await findOneWithDecryption(em, DeliveryProject, { id: payload.projectId, ...scope }, undefined, scope)
  const brief = typeof project?.brief === 'string' ? project.brief.trim() : ''
  if (!project || project.inputMode !== 'from_brief' || brief.length === 0) return
  if (await em.findOne(DeliveryIntake, { projectId: project.id, ...scope })) return

  let extracted: unknown
  try {
    extracted = await structureBrief(container, brief, project.targetProfileId)
  } catch (error) {
    logger.info('brief structuring unavailable; the wizard keeps the plain brief', {
      projectId: project.id,
      reason: error instanceof Error ? error.message : String(error),
    })
    return
  }

  const parsed = extractedBriefSchema.safeParse(extracted)
  if (!parsed.success) {
    logger.warn('brief structuring returned an unusable object', { projectId: project.id })
    return
  }

  try {
    const commandBus = container.resolve('commandBus') as CommandBus
    await commandBus.execute('delivery_os.intake.seed_from_brief', {
      input: { projectId: project.id, extracted: parsed.data },
      ctx: buildContext(container, scope),
    })
    logger.info('seeded the intake wizard from the project brief', { projectId: project.id })
  } catch (error) {
    logger.error('failed to seed the intake wizard from the project brief', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.intake_seed_failed' })
  }
}
