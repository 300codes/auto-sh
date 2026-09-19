import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['delivery_agents.execute', 'delivery_agents.monitor'],
    admin: ['delivery_agents.execute', 'delivery_agents.monitor'],
  },
}

export default setup
