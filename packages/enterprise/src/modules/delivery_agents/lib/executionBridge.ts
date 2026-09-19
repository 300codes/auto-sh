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
import { findDeliveryWorkflowInstance, isParkedAtEvidenceWait, type DeliveryWorkflowInstance } from './workflowInstance'

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
    let instance: DeliveryWorkflowInstance | null
    try {
      instance = await findDeliveryWorkflowInstance(em, { id: instanceId }, scope)
    } catch {
      throw new Error('[internal] Unable to confirm delivery workflow wait state')
    }
    if (isParkedAtEvidenceWait(instance)) return
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
  const queries = container.resolve('deliveryOsAttemptQueries') as DeliveryOsAttemptQueries

  if (!reservation.created) {
    const existing = await queries.getAttempt(scope, taskId, attemptId)
    const existingWorkflowRef = existing?.workflowRef ?? null
    if (!existing || existing.state !== 'reserved' || existing.dispatchedAt) {
      return { attemptId, workflowInstanceId: existingWorkflowRef ?? '', state: 'reserved' }
    }
    logger.info('resuming an undispatched reservation on replay', { attemptId, ...scope })
  }

  const workflowExecutor = tryResolveWorkflowExecutor(container)
  if (!workflowExecutor) {
    logger.warn('workflows peer unavailable — attempt reserved without workflow', { attemptId, ...scope })
    return { attemptId, workflowInstanceId: '', state: 'reserved' }
  }

  const correlationKey = attemptId
  await queries.assertExecutionReady(scope, taskId, attemptId)
  const startedInstance = await findDeliveryWorkflowInstance(em, { correlationKey }, scope).catch(() => {
    throw new Error('[internal] Unable to confirm delivery workflow state')
  })
  const workflowInstanceId = startedInstance?.id ?? (await workflowExecutor.startWorkflow(em, {
    workflowId: DELIVERY_AGENTS_WORKFLOW_ID,
    correlationKey,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })).id

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

  if (!isParkedAtEvidenceWait(startedInstance)) {
    await queries.assertExecutionReady(scope, taskId, attemptId)
    await workflowExecutor.executeWorkflow(em, container, workflowInstanceId)
  }
  await pollForPark(em, workflowInstanceId, scope)

  const jobPayload: ExecuteTaskJobPayload = {
    attemptId,
    taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorUserId: userId,
  }
  await queries.assertExecutionReady(scope, taskId, attemptId)
  await getDeliveryAgentsQueue(DELIVERY_EXECUTE_QUEUE).enqueue(jobPayload as Record<string, unknown>)

  await commandBus.execute('delivery_os.attempts.link_workflow', {
    input: {
      taskId,
      attemptId,
      workflowRef: correlationKey,
      workflowStepId: DELIVERY_AGENTS_WAIT_STEP_ID,
      dispatched: true,
      trustedExecution,
    },
    ctx,
  })

  return { attemptId, workflowInstanceId, state: 'reserved' }
}
