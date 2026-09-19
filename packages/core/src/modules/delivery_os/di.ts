import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createDeliveryAttachmentInspector, type StorageDriverFactoryLike } from './commands/attachments'
import { createDeliveryOsAttemptQueries } from './commands/attemptQueries'
import { createDeliveryOsReportQueries } from './commands/reportQueries'
import { createDeliveryOsFlowQueries } from './commands/flowQueries'
import { createDeliveryOsEvidenceQueries } from './commands/evidenceQueries'
import { createBuiltInFlowTemplateProvider, DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY } from './commands/flowTemplateProvider'

export function register(container: AppContainer) {
  container.register({
    deliveryOsEvidenceQueries: {
      resolve: (c) => createDeliveryOsEvidenceQueries(c.resolve<EntityManager>('em')),
    },
    deliveryOsAttemptQueries: {
      resolve: (c) => createDeliveryOsAttemptQueries(c.resolve<EntityManager>('em')),
    },
    deliveryOsReportQueries: {
      resolve: (c) => createDeliveryOsReportQueries(c.resolve<EntityManager>('em')),
    },
    deliveryOsFlowQueries: {
      resolve: (c) => createDeliveryOsFlowQueries(c.resolve<EntityManager>('em')),
    },
    deliveryOsAttachmentInspector: {
      resolve: (c) => createDeliveryAttachmentInspector(() => c.resolve<StorageDriverFactoryLike>('storageDriverFactory')),
    },
    [DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY]: {
      resolve: () => createBuiltInFlowTemplateProvider(),
    },
  })
}
