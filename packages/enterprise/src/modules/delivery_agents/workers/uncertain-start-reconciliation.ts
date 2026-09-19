import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { issueTrustedExecution } from '@open-mercato/core/modules/delivery_os/lib/trustedExecution'
import { DeliveryTask } from '@open-mercato/core/modules/delivery_os/data/entities'
import { parseAttemptRegister } from '@open-mercato/core/modules/delivery_os/lib/attempts'
import { DELIVERY_UNCERTAIN_RECON_QUEUE, type ScopeJobPayload } from '../lib/queue'

const logger = createLogger('delivery_agents').child({ worker: 'uncertain-start-reconciliation' })

const STUCK_THRESHOLD_MS = 30 * 60 * 1000
const SCAN_PAGE_SIZE = 200

export const metadata: WorkerMeta = {
  queue: DELIVERY_UNCERTAIN_RECON_QUEUE,
  id: 'delivery_agents:uncertain-start-reconciliation',
  concurrency: 1,
}

type DeliveryScope = { tenantId: string; organizationId: string }

type StuckAttempt = { taskId: string; attemptId: string }

function buildTrustedCtx(container: unknown, scope: DeliveryScope): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: {
      sub: 'delivery_agents_recon_worker',
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

async function scanStuckAttempts(em: EntityManager, scope: DeliveryScope, now: Date): Promise<StuckAttempt[]> {
  const stuck: StuckAttempt[] = []
  const thresholdMs = STUCK_THRESHOLD_MS

  for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
    const tasks = await findWithDecryption(
      em,
      DeliveryTask,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, attemptNumber: { $gt: 0 } },
      { orderBy: { updatedAt: 'asc' as const, id: 'asc' as const }, limit: SCAN_PAGE_SIZE, offset },
      scope,
    )

    for (const task of tasks) {
      const parsed = parseAttemptRegister((task as unknown as { executionAttempts: unknown }).executionAttempts)
      if (!parsed.ok) continue

      for (const attempt of parsed.register) {
        if (attempt.state !== 'claimed') continue
        if (attempt.resultEvidenceId) continue
        if (!attempt.claimedAt) continue

        const age = now.getTime() - new Date(attempt.claimedAt).getTime()
        if (age < thresholdMs) continue

        stuck.push({ taskId: (task as unknown as { id: string }).id, attemptId: attempt.attemptId })
      }
    }

    if (tasks.length < SCAN_PAGE_SIZE) break
  }

  return stuck
}

export default async function handle(job: QueuedJob<ScopeJobPayload>, _ctx: JobContext): Promise<void> {
  const scope = job.payload?.scope
  if (!scope?.tenantId || !scope?.organizationId) {
    logger.warn('uncertain-start-reconciliation missing scope — skipping', { payload: job.payload })
    return
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as CommandBus
  const ctx = buildTrustedCtx(container, scope)
  const trustedExecution = issueTrustedExecution('delivery_agents_recon_worker')
  const now = new Date()

  const stuck = await scanStuckAttempts(em.fork(), scope, now)
  if (!stuck.length) {
    logger.debug('uncertain-start-reconciliation: no stuck attempts found', scope)
    return
  }

  logger.info('uncertain-start-reconciliation: reconciling stuck attempts', { count: stuck.length, ...scope })

  for (const { taskId, attemptId } of stuck) {
    try {
      await commandBus.execute('delivery_os.attempts.reconcile', {
        input: {
          taskId,
          attemptId,
          resolution: 'unknown',
          externalEvidence: {
            note: '[internal] Automatic reconciliation: attempt stuck in claimed state for 30+ minutes without result evidence',
            observedAt: now.toISOString(),
          },
          trustedExecution,
        },
        ctx,
      })
      logger.info('reconciled stuck attempt', { taskId, attemptId, ...scope })
    } catch (error) {
      logger.error('failed to reconcile stuck attempt', {
        taskId,
        attemptId,
        error: error instanceof Error ? error.message : String(error),
        ...scope,
      })
    }
  }
}
