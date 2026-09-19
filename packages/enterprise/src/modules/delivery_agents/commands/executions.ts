import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { uuidSchema, sourceRevisionSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { startExecution, type ExecutionBridgeStartResult } from '../lib/executionBridge'

const logger = createLogger('delivery_agents').child({ component: 'commands.executions' })

const triggerExecutionSchema = z.object({
  taskId: z.string().uuid(),
  baseRevision: sourceRevisionSchema.optional(),
  idempotencyKey: z.string().min(1).max(200),
  targetProfileId: z.string().uuid().nullable().optional(),
})

const triggerExecutionCommand: CommandHandler<unknown, ExecutionBridgeStartResult> = {
  id: 'delivery_agents.executions.trigger',
  async execute(rawInput, ctx) {
    const parsed = triggerExecutionSchema.parse(rawInput)
    const scope = resolveDeliveryScope(ctx)
    const userId = uuidSchema.parse(ctx.auth?.sub)

    const em = (ctx.container as { resolve: (k: string) => unknown }).resolve('em') as EntityManager

    logger.info('triggering execution via command', { taskId: parsed.taskId })

    return startExecution({
      taskId: parsed.taskId,
      idempotencyKey: parsed.idempotencyKey,
      userId,
      scope,
      ...(ctx.request ? { version: { expectedUpdatedAt: readOptimisticLockExpected(ctx.request), requireExpectedVersion: true } } : {}),
      container: ctx.container as Parameters<typeof startExecution>[0]['container'],
      em: em.fork(),
      targetProfileId: parsed.targetProfileId ?? null,
      baseRevision: parsed.baseRevision,
    })
  },
}

registerCommand(triggerExecutionCommand)
