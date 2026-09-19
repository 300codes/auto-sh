import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'
import { buildWorkspaceMenuItems } from '../../../lib/workspaceNav'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'delivery_workspace.injection.staff-menu',
    requiredModules: ['delivery_os', 'staff'],
  },
  menuItems: buildWorkspaceMenuItems('staff'),
}

export default widget
