import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { mapCezarRunToResultManifest } from '@open-mercato/delivery-cezar/lib/resultManifest'
import { issueTrustedExecution } from '@open-mercato/core/modules/delivery_os/lib/trustedExecution'
import { DELIVERY_SCHEMA_VERSIONS, taskPackageV1Schema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { tryResolveExecutionHost } from '../lib/executionHost'
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
  assertExecutionReady: (scope: DeliveryScope, taskId: string, attemptId: string) => Promise<void>
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

const CLAIM_REFUSAL_CODES = new Set(['attempt_active', 'attempt_closed', 'attempt_cancelled', 'attempt_not_found'])

type ClaimOutcome = 'claimed' | 'uncertain_start' | 'refused'

async function claimAttempt(
  commandBus: CommandBus,
  ctx: CommandRuntimeContext,
  input: { taskId: string; attemptId: string; workerRef: string; trustedExecution: ReturnType<typeof issueTrustedExecution> },
): Promise<ClaimOutcome> {
  try {
    const { result } = await commandBus.execute<unknown, { changed?: boolean }>('delivery_os.attempts.claim', { input, ctx })
    return result?.changed === false ? 'uncertain_start' : 'claimed'
  } catch (error) {
    const code = error instanceof CrudHttpError ? error.body?.code : undefined
    if (typeof code === 'string' && CLAIM_REFUSAL_CODES.has(code)) return 'refused'
    throw error
  }
}

const INCOMPATIBLE_HOST_MESSAGE = '[internal] No compatible execution host is installed for delivery task-package.v1'

type ProducedManifest = { manifest: unknown; executor: 'host' | 'legacy' }

async function produceManifest(
  container: { resolve: (name: string) => unknown },
  taskExecutor: ITaskExecutor,
  taskPackage: unknown,
  run: { scope: DeliveryScope; actorUserId: string; baseDir: string },
): Promise<ProducedManifest | null> {
  const schemaVersion = typeof taskPackage === 'object' && taskPackage !== null ? (taskPackage as { schemaVersion?: unknown }).schemaVersion : undefined
  if (schemaVersion === DELIVERY_SCHEMA_VERSIONS.taskPackage) {
    const canonical = taskPackageV1Schema.parse(taskPackage)
    const host = tryResolveExecutionHost(container)
    if (!host || !host.supports(canonical.targetProfileId, canonical.targetProfileVersion)) throw new Error(INCOMPATIBLE_HOST_MESSAGE)
    try {
      return { manifest: await host.execute({ taskPackage: canonical, ...run }), executor: 'host' }
    } catch (error) {
      logger.error('execution host failed', {
        taskId: canonical.taskId,
        attemptId: canonical.attemptId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
  if (schemaVersion !== '1') throw new Error(INCOMPATIBLE_HOST_MESSAGE)
  try {
    const legacyPackage = taskPackage as Parameters<ITaskExecutor['run']>[0]
    const runResult = await taskExecutor.run(legacyPackage, run.baseDir)
    return { manifest: mapCezarRunToResultManifest({ pkg: legacyPackage, runResult }), executor: 'legacy' }
  } catch (error) {
    logger.error('task executor failed', { error: error instanceof Error ? error.message : String(error) })
    return null
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
  const trustedExecution = issueTrustedExecution(userId)

  const claim = await claimAttempt(commandBus, ctx, { taskId, attemptId, workerRef: `worker:execute-task:${job.id ?? 'unknown'}`, trustedExecution })
  if (claim !== 'claimed') {
    logger.warn('execute-task skipped without starting the executor', { taskId, attemptId, reason: claim })
    return
  }

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

  const baseDir = process.env.DELIVERY_CEZAR_BASE_DIR ?? process.cwd()
  await queries.assertExecutionReady(scope, taskId, attemptId)
  const produced = await produceManifest(container, taskExecutor, taskPackage, { scope, actorUserId: userId, baseDir })
  if (!produced) return

  // Re-read attempt to check for cancel_requested
  const latestAttempt = await queries.getAttempt(scope, taskId, attemptId)
  const isCancelRequested = latestAttempt && (latestAttempt as Record<string, unknown>).state === 'cancel_requested'

  if (isCancelRequested) {
    try {
      await commandBus.execute('delivery_os.attempts.reconcile', {
        input: {
          taskId,
          attemptId,
          resolution: 'stopped',
          externalEvidence: {
            note: '[internal] Task cancelled during execution by worker',
            observedAt: new Date().toISOString(),
          },
          trustedExecution,
        },
        ctx,
      })
    } catch (error) {
      logger.error('failed to reconcile cancelled attempt', {
        taskId,
        attemptId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } else {
    try {
      await acceptResult({
        taskId,
        attemptId,
        manifest: produced.manifest,
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
  }

  logger.info('execute-task complete', { taskId, attemptId, executor: produced.executor })
}
