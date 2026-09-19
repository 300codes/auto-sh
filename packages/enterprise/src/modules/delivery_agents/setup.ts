import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { upsertAttemptWorkflowDefinition } from './lib/attemptWorkflow'
import { DELIVERY_PENDING_SCAN_QUEUE, DELIVERY_UNCERTAIN_RECON_QUEUE } from './lib/queue'

const logger = createLogger('delivery_agents')

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue' | 'command'
    targetQueue?: string
    targetPayload?: unknown
    sourceType?: 'user' | 'module'
    sourceModule?: string
    isEnabled?: boolean
    description?: string
  }) => Promise<void>
}

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['delivery_agents.execute', 'delivery_agents.monitor', 'delivery_agents.scope'],
    admin: ['delivery_agents.execute', 'delivery_agents.monitor', 'delivery_agents.scope'],
  },

  seedDefaults: async (ctx) => {
    await upsertAttemptWorkflowDefinition(ctx.container, ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    const cradle = ctx.container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }

    const schedulerService = ctx.container.resolve('schedulerService') as SchedulerServiceLike
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }

    try {
      await schedulerService.register({
        id: stableScheduleUuid(`delivery_agents:pending-delivery-scan:${ctx.organizationId}`),
        name: 'Delivery agents — pending delivery scan',
        description: 'Re-enqueues evidence-ready signals for attempts stuck in completionDelivery=pending every 5 minutes.',
        scopeType: 'organization',
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        scheduleType: 'interval',
        scheduleValue: '300s',
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: DELIVERY_PENDING_SCAN_QUEUE,
        targetPayload: { scope },
        sourceType: 'module',
        sourceModule: 'delivery_agents',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('[delivery_agents] Failed to register pending-delivery-scan schedule', {
        error: error instanceof Error ? error.message : error,
      })
    }

    try {
      await schedulerService.register({
        id: stableScheduleUuid(`delivery_agents:uncertain-start-recon:${ctx.organizationId}`),
        name: 'Delivery agents — uncertain start reconciliation',
        description: 'Reconciles attempts stuck in claimed state for 30+ minutes without result evidence every 10 minutes.',
        scopeType: 'organization',
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        scheduleType: 'interval',
        scheduleValue: '600s',
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: DELIVERY_UNCERTAIN_RECON_QUEUE,
        targetPayload: { scope },
        sourceType: 'module',
        sourceModule: 'delivery_agents',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('[delivery_agents] Failed to register uncertain-start-recon schedule', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
