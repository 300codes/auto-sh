import React from 'react'

const toolConnectionsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M9 17H7A5 5 0 0 1 7 7h2' }),
  React.createElement('path', { d: 'M15 7h2a5 5 0 1 1 0 10h-2' }),
  React.createElement('line', { x1: 8, x2: 16, y1: 12, y2: 12 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['delivery_agents.tools.view'],
  pageTitle: 'Tool connections',
  pageTitleKey: 'delivery_agents.tools.title',
  pageGroup: 'Settings',
  pageGroupKey: 'backend.nav.settings',
  pageOrder: 295,
  icon: toolConnectionsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Tool connections', labelKey: 'delivery_agents.tools.title' }],
}

export default metadata
