import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Delivery Agents — widget injection table.
 *
 * Injects an execution action card into the OSS delivery_os project detail page
 * via the `delivery_os.project.execution` spot declared by the OSS module.
 * The spot is rendered by the UI host (`backend/delivery/projects/[id]/page.tsx`);
 * this declaration is additive and safe to load before the spot exists.
 */
export const injectionTable: ModuleInjectionTable = {
  'delivery_os.project.scoping': [{ widgetId: 'delivery_agents.injection.scope-assistant', priority: 50 }],
  'delivery_os.project.execution': [
    {
      widgetId: 'delivery_agents.injection.project-execution-action',
      priority: 50,
    },
  ],
}

export default injectionTable
