import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { figmaCredentialsSchema } from './client'

export async function applyFigmaEnvPreset(input: {
  credentialsService: ReturnType<typeof createCredentialsService>
  stateService: ReturnType<typeof createIntegrationStateService>
  scope: IntegrationScope
  env?: Record<string, string | undefined>
}): Promise<void> {
  const env = input.env ?? process.env
  if (!env.OM_INTEGRATION_FIGMA_TOKEN) return
  const credentials = figmaCredentialsSchema.parse({ token: env.OM_INTEGRATION_FIGMA_TOKEN, authType: env.OM_INTEGRATION_FIGMA_AUTH_TYPE ?? 'personal' })
  await input.credentialsService.save('delivery_figma', { ...credentials, healthFileKey: env.OM_INTEGRATION_FIGMA_HEALTH_FILE_KEY ?? '' }, input.scope)
  await input.stateService.upsert('delivery_figma', { isEnabled: true }, input.scope)
}
