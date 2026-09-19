import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createDeliveryFigmaProvider } from './lib/provider'
import { createFigmaCommentsClient, figmaCredentialsSchema } from './lib/client'

export function register(container: AppContainer): void {
  container.register({
    deliveryFigmaProvider: asFunction(() => createDeliveryFigmaProvider()).scoped(),
    deliveryFigmaHealthCheck: asValue({
      async check(credentials: Record<string, unknown> | null) {
        const parsed = figmaCredentialsSchema.safeParse(credentials)
        if (!parsed.success || typeof credentials?.healthFileKey !== 'string') return { status: 'degraded', message: 'delivery_figma.errors.healthUnconfigured' }
        try {
          await createFigmaCommentsClient().read(credentials.healthFileKey, parsed.data)
          return { status: 'healthy' }
        } catch { return { status: 'unhealthy', message: 'delivery_figma.errors.healthFailed' } }
      },
    }),
  })
}
