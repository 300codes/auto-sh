import type { AwilixContainer } from 'awilix'
import { createGenericOptimisticLockReader } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { registerOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import type { PublishedDefinitionService } from '@open-mercato/core/modules/workflows/lib/published-definition-service'
import { createWorkflowFlowTemplateProvider } from './lib/flowTemplateProvider'
import { createDeliveryWorkflowSettingsService } from './lib/settingsService'
import { createDeliveryProjectWorkflowService } from './lib/projectWorkflow'
import { createDeliveryStageSignals } from './lib/stageSignals'
import { DeliveryWorkflowSettings } from './data/entities'

registerOptimisticLockReaders({ 'delivery_workflows.settings': createGenericOptimisticLockReader({
  entity: DeliveryWorkflowSettings, idField: 'id', tenantField: 'tenantId', orgField: 'organizationId',
}) })
export function register(container: AwilixContainer) {
  container.register({
    workflowSignalGuard: { resolve: (scope) => createDeliveryStageSignals(scope) },
    deliveryStageSignals: { resolve: (scope) => createDeliveryStageSignals(scope) },
    deliveryFlowTemplateProvider: { resolve: (scope) => createWorkflowFlowTemplateProvider(scope.resolve<PublishedDefinitionService>('workflowPublishedDefinitionService')) },
    deliveryWorkflowSettingsService: { resolve: (scope) => createDeliveryWorkflowSettingsService(scope) },
    deliveryProjectWorkflowService: { resolve: (scope) => createDeliveryProjectWorkflowService(scope) },
  })
}
