import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'
import { buildWorkspaceMenuItems } from '../../../lib/workspaceNav'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'delivery_workspace.injection.workflows-menu',
    requiredModules: ['delivery_os', 'workflows'],
  },
  menuItems: buildWorkspaceMenuItems('workflows'),
}

export default widget
