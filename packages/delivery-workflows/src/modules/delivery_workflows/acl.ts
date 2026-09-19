export const features = [
  { id: 'delivery_workflows.settings.view', title: 'View Delivery process settings', module: 'delivery_workflows' },
  { id: 'delivery_workflows.settings.manage', title: 'Manage Delivery process settings', module: 'delivery_workflows', dependsOn: ['delivery_workflows.settings.view', 'workflows.definitions.view'] },
]

export default features
