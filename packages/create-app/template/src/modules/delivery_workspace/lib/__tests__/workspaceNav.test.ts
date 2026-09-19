import fs from 'node:fs'
import path from 'node:path'
import {
  buildWorkspaceMenuItems,
  buildWorkspaceSidebarSettings,
  DELIVERY_GROUP_ID,
  WORKSPACE_MENU_ENTRIES,
} from '../workspaceNav'

describe('buildWorkspaceSidebarSettings', () => {
  it('hides every main item outside the delivery group and ranks the delivery group first', () => {
    const settings = buildWorkspaceSidebarSettings([
      { href: '/backend/delivery/projects', groupId: DELIVERY_GROUP_ID, pageContext: 'main' },
      { href: '/backend/customers/people', groupId: 'customers.nav.group' },
      { href: '/backend/staff/time-tracking/board', groupId: 'staff.time_tracking.nav.group' },
      { href: '/backend/customers/people', groupId: 'customers.nav.group' },
    ])

    expect(settings.groupOrder).toEqual([DELIVERY_GROUP_ID])
    expect(settings.hiddenItems).toEqual(['/backend/customers/people', '/backend/staff/time-tracking/board'])
  })

  it('leaves settings and profile pages untouched', () => {
    const settings = buildWorkspaceSidebarSettings([
      { href: '/backend/settings/web-search', groupId: 'backend.nav.settings', pageContext: 'settings' },
      { href: '/backend/profile/security', groupId: 'profile.sections.account', pageContext: 'profile' },
      { href: '/backend/config/workflows', groupId: 'settings.sections.moduleConfigs' },
    ])

    expect(settings.hiddenItems).toEqual([])
  })

  it('injects only backend links with unique ids and feature gates', () => {
    const ids = WORKSPACE_MENU_ENTRIES.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of WORKSPACE_MENU_ENTRIES) {
      expect(entry.href.startsWith('/backend/')).toBe(true)
      expect(entry.features.length).toBeGreaterThan(0)
    }
  })

  it('places every injected item in the delivery group, one widget per host module', () => {
    const hostModules = Array.from(new Set(WORKSPACE_MENU_ENTRIES.map((entry) => entry.requiredModule)))
    const widgetsRoot = path.join(__dirname, '..', '..', 'widgets', 'injection')
    for (const hostModule of hostModules) {
      const items = buildWorkspaceMenuItems(hostModule)
      expect(items.length).toBeGreaterThan(0)
      expect(items.every((item) => item.groupId === DELIVERY_GROUP_ID)).toBe(true)
      const widgetSource = fs.readFileSync(path.join(widgetsRoot, `${hostModule.replace(/_/g, '-')}-menu`, 'widget.ts'), 'utf8')
      expect(widgetSource).toContain(`requiredModules: ['delivery_os', '${hostModule}']`)
    }
  })
})
