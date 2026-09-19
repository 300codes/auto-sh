export const metadata = {
  requireAuth: true,
  requireFeatures: ['delivery_os.projects.view'],
  pageTitleKey: 'delivery_os.project.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Delivery projects', labelKey: 'delivery_os.nav.projects', href: '/backend/delivery/projects' },
    { label: 'Delivery project', labelKey: 'delivery_os.project.title' },
  ],
}
