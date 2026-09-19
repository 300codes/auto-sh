import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { buildAdminNav, type AdminNavItem } from '@open-mercato/ui/backend/utils/nav'
import { backendRouteMetadata, type BackendRouteMetadataEntry } from '@/.mercato/generated/backend-route-metadata.generated'
import {
  Role,
  RoleSidebarPreference,
  UserRole,
  UserSidebarPreference,
} from '@open-mercato/core/modules/auth/data/entities'
import { saveRoleSidebarPreference } from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import {
  DEFAULT_WORKSPACE_ROLES,
  buildWorkspaceSidebarSettings,
  type MainNavItem,
} from './lib/workspaceNav'

type CacheLike = { deleteByTags?: (tags: string[]) => Promise<unknown> }

function parseArgs(rest: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      index++
    } else {
      args[key] = true
    }
  }
  return args
}

function flattenNav(items: AdminNavItem[]): MainNavItem[] {
  return items.flatMap((item) => [
    { href: item.href, groupId: item.groupId, pageContext: item.pageContext },
    ...flattenNav(item.children ?? []),
  ])
}

function groupRoutesByModule(routes: BackendRouteMetadataEntry[]) {
  const grouped = new Map<string, BackendRouteMetadataEntry[]>()
  for (const route of routes) grouped.set(route.moduleId, [...(grouped.get(route.moduleId) ?? []), route])
  return Array.from(grouped, ([id, backendRoutes]) => ({ id, backendRoutes }))
}

async function collectMainNavItems(): Promise<MainNavItem[]> {
  const entries = await buildAdminNav(
    groupRoutesByModule(backendRouteMetadata),
    { auth: { roles: ['superadmin'] } },
    [],
    undefined,
    { checkFeatures: async (features) => features },
  )
  return flattenNav(entries)
}

async function resolveTargetRoles(em: EntityManager, args: Record<string, string | boolean>): Promise<Role[]> {
  const roleNames = typeof args.roles === 'string'
    ? args.roles.split(',').map((name) => name.trim()).filter(Boolean)
    : [...DEFAULT_WORKSPACE_ROLES]
  const where: Record<string, unknown> = { name: { $in: roleNames }, deletedAt: null }
  if (typeof args.tenant === 'string') where.tenantId = args.tenant
  return em.find(Role, where)
}

async function invalidateRoleNav(cache: CacheLike | undefined, roles: Role[]): Promise<void> {
  if (!cache?.deleteByTags) return
  const tags = roles.flatMap((role) => [`nav:sidebar:role:${role.id}`, `nav:sidebar:role:${role.name}`])
  try {
    await cache.deleteByTags(Array.from(new Set(tags)))
  } catch {
    console.warn('[internal] nav cache invalidation failed; the menu refreshes when the cache TTL expires')
  }
}

async function reportUserOverrides(em: EntityManager, roles: Role[]): Promise<void> {
  const links = await em.find(UserRole, { role: { $in: roles.map((role) => role.id) }, deletedAt: null }, { populate: ['user'] })
  const userIds = Array.from(new Set(links.map((link) => link.user.id)))
  if (!userIds.length) return
  const personal = await em.count(UserSidebarPreference, { user: { $in: userIds }, deletedAt: null })
  if (personal > 0) {
    console.log(`ℹ️  ${personal} personal sidebar layout(s) exist for these users; a personal layout replaces the role layout.`)
    console.log('   Reset it in the sidebar customization screen to see the Delivery workspace menu.')
  }
}

const applySidebar: ModuleCli = {
  command: 'apply-sidebar',
  async run(rest) {
    const args = parseArgs(rest)
    const { resolve } = await createRequestContainer()
    const em = (resolve('em') as EntityManager).fork()
    const cache = resolve('cache') as CacheLike | undefined
    const roles = await resolveTargetRoles(em, args)
    if (!roles.length) {
      console.error('No matching roles. Usage: mercato delivery_workspace apply-sidebar [--roles superadmin,admin] [--tenant <tenantId>] [--dry-run]')
      return
    }
    const settings = buildWorkspaceSidebarSettings(await collectMainNavItems())
    console.log(`Hiding ${settings.hiddenItems?.length ?? 0} main menu item(s); Delivery group first.`)
    if (args['dry-run']) {
      for (const href of settings.hiddenItems ?? []) console.log(`  - ${href}`)
      return
    }
    for (const role of roles) {
      await saveRoleSidebarPreference(em, { roleId: role.id, tenantId: role.tenantId ?? null, locale: 'en' }, settings)
      console.log(`✅ ${role.name} (tenant ${role.tenantId ?? 'global'})`)
    }
    await invalidateRoleNav(cache, roles)
    await reportUserOverrides(em, roles)
  },
}

const resetSidebar: ModuleCli = {
  command: 'reset-sidebar',
  async run(rest) {
    const args = parseArgs(rest)
    const { resolve } = await createRequestContainer()
    const em = (resolve('em') as EntityManager).fork()
    const cache = resolve('cache') as CacheLike | undefined
    const roles = await resolveTargetRoles(em, args)
    if (!roles.length) {
      console.error('No matching roles. Usage: mercato delivery_workspace reset-sidebar [--roles superadmin,admin] [--tenant <tenantId>]')
      return
    }
    const prefs = await em.find(RoleSidebarPreference, { role: { $in: roles.map((role) => role.id) } })
    for (const pref of prefs) em.remove(pref)
    await em.flush()
    await invalidateRoleNav(cache, roles)
    console.log(`✅ Removed ${prefs.length} role sidebar layout(s); the full menu is back.`)
  },
}

export default [applySidebar, resetSidebar]
