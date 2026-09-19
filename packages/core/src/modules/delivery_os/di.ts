import { createDeliveryOsCommentQueries } from './commands/commentQueries'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createDeliveryAttachmentInspector, type StorageDriverFactoryLike } from './commands/attachments'
import { createDeliveryOsAttemptQueries } from './commands/attemptQueries'
import { createDeliveryOsReportQueries } from './commands/reportQueries'
import { createDeliveryOsFlowQueries } from './commands/flowQueries'
import { createDeliveryOsEvidenceQueries } from './commands/evidenceQueries'
import { createDeliveryOsResultQueries } from './commands/resultQueries'
import { createDeliveryOsDesignImportQueries } from './commands/designImportQueries'
import { createCommandBusStaffKanbanAdapter, DELIVERY_STAFF_KANBAN_ADAPTER_KEY } from './commands/staffKanbanAdapter'
import { createBuiltInFlowTemplateProvider, DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY } from './commands/flowTemplateProvider'

export function register(container: AppContainer) {
  container.register({
    deliveryOsCommentQueries: {
      resolve: (c) => createDeliveryOsCommentQueries(c.resolve<EntityManager>('em')),
    },
    deliveryOsDesignImportQueries: {
      resolve: (c) => createDeliveryOsDesignImportQueries(c.resolve<EntityManager>('em')),
    },
    deliveryOsResultQueries: {
      resolve: (c) => createDeliveryOsResultQueries(c.resolve<EntityManager>('em')),
    },
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
    [DELIVERY_STAFF_KANBAN_ADAPTER_KEY]: {
      resolve: () => createCommandBusStaffKanbanAdapter(),
    },
  })
}
