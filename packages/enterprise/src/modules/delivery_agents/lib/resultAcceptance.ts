import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('delivery_agents').child({ component: 'result-acceptance' })

type DeliveryScope = { tenantId: string; organizationId: string }

export type ResultAcceptanceInput = {
  taskId: string
  attemptId: string
  manifest: unknown
  userId: string | null
  scope: DeliveryScope
  container: AppContainer
}

export type ResultAcceptanceResult = {
  evidenceId: string
  duplicate: boolean
}

function buildTrustedCtx(container: AppContainer, scope: DeliveryScope, userId: string | null): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: {
      sub: userId ?? 'delivery_agents_worker',
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

export async function acceptResult(input: ResultAcceptanceInput): Promise<ResultAcceptanceResult> {
  const { taskId, attemptId, manifest, userId, scope, container } = input

  // Idempotency check: if attempt already has evidence, skip
  const queries = container.resolve('deliveryOsAttemptQueries') as {
    getAttempt: (
      scope: DeliveryScope,
      taskId: string,
      attemptId: string,
    ) => Promise<{ resultEvidenceId?: string | null } | null>
  }
  const attempt = await queries.getAttempt(scope, taskId, attemptId)
  if (attempt?.resultEvidenceId) {
    logger.debug('result evidence already recorded — skipping duplicate accept', { taskId, attemptId })
    return { evidenceId: attempt.resultEvidenceId, duplicate: true }
  }

  const commandBus = container.resolve('commandBus') as CommandBus
  const ctx = buildTrustedCtx(container, scope, userId)

  const result = (await commandBus.execute('delivery_os.results.accept', {
    input: {
      taskId,
      attemptId,
      manifest,
      source: 'adapter',
      trustedExecution: { source: 'delivery_agents', actorUserId: userId ?? 'delivery_agents_worker' },
    },
    ctx,
  })) as unknown as { evidenceId: string; duplicate: boolean }

  return { evidenceId: result.evidenceId, duplicate: result.duplicate }
}
