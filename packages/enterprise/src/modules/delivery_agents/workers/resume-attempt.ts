import type { DeliveryOsAttemptQueries } from '@open-mercato/core/modules/delivery_os/commands/attemptQueries'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { issueTrustedExecution } from '@open-mercato/core/modules/delivery_os/lib/trustedExecution'
import { DELIVERY_RESUME_QUEUE, type ResumeAttemptJobPayload } from '../lib/queue'
import { DELIVERY_AGENTS_SIGNAL_NAME } from '../lib/attemptWorkflow'
import { findDeliveryWorkflowInstance, hasLeftEvidenceWait } from '../lib/workflowInstance'

const logger = createLogger('delivery_agents').child({ worker: 'resume-attempt' })

const SIGNAL_RETRY_COUNT = 3
const SIGNAL_RETRY_DELAY_MS = 2000

export const metadata: WorkerMeta = {
  queue: DELIVERY_RESUME_QUEUE,
  id: 'delivery_agents:resume-attempt',
  concurrency: 5,
}

type DeliveryScope = { tenantId: string; organizationId: string }

type SignalHandlerLike = {
  sendSignalByCorrelationKey: (
    em: EntityManager,
    container: unknown,
    options: {
      correlationKey: string
      signalName: string
      tenantId: string
      organizationId: string
    },
  ) => Promise<number>
}

function buildTrustedCtx(container: unknown, scope: DeliveryScope): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: {
      sub: 'delivery_agents_worker',
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

async function sendSignalWithRetry(
  signalHandler: SignalHandlerLike,
  em: EntityManager,
  container: unknown,
  scope: DeliveryScope,
  workflowRef: string,
  beforeEffect: () => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < SIGNAL_RETRY_COUNT; attempt++) {
    await beforeEffect()
    try {
      const count = await signalHandler.sendSignalByCorrelationKey(em.fork(), container, {
        correlationKey: workflowRef,
        signalName: DELIVERY_AGENTS_SIGNAL_NAME,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (count > 0) return true
      logger.debug('sendSignalByCorrelationKey returned 0 — workflow not yet parked', {
        workflowRef,
        attempt: attempt + 1,
      })
    } catch (error) {
      logger.warn('signal send attempt failed', {
        workflowRef,
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (attempt < SIGNAL_RETRY_COUNT - 1) {
      await new Promise((resolve) => setTimeout(resolve, SIGNAL_RETRY_DELAY_MS * (attempt + 1)))
    }
  }
  return false
}

async function workflowLeftEvidenceWait(em: EntityManager, workflowRef: string, scope: DeliveryScope): Promise<boolean> {
  try {
    return hasLeftEvidenceWait(await findDeliveryWorkflowInstance(em, { correlationKey: workflowRef }, scope))
  } catch (error) {
    logger.warn('workflow state lookup failed; treating the signal as undelivered', {
      workflowRef,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export default async function handle(job: QueuedJob<ResumeAttemptJobPayload>, _ctx: JobContext): Promise<void> {
  const payload = job.payload
  if (!payload?.attemptId || !payload?.taskId || !payload?.workflowRef || !payload?.tenantId || !payload?.organizationId) {
    logger.warn('resume-attempt job missing required fields — skipping', { payload })
    return
  }

  const { attemptId, taskId, workflowRef, tenantId, organizationId } = payload
  const scope: DeliveryScope = { tenantId, organizationId }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as CommandBus
  const ctx = buildTrustedCtx(container, scope)
  const trustedExecution = issueTrustedExecution('delivery_agents_worker')

  // Resolve signalHandler from DI (optional peer)
  let signalHandler: SignalHandlerLike | null = null
  try {
    const svc = container.resolve('signalHandler') as SignalHandlerLike | null
    if (svc && typeof svc.sendSignalByCorrelationKey === 'function') signalHandler = svc
  } catch {
    // workflows peer unavailable
  }

  if (!signalHandler) {
    logger.warn('signalHandler DI service unavailable — cannot resume workflow', { attemptId, workflowRef })
    return
  }

  // Send evidence-ready signal with retry
  const queries = container.resolve('deliveryOsAttemptQueries') as DeliveryOsAttemptQueries
  const signaled = await sendSignalWithRetry(signalHandler, em, container, scope, workflowRef, () => queries.assertExecutionReady(scope, taskId, attemptId, 'resume', workflowRef))
  const alreadyResumed = !signaled && await workflowLeftEvidenceWait(em, workflowRef, scope)
  if (alreadyResumed) logger.info('evidence-ready signal was consumed by an earlier delivery', { attemptId, workflowRef })

  if (!signaled && !alreadyResumed) {
    logger.error('failed to send evidence-ready signal after all retries', { attemptId, workflowRef, ...scope })
    // Mark delivery as failed so the attempt shows the error
    try {
      await commandBus.execute('delivery_os.attempts.mark_delivery', {
        input: {
          taskId,
          attemptId,
          outcome: 'failed',
          error: '[internal] Failed to deliver evidence-ready signal to workflow after 3 attempts',
          trustedExecution,
        },
        ctx,
      })
    } catch (markError) {
      logger.error('failed to mark delivery as failed', {
        attemptId,
        error: markError instanceof Error ? markError.message : String(markError),
      })
    }
    return
  }

  // Mark completion delivery as delivered
  try {
    await commandBus.execute('delivery_os.attempts.mark_delivery', {
      input: { taskId, attemptId, outcome: 'delivered', trustedExecution },
      ctx,
    })
  } catch (error) {
    logger.error('failed to mark delivery', {
      attemptId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  logger.info('resume-attempt complete', { attemptId, workflowRef })
}
