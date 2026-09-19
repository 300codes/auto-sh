import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { DeliveryOsAttemptQueries } from '@open-mercato/core/modules/delivery_os/commands/attemptQueries'
import {
  DELIVERY_PENDING_SCAN_QUEUE,
  DELIVERY_RESUME_QUEUE,
  getDeliveryAgentsQueue,
  type ScopeJobPayload,
} from '../lib/queue'

const logger = createLogger('delivery_agents').child({ worker: 'pending-delivery-scan' })

export const metadata: WorkerMeta = {
  queue: DELIVERY_PENDING_SCAN_QUEUE,
  id: 'delivery_agents:pending-delivery-scan',
  concurrency: 1,
}

export default async function handle(job: QueuedJob<ScopeJobPayload>, _ctx: JobContext): Promise<void> {
  const scope = job.payload?.scope
  if (!scope?.tenantId || !scope?.organizationId) {
    logger.warn('pending-delivery-scan missing scope — skipping', { payload: job.payload })
    return
  }

  const container = await createRequestContainer()
  const queries = container.resolve('deliveryOsAttemptQueries') as DeliveryOsAttemptQueries

  const pending = await queries.listPendingDeliveries(scope, { limit: 100 })
  if (!pending.length) {
    logger.debug('pending-delivery-scan: no pending deliveries found', scope)
    return
  }

  logger.info('pending-delivery-scan: enqueuing resume jobs', { count: pending.length, ...scope })

  const resumeQueue = getDeliveryAgentsQueue(DELIVERY_RESUME_QUEUE)
  for (const item of pending) {
    await resumeQueue.enqueue({
      attemptId: item.attemptId,
      taskId: item.taskId,
      evidenceId: item.evidenceId,
      workflowRef: item.workflowRef,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    logger.debug('enqueued resume job for pending delivery', { attemptId: item.attemptId, ...scope })
  }
}
