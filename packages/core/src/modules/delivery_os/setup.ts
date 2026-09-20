import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { seedExampleDeliveryProject } from './lib/exampleProject'

/** The walkthrough records who approved each stage, so it needs a real user of this tenant to attribute them to. */
async function firstTenantUserId(em: EntityManager, tenantId: string): Promise<string | null> {
  const user = await em.findOne(User, { tenantId }, { orderBy: { createdAt: 'ASC' } })
  return user?.id ?? null
}

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
    const actorUserId = await firstTenantUserId(em, tenantId)
    await seedExampleDeliveryProject(em, { tenantId, organizationId }, actorUserId ? { walkthrough: { actorUserId } } : {})
  },
}

export default setup
