import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'delivery_os',
  title: 'Delivery OS',
  version: '0.1.0',
  description: 'Controlled software delivery: approved baselines, scoped tasks, execution attempts, evidence and human decisions.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['auth', 'attachments'],
}

export { features } from './acl'
