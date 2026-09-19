import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'delivery_figma', title: 'Figma', category: 'other', hub: 'delivery_os', providerKey: 'figma',
  package: '@open-mercato/delivery-figma', version: '0.8.0',
  docsUrl: 'https://developers.figma.com/docs/rest-api/comments-endpoints/',
  credentials: { fields: [
    { key: 'token', label: 'delivery_figma.credentials.token', type: 'secret', required: true },
    { key: 'authType', label: 'delivery_figma.credentials.authType', type: 'select', required: true,
      options: [{ value: 'personal', label: 'delivery_figma.credentials.personal' }, { value: 'oauth', label: 'OAuth' }] },
    { key: 'healthFileKey', label: 'delivery_figma.credentials.healthFileKey', type: 'text', required: false },
  ] },
  healthCheck: { service: 'deliveryFigmaHealthCheck' },
}
export const integrations = [integration]
