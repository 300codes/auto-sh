import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['delivery_os.*'],
    employee: [
      'delivery_os.projects.view',
      'delivery_os.projects.manage',
      'delivery_os.results.import',
      'delivery_os.comments.import',
    ],
  },
}

export default setup
