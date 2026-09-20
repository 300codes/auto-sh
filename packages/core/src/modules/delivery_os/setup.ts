import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedExampleDeliveryProject } from './lib/exampleProject'

export const setup: ModuleSetupConfig = {
  /**
   * The flow only moves when one role can carry it end to end. An operator who can open a project but cannot approve
   * a stage, freeze a baseline or reserve an attempt gets a 403 halfway through and no hint about which grant is
   * missing, so the delivery roles are granted the whole path rather than its first half.
   */
  defaultRoleFeatures: {
    admin: ['delivery_os.*'],
    employee: [
      'delivery_os.projects.view',
      'delivery_os.projects.manage',
      'delivery_os.flow.manage',
      'delivery_os.stages.approve',
      'delivery_os.baselines.approve',
      'delivery_os.attempts.manage',
      'delivery_os.attempts.reconcile',
      'delivery_os.results.import',
      'delivery_os.comments.import',
    ],
  },

  async seedExamples({ em, tenantId, organizationId }) {
    await seedExampleDeliveryProject(em, { tenantId, organizationId })
  },
}

export default setup
