import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { upsertAttemptWorkflowDefinition } from './lib/attemptWorkflow'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['delivery_agents.execute', 'delivery_agents.monitor'],
    admin: ['delivery_agents.execute', 'delivery_agents.monitor'],
  },

  seedDefaults: async (ctx) => {
    await upsertAttemptWorkflowDefinition(ctx.container, ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
}

export default setup
