import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
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

    // The walkthrough is the point of the example, so it is the default; --brief-only leaves the flow to be walked.
    const briefOnly = args['brief-only'] === true || args['brief-only'] === 'true'
    const actor = briefOnly ? null : await em.findOne(User, { tenantId: resolvedTenant }, { orderBy: { createdAt: 'ASC' } })
    if (!briefOnly && !actor) {
      console.error('[delivery_os] No user in this tenant to attribute the approvals to. Run with --brief-only, or seed a user first.')
      return
    }

    const project = await seedExampleDeliveryProject(
      em,
      { tenantId: resolvedTenant, organizationId: resolvedOrganization },
      actor ? { walkthrough: { actorUserId: actor.id } } : {},
    )
    if (!project) {
      console.log(`[delivery_os] "${EXAMPLE_PROJECT_NAME}" already exists in this organization; nothing was written.`)
      return
    }
    await em.flush()
    console.log(`[delivery_os] seeded "${EXAMPLE_PROJECT_NAME}" (${project.id}).`)
    if (briefOnly) {
      console.log('[delivery_os] It stops at the brief: run the wizard, then the stage drafts and the plan, against')
      console.log('[delivery_os] the agent you connected in Settings → Tool connections.')
      return
    }
    console.log('[delivery_os] Four approved stages with the Figma renders, an active baseline and the planned tasks.')
    console.log('[delivery_os] Approvals are attributed to the seeder, not to a client — see the evidence on each stage.')
  },
}

export default [seedExample]
