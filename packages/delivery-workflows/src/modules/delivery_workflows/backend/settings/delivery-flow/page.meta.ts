export const metadata = {
  requireAuth: true, requireFeatures: ['delivery_workflows.settings.view'],
  pageTitle: 'Delivery process', pageTitleKey: 'delivery_workflows.settings.title',
  pageGroup: 'Module Configs', pageGroupKey: 'settings.sections.moduleConfigs',
  pageContext: 'settings' as const, pageOrder: 70,
}
