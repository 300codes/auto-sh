import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyFigmaEnvPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  async onTenantCreated({ em, tenantId, organizationId }) {
    await applyFigmaEnvPreset({ credentialsService: createCredentialsService(em), stateService: createIntegrationStateService(em), scope: { tenantId, organizationId } })
  },
}
export default setup
