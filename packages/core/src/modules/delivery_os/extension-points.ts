import {
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'delivery_os',
  hosts: {
    projectExecution: injectionExtensionHost({
      family: 'detail',
      spotId: 'delivery_os.project.execution',
      supported: ['render-widget'],
      contextContract: 'delivery_os.project.execution.v1',
      source: 'backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx',
    }),
  },
})

export default extensionPoints
