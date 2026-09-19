import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createDeliveryOsAttemptQueries } from './commands/attemptQueries'

export function register(container: AppContainer) {
  container.register({
    deliveryOsAttemptQueries: {
      resolve: (c) => createDeliveryOsAttemptQueries(c.resolve<EntityManager>('em')),
    },
  })
}
