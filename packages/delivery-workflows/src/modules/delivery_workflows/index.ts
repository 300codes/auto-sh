import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo & { id: string } = {
  name: 'delivery_workflows',
  id: 'delivery_workflows', title: 'Delivery Workflows',
  description: 'Optional versioned Delivery processes backed by Workflows Studio.',
}
