import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * Reading the task — including its attempt register — needs only the project
 * read feature. The execution features gate the ACTIONS inside the page, not
 * access to it: an operator without them must still be able to see what ran.
 */
export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['delivery_os.projects.view'],
  pageTitleKey: 'delivery_os.task.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Delivery projects', labelKey: 'delivery_os.nav.projects', href: '/backend/delivery/projects' },
    { label: 'Delivery project', labelKey: 'delivery_os.project.title' },
    { label: 'Delivery task', labelKey: 'delivery_os.task.title' },
  ],
}
