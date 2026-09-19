import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createDeliveryAttachmentInspector, type StorageDriverFactoryLike } from './commands/attachments'
import { createDeliveryOsAttemptQueries } from './commands/attemptQueries'
import { createDeliveryOsReportQueries } from './commands/reportQueries'

export function register(container: AppContainer) {
  container.register({
    deliveryOsAttemptQueries: {
      resolve: (c) => createDeliveryOsAttemptQueries(c.resolve<EntityManager>('em')),
    },
    deliveryOsReportQueries: {
      resolve: (c) => createDeliveryOsReportQueries(c.resolve<EntityManager>('em')),
    },
    deliveryOsAttachmentInspector: {
      resolve: (c) => createDeliveryAttachmentInspector(() => c.resolve<StorageDriverFactoryLike>('storageDriverFactory')),
    },
  })
}
