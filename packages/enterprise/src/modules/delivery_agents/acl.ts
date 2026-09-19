export const features = [
  {
    id: 'delivery_agents.scope',
    title: 'Prepare delivery scope proposals',
    module: 'delivery_agents',
  },
  {
    id: 'delivery_agents.execute',
    title: 'Execute delivery tasks via Cezar',
    module: 'delivery_agents',
  },
  {
    id: 'delivery_agents.monitor',
    title: 'Monitor execution status and attempt lifecycle',
    module: 'delivery_agents',
    dependsOn: ['delivery_agents.execute'],
  },
  {
    id: 'delivery_agents.tools.view',
    title: 'View tool connections on the execution host',
    module: 'delivery_agents',
  },
  {
    id: 'delivery_agents.tools.manage',
    title: 'Connect and disconnect tools on the execution host',
    module: 'delivery_agents',
    dependsOn: ['delivery_agents.tools.view'],
  },
]

export default features
