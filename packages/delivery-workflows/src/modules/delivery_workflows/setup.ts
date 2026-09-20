import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
export const setup: ModuleSetupConfig = {
  /**
   * `delivery_workflows.settings.manage` depends on `workflows.definitions.view`, so granting the module alone leaves
   * an admin with a settings screen that answers 403. Both halves are granted together.
   */
  defaultRoleFeatures: {
    admin: ['delivery_workflows.*', 'workflows.definitions.view'],
    employee: ['delivery_workflows.settings.view'],
  },
}

export default setup
