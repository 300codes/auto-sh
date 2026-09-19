import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { startExecution, type ExecutionBridgeStartResult } from '../lib/executionBridge'

const logger = createLogger('delivery_agents').child({ component: 'commands.executions' })

const triggerExecutionSchema = z.object({
  taskId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200),
  targetProfileId: z.string().uuid().nullable().optional(),
})

const triggerExecutionCommand: CommandHandler<unknown, ExecutionBridgeStartResult> = {
  id: 'delivery_agents.executions.trigger',
  async execute(rawInput, ctx) {
    const parsed = triggerExecutionSchema.parse(rawInput)
    const tenantId = (ctx.auth as { tenantId?: string })?.tenantId
    const organizationId = ctx.selectedOrganizationId
    if (!tenantId || !organizationId) throw new Error('[internal] delivery_agents.executions.trigger requires scope')
    const userId = (ctx.auth as { sub?: string })?.sub ?? 'system'

    const em = (ctx.container as { resolve: (k: string) => unknown }).resolve('em') as EntityManager

    logger.info('triggering execution via command', { taskId: parsed.taskId })

    return startExecution({
      taskId: parsed.taskId,
      idempotencyKey: parsed.idempotencyKey,
      userId,
      scope: { tenantId, organizationId },
      container: ctx.container as Parameters<typeof startExecution>[0]['container'],
      em: em.fork(),
      targetProfileId: parsed.targetProfileId ?? null,
    })
  },
}

registerCommand(triggerExecutionCommand)
