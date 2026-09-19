import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'delivery_agents',
  title: 'Delivery Agents',
  version: '0.1.0',
  description: 'Enterprise execution bridge: authorises and runs Cezar tasks, manages attempt lifecycle.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: false,
}

export { features } from './acl'
export { setup } from './setup'
export { register } from './di'
