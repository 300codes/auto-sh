import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { issueTrustedExecution } from '@open-mercato/core/modules/delivery_os/lib/trustedExecution'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { ResultAcceptCommandResult } from '@open-mercato/core/modules/delivery_os/commands/evidence'

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

function buildTrustedCtx(container: AppContainer, scope: DeliveryScope, userId: string): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: {
      sub: userId,
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

  const actorUserId = uuidSchema.parse(userId)
  const trustedExecution = issueTrustedExecution(actorUserId)

  const commandBus = container.resolve('commandBus') as CommandBus
  const ctx = buildTrustedCtx(container, scope, actorUserId)

  const { result } = await commandBus.execute<unknown, ResultAcceptCommandResult>('delivery_os.results.accept', {
    input: {
      taskId,
      attemptId,
      manifest,
      source: 'adapter',
      trustedExecution,
    },
    ctx,
  })

  return { evidenceId: result.evidenceId, duplicate: result.duplicate }
}
