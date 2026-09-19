export const features = [
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
]

export default features
