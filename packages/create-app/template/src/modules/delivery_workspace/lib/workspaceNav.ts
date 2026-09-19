import {
  SIDEBAR_PREFERENCES_VERSION,
  type SidebarPreferencesSettings,
} from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

export const DELIVERY_GROUP_ID = 'delivery_os.nav.group'
export const DELIVERY_GROUP_LABEL_KEY = 'delivery_os.nav.group'
export const DEFAULT_WORKSPACE_ROLES = ['superadmin', 'admin'] as const

export type WorkspaceMenuEntry = {
  id: string
  requiredModule: string
  labelKey: string
  label: string
  icon: string
  href: string
  features: string[]
}

export const WORKSPACE_MENU_ENTRIES: WorkspaceMenuEntry[] = [
  {
    id: 'delivery-workspace-kanban',
    requiredModule: 'staff',
    labelKey: 'delivery_workspace.menu.kanban',
    label: 'Kanban',
    icon: 'list-checks',
    href: '/backend/staff/time-tracking/board',
    features: ['staff.timesheets.tasks.view'],
  },
  {
    id: 'delivery-workspace-team-projects',
    requiredModule: 'staff',
    labelKey: 'delivery_workspace.menu.teamProjects',
    label: 'Team projects',
    icon: 'clipboard-list',
    href: '/backend/staff/time-tracking/projects',
    features: ['staff.timesheets.projects.view'],
  },
  {
    id: 'delivery-workspace-workflows',
    requiredModule: 'workflows',
    labelKey: 'delivery_workspace.menu.workflows',
    label: 'Process definitions',
    icon: 'workflow',
    href: '/backend/definitions',
    features: ['workflows.view'],
  },
  {
    id: 'delivery-workspace-workflow-editor',
    requiredModule: 'workflows',
    labelKey: 'delivery_workspace.menu.workflowEditor',
    label: 'Process editor',
    icon: 'git-branch',
    href: '/backend/definitions/visual-editor',
    features: ['workflows.manage'],
  },
  {
    id: 'delivery-workspace-workflow-instances',
    requiredModule: 'workflows',
    labelKey: 'delivery_workspace.menu.workflowInstances',
    label: 'Process instances',
    icon: 'activity',
    href: '/backend/instances',
    features: ['workflows.instances.view'],
  },
  {
    id: 'delivery-workspace-agents',
    requiredModule: 'agent_orchestrator',
    labelKey: 'delivery_workspace.menu.agents',
    label: 'Agents',
    icon: 'bot',
    href: '/backend/agents',
    features: ['agent_orchestrator.agents.view'],
  },
  {
    id: 'delivery-workspace-agent-proposals',
    requiredModule: 'agent_orchestrator',
    labelKey: 'delivery_workspace.menu.agentProposals',
    label: 'Agent proposals',
    icon: 'inbox',
    href: '/backend/caseload',
    features: ['agent_orchestrator.proposals.view'],
  },
]

export type MainNavItem = {
  href: string
  groupId: string
  pageContext?: 'main' | 'admin' | 'settings' | 'profile'
}

function isMainNavItem(item: MainNavItem): boolean {
  if (item.pageContext && item.pageContext !== 'main') return false
  return !item.href.startsWith('/backend/settings') && !item.href.startsWith('/backend/config')
}

export function buildWorkspaceSidebarSettings(navItems: MainNavItem[]): SidebarPreferencesSettings {
  const hiddenItems = Array.from(
    new Set(
      navItems
        .filter((item) => isMainNavItem(item) && item.groupId !== DELIVERY_GROUP_ID)
        .map((item) => item.href),
    ),
  ).sort()
  return {
    version: SIDEBAR_PREFERENCES_VERSION,
    groupOrder: [DELIVERY_GROUP_ID],
    groupLabels: {},
    itemLabels: {},
    hiddenItems,
    itemOrder: {},
  }
}

export function buildWorkspaceMenuItems(requiredModule: string): InjectionMenuItem[] {
  return WORKSPACE_MENU_ENTRIES
    .filter((entry) => entry.requiredModule === requiredModule)
    .map((entry) => ({
      id: entry.id,
      labelKey: entry.labelKey,
      label: entry.label,
      icon: entry.icon,
      href: entry.href,
      features: entry.features,
      groupId: DELIVERY_GROUP_ID,
      groupLabelKey: DELIVERY_GROUP_LABEL_KEY,
      groupLabel: 'Delivery',
      placement: { position: InjectionPosition.Last },
    }))
}
