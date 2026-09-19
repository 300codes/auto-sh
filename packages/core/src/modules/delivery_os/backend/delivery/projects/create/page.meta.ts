export const metadata = {
  requireAuth: true,
  requireFeatures: ['delivery_os.projects.manage'],
  pageTitle: 'New delivery project',
  pageTitleKey: 'delivery_os.nav.projects.create',
  pageGroup: 'Delivery',
  pageGroupKey: 'delivery_os.nav.group',
  pageOrder: 11,
  navHidden: true,
  breadcrumb: [
    { label: 'Delivery projects', labelKey: 'delivery_os.nav.projects', href: '/backend/delivery/projects' },
    { label: 'New delivery project', labelKey: 'delivery_os.nav.projects.create' },
  ],
}
