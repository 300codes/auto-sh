import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('delivery_agents').child({ component: 'attempt-workflow' })

export const DELIVERY_AGENTS_WORKFLOW_ID = 'delivery-cezar-attempt'
export const DELIVERY_AGENTS_OWNER_MODULE = 'delivery_agents'
export const DELIVERY_AGENTS_OWNER_ID = 'delivery-cezar-attempt'
export const DELIVERY_AGENTS_WAIT_STEP_ID = 'wait_for_evidence'
export const DELIVERY_AGENTS_SIGNAL_NAME = 'evidence-ready'

type WorkflowDefinitionAuthoringLike = {
  upsertOwnedDefinition: (
    em: EntityManager,
    input: {
      ownerModule: string
      ownerId: string
      workflowId: string
      workflowName: string
      description?: string | null
      definition: unknown
      metadata?: Record<string, unknown> | null
      grantedFeatures?: string[] | null
      enabled?: boolean
      tenantId: string
      organizationId: string
      actorUserId?: string | null
    },
  ) => Promise<{ ok: boolean; definition: { workflowId: string }; created?: boolean }>
}

function tryResolveAuthoring(container: AwilixContainer): WorkflowDefinitionAuthoringLike | null {
  try {
    const service = container.resolve('workflowDefinitionAuthoring') as WorkflowDefinitionAuthoringLike | null
    return service && typeof service.upsertOwnedDefinition === 'function' ? service : null
  } catch {
    return null
  }
}

function buildCezarAttemptWorkflowDefinition(): unknown {
  return {
    interpolation: 'strict',
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: DELIVERY_AGENTS_WAIT_STEP_ID,
        stepName: 'Wait for Evidence',
        stepType: 'WAIT_FOR_SIGNAL',
        signalConfig: { signalName: DELIVERY_AGENTS_SIGNAL_NAME },
      },
      { stepId: 'end', stepName: 'Done', stepType: 'END' },
    ],
    transitions: [
      {
        transitionId: 't_start',
        transitionName: 'Start',
        fromStepId: 'start',
        toStepId: DELIVERY_AGENTS_WAIT_STEP_ID,
      },
      {
        transitionId: 't_done',
        transitionName: 'Done',
        fromStepId: DELIVERY_AGENTS_WAIT_STEP_ID,
        toStepId: 'end',
      },
    ],
  }
}

export async function upsertAttemptWorkflowDefinition(
  container: AwilixContainer,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const authoring = tryResolveAuthoring(container)
  if (!authoring) {
    logger.warn('workflows peer unavailable — skipping attempt workflow upsert', scope)
    return
  }
  const result = await authoring.upsertOwnedDefinition(em, {
    ownerModule: DELIVERY_AGENTS_OWNER_MODULE,
    ownerId: DELIVERY_AGENTS_OWNER_ID,
    workflowId: DELIVERY_AGENTS_WORKFLOW_ID,
    workflowName: 'Delivery Cezar Attempt',
    description: 'Lifecycle workflow for a single Cezar task execution attempt. Parks at WAIT_FOR_SIGNAL until evidence is recorded.',
    definition: buildCezarAttemptWorkflowDefinition(),
    metadata: { category: 'Delivery', tags: ['cezar', 'execution'] },
    grantedFeatures: ['delivery_agents.execute', 'delivery_os.attempts.manage'],
    enabled: true,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorUserId: null,
  })
  if (!result.ok) {
    logger.warn('attempt workflow definition owned by another module — skipping', {
      workflowId: DELIVERY_AGENTS_WORKFLOW_ID,
      ...scope,
    })
  }
}
