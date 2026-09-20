import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { EXAMPLE_PROJECT_NAME, seedExampleDeliveryProject } from './lib/exampleProject'

type ParsedArgs = Record<string, string | boolean>

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part || !part.startsWith('--')) continue
    const [rawKey, rawValue] = part.replace(/^--/, '').split('=')
    const key = rawKey.trim()
    if (!key) continue
    if (rawValue !== undefined) { args[key] = rawValue; continue }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) { args[key] = next; index += 1 } else { args[key] = true }
  }
  return args
}

/**
 * Seeds the example delivery project into an existing installation, which `mercato init --no-examples` skipped and a
 * running instance has no other way to get. The scope is resolved the same way the seeder would: an explicit tenant
 * and organization, or the only ones that exist.
 */
const seedExample: ModuleCli = {
  command: 'seed-example',
  async run(rest) {
    const args = parseArgs(rest)
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const tenantId = typeof args.tenant === 'string' ? args.tenant : (await em.find(Tenant, {}, { limit: 2 })).map((row) => row.id)
    const organizationId = typeof args.org === 'string' ? args.org : (await em.find(Organization, {}, { limit: 2 })).map((row) => row.id)

    const resolvedTenant = typeof tenantId === 'string' ? tenantId : tenantId.length === 1 ? tenantId[0] : null
    const resolvedOrganization = typeof organizationId === 'string' ? organizationId : organizationId.length === 1 ? organizationId[0] : null
    if (!resolvedTenant || !resolvedOrganization) {
      console.error('Usage: mercato delivery_os seed-example --tenant <tenantId> --org <organizationId>')
      console.error('       (both are optional when the installation has exactly one of each)')
      return
    }

    const project = await seedExampleDeliveryProject(em, { tenantId: resolvedTenant, organizationId: resolvedOrganization })
    if (!project) {
      console.log(`[delivery_os] "${EXAMPLE_PROJECT_NAME}" already exists in this organization; nothing was written.`)
      return
    }
    await em.flush()
    console.log(`[delivery_os] seeded "${EXAMPLE_PROJECT_NAME}" (${project.id}).`)
    console.log('[delivery_os] Open it in Delivery projects and run the brief wizard; the stage drafts and the plan')
    console.log('[delivery_os] come from the agent you connected in Settings → Tool connections.')
  },
}

export default [seedExample]
