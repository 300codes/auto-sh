import type { PublishedDefinitionService, PublishedDefinitionScope } from '@open-mercato/core/modules/workflows/lib/published-definition-service'
import { createBuiltInFlowTemplateProvider, type DeliveryFlowTemplateProvider } from '@open-mercato/core/modules/delivery_os/commands/flowTemplateProvider'
import { mapDeliveryWorkflow } from './templateMapper'

export function createWorkflowFlowTemplateProvider(service: PublishedDefinitionService) {
  const builtIn = createBuiltInFlowTemplateProvider()
  return {
    ...builtIn,
    forScope(scope: PublishedDefinitionScope): DeliveryFlowTemplateProvider {
      return {
        async getTemplate(templateId, version) {
          const definition = await service.getExactPublished(scope, templateId, version)
          return definition ? mapDeliveryWorkflow(definition) : builtIn.getTemplate(templateId, version)
        },
      }
    },
  }
}
