import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'
import { buildWorkspaceMenuItems } from '../../../lib/workspaceNav'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'delivery_workspace.injection.agent-orchestrator-menu',
    requiredModules: ['delivery_os', 'agent_orchestrator'],
  },
  menuItems: buildWorkspaceMenuItems('agent_orchestrator'),
}

export default widget
