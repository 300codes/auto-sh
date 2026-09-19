export const metadata = {
  requireAuth: true,
  requireFeatures: ['delivery_os.projects.view'],
  pageTitle: 'Delivery projects',
  pageTitleKey: 'delivery_os.nav.projects',
  pageGroup: 'Delivery',
  pageGroupKey: 'delivery_os.nav.group',
  pageOrder: 10,
  icon: 'rocket',
  pageContext: 'main' as const,
  breadcrumb: [{ label: 'Delivery projects', labelKey: 'delivery_os.nav.projects' }],
}
