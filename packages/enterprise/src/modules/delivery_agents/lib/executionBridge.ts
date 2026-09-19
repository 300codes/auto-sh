import { sourceRevisionSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { parseDeliveryInput } from '@open-mercato/core/modules/delivery_os/commands/shared'
import type { DeliveryOsAttemptQueries } from '@open-mercato/core/modules/delivery_os/commands/attemptQueries'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AttemptReserveResult } from '@open-mercato/core/modules/delivery_os/commands/attempts'
import { issueTrustedExecution, type TrustedExecutionVersion } from '@open-mercato/core/modules/delivery_os/lib/trustedExecution'
import { DELIVERY_AGENTS_WORKFLOW_ID, DELIVERY_AGENTS_WAIT_STEP_ID } from './attemptWorkflow'
import { getDeliveryAgentsQueue, DELIVERY_EXECUTE_QUEUE, type ExecuteTaskJobPayload } from './queue'

const logger = createLogger('delivery_agents').child({ component: 'execution-bridge' })

const PARK_POLL_ATTEMPTS = 3
const PARK_POLL_DELAY_MS = 500

type DeliveryScope = { tenantId: string; organizationId: string }

type WorkflowExecutorLike = {
  startWorkflow: (
    em: EntityManager,
    options: {
      workflowId: string
      correlationKey?: string
      tenantId?: string
      organizationId?: string
      metadata?: Record<string, unknown>
    },
  ) => Promise<{ id: string; version?: number }>
  executeWorkflow: (em: EntityManager, container: unknown, instanceId: string) => Promise<unknown>
}

type WorkflowInstanceLike = {
  id: string
  status: string
  currentStepId?: string | null
}

function tryResolveWorkflowExecutor(container: AppContainer): WorkflowExecutorLike | null {
  try {
    const svc = container.resolve('workflowExecutor') as WorkflowExecutorLike | null
    return svc && typeof svc.startWorkflow === 'function' ? svc : null
  } catch {
    return null
  }
}

function buildTrustedCtx(container: AppContainer, scope: DeliveryScope, userId: string): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

async function pollForPark(
  em: EntityManager,
  instanceId: string,
  scope: DeliveryScope,
): Promise<void> {
  for (let attempt = 0; attempt < PARK_POLL_ATTEMPTS; attempt++) {
    try {
      const { WorkflowInstance } = (await import('@open-mercato/core/modules/workflows/data/entities')) as {
        WorkflowInstance: new () => WorkflowInstanceLike
      }
      const instance = await em.fork().findOne(WorkflowInstance as never, {
        id: instanceId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as never)
      const parked = instance as unknown as WorkflowInstanceLike | null
      if (parked?.status === 'PAUSED' && parked.currentStepId === DELIVERY_AGENTS_WAIT_STEP_ID) return
    } catch {
      throw new Error('[internal] Unable to confirm delivery workflow wait state')
    }
    if (attempt < PARK_POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PARK_POLL_DELAY_MS))
    }
  }
  throw new Error('[internal] Delivery workflow did not park at the evidence wait step')
}

export type SourceRevision =
  | { kind: 'git'; commitSha: string }
  | { kind: 'snapshot'; contentHash: string; externalWorkspaceId: string }

export type ExecutionBridgeStartInput = {
  taskId: string
  idempotencyKey: string
  userId: string
  scope: DeliveryScope
  container: AppContainer
  em: EntityManager
  targetProfileId?: string | null
  baseRevision?: SourceRevision | null
  version?: TrustedExecutionVersion
}

export type ExecutionBridgeStartResult = {
  attemptId: string
  workflowInstanceId: string
  state: 'reserved'
}

async function resolveBaseRevision(
  em: EntityManager,
  taskId: string,
  scope: DeliveryScope,
  provided: SourceRevision | null | undefined,
): Promise<SourceRevision> {
  return parseDeliveryInput(sourceRevisionSchema, provided)
}

export async function startExecution(input: ExecutionBridgeStartInput): Promise<ExecutionBridgeStartResult> {
  const { taskId, idempotencyKey, userId, scope, container, em, baseRevision } = input
  const commandBus = container.resolve('commandBus') as CommandBus
  const trustedExecution = issueTrustedExecution(userId, input.version)
  const ctx = buildTrustedCtx(container, scope, userId)

  const resolvedRevision = await resolveBaseRevision(em, taskId, scope, baseRevision)

  // 1. Reserve attempt (trusted, automatic mode)
  const { result: reservation } = await commandBus.execute<unknown, AttemptReserveResult>('delivery_os.attempts.reserve', {
    input: { taskId, idempotencyKey, mode: 'automatic', baseRevision: resolvedRevision, trustedExecution },
    ctx,
  })

  const attemptId = reservation.attemptId

  // Idempotent: attempt with this key already exists — find the workflow instance from the attempt
  if (!reservation.created) {
    const queries = container.resolve('deliveryOsAttemptQueries') as {
      getAttempt: (scope: DeliveryScope, taskId: string, attemptId: string) => Promise<{ workflowRef?: string | null } | null>
    }
    const existing = await queries.getAttempt(scope, taskId, attemptId)
    const existingWorkflowRef = existing?.workflowRef ?? null
    return {
      attemptId,
      workflowInstanceId: existingWorkflowRef ?? '',
      state: 'reserved',
    }
  }

  // 2. Start workflow instance
  const workflowExecutor = tryResolveWorkflowExecutor(container)
  if (!workflowExecutor) {
    logger.warn('workflows peer unavailable — attempt reserved without workflow', { attemptId, ...scope })
    return { attemptId, workflowInstanceId: '', state: 'reserved' }
  }

  const queries = container.resolve('deliveryOsAttemptQueries') as DeliveryOsAttemptQueries
  await queries.assertExecutionReady(scope, taskId, attemptId)
  const correlationKey = attemptId
  const instance = await workflowExecutor.startWorkflow(em, {
    workflowId: DELIVERY_AGENTS_WORKFLOW_ID,
    correlationKey,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const workflowInstanceId = instance.id

  // 3. Link workflow to attempt (must precede enqueue)
  await commandBus.execute('delivery_os.attempts.link_workflow', {
    input: {
      taskId,
      attemptId,
      workflowRef: correlationKey,
      workflowStepId: DELIVERY_AGENTS_WAIT_STEP_ID,
      dispatched: false,
      trustedExecution,
    },
    ctx,
  })

  // 4. Execute workflow to park at WAIT_FOR_SIGNAL
  await queries.assertExecutionReady(scope, taskId, attemptId)
  await workflowExecutor.executeWorkflow(em, container, workflowInstanceId)

  // 5. Poll to confirm parking (max 3×500ms)
  await pollForPark(em, workflowInstanceId, scope)

  // 6. Enqueue execute-task job
  const jobPayload: ExecuteTaskJobPayload = {
    attemptId,
    taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorUserId: userId,
  }
  await queries.assertExecutionReady(scope, taskId, attemptId)
  await getDeliveryAgentsQueue(DELIVERY_EXECUTE_QUEUE).enqueue(jobPayload as Record<string, unknown>)

  return { attemptId, workflowInstanceId, state: 'reserved' }
}
