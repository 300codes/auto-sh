import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'menu:sidebar:main': [
    { widgetId: 'delivery_workspace.injection.staff-menu', priority: 50 },
    { widgetId: 'delivery_workspace.injection.workflows-menu', priority: 49 },
    { widgetId: 'delivery_workspace.injection.agent-orchestrator-menu', priority: 48 },
  ],
}

export default injectionTable
