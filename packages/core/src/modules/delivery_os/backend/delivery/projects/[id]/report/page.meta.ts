export const metadata = {
  requireAuth: true,
  requireFeatures: ['delivery_os.projects.view'],
  pageTitleKey: 'delivery_os.report.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Delivery projects', labelKey: 'delivery_os.nav.projects', href: '/backend/delivery/projects' },
    { label: 'Delivery report', labelKey: 'delivery_os.report.title' },
  ],
}
