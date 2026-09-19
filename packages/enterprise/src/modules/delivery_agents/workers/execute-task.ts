import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { mapCezarRunToResultManifest } from '@open-mercato/delivery-cezar/lib/resultManifest'
import type { ITaskExecutor } from '../lib/fakeExecutor'
import { acceptResult } from '../lib/resultAcceptance'
import { DELIVERY_EXECUTE_QUEUE, type ExecuteTaskJobPayload } from '../lib/queue'

const logger = createLogger('delivery_agents').child({ worker: 'execute-task' })

export const metadata: WorkerMeta = {
  queue: DELIVERY_EXECUTE_QUEUE,
  id: 'delivery_agents:execute-task',
  concurrency: Math.max(1, Number.parseInt(process.env.DELIVERY_EXECUTE_CONCURRENCY ?? '2', 10) || 2),
}

type DeliveryScope = { tenantId: string; organizationId: string }

type AttemptQueries = {
  getAttempt: (
    scope: DeliveryScope,
    taskId: string,
    attemptId: string,
  ) => Promise<{
    state?: string
    workerRef?: string | null
    resultEvidenceId?: string | null
    cancel_requested?: boolean
  } | null>
  buildTaskPackage: (scope: DeliveryScope, taskId: string, attemptId: string) => Promise<unknown>
}

function buildTrustedCtx(container: unknown, scope: DeliveryScope, userId: string): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

export default async function handle(job: QueuedJob<ExecuteTaskJobPayload>, _ctx: JobContext): Promise<void> {
  const payload = job.payload
  if (!payload?.attemptId || !payload?.taskId || !payload?.tenantId || !payload?.organizationId) {
    logger.warn('execute-task job missing required fields — skipping', { payload })
    return
  }

  const { attemptId, taskId, tenantId, organizationId, actorUserId } = payload
  const scope: DeliveryScope = { tenantId, organizationId }
  const userId = actorUserId ?? 'delivery_agents_worker'

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as CommandBus
  const queries = container.resolve('deliveryOsAttemptQueries') as AttemptQueries
  const taskExecutor = container.resolve('deliveryAgentsTaskExecutor') as ITaskExecutor

  const ctx = buildTrustedCtx(container, scope, userId)
  const trustedExecution = { source: 'delivery_agents' as const, actorUserId: userId }

  // Claim the attempt
  await commandBus.execute('delivery_os.attempts.claim', {
    input: { taskId, attemptId, workerRef: `worker:execute-task:${job.id ?? 'unknown'}`, trustedExecution },
    ctx,
  })

  // Build the task package
  let taskPackage: unknown
  try {
    taskPackage = await queries.buildTaskPackage(scope, taskId, attemptId)
  } catch (error) {
    logger.error('failed to build task package', {
      taskId,
      attemptId,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  // Run Cezar task via executor (fake in tests, real in production)
  const baseDir = process.env.DELIVERY_CEZAR_BASE_DIR ?? process.cwd()
  let runResult
  try {
    runResult = await taskExecutor.run(taskPackage as Parameters<ITaskExecutor['run']>[0], baseDir)
  } catch (error) {
    logger.error('task executor failed', {
      taskId,
      attemptId,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  // Re-read attempt to check for cancel_requested
  const latestAttempt = await queries.getAttempt(scope, taskId, attemptId)
  const isCancelRequested = latestAttempt && (latestAttempt as Record<string, unknown>).state === 'cancel_requested'

  // Build result manifest
  const manifest = mapCezarRunToResultManifest({
    pkg: taskPackage as Parameters<typeof mapCezarRunToResultManifest>[0]['pkg'],
    runResult,
    ...(isCancelRequested ? {} : {}),
  })

  // Accept the result
  try {
    await acceptResult({
      taskId,
      attemptId,
      manifest,
      userId,
      scope,
      container: container as Parameters<typeof acceptResult>[0]['container'],
    })
  } catch (error) {
    logger.error('failed to accept result', {
      taskId,
      attemptId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  logger.info('execute-task complete', {
    taskId,
    attemptId,
    exitCode: runResult.exitCode,
    durationMs: runResult.durationMs,
  })
}
