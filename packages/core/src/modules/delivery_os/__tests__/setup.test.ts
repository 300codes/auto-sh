jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }),
}))

import setup from '../setup'
import { features } from '../acl'
import { EXAMPLE_BRIEF, EXAMPLE_PROJECT_NAME, EXAMPLE_TARGET_PROFILE_ID, seedExampleDeliveryProject } from '../lib/exampleProject'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

/** Every grant an operator needs between opening a project and reserving an execution attempt. */
const PATH_TO_EXECUTION = [
  'delivery_os.projects.view',
  'delivery_os.projects.manage',
  'delivery_os.flow.manage',
  'delivery_os.stages.approve',
  'delivery_os.baselines.approve',
  'delivery_os.attempts.manage',
]

describe('delivery_os setup', () => {
  it('grants a delivery operator the whole path, not just its first half', () => {
    const granted = setup.defaultRoleFeatures?.employee ?? []
    for (const grant of PATH_TO_EXECUTION) expect(granted).toContain(grant)
  })

  it('grants only features the module actually declares', () => {
    const declared = new Set(features.map((feature) => (typeof feature === 'string' ? feature : feature.id)))
    for (const grant of setup.defaultRoleFeatures?.employee ?? []) expect(declared.has(grant)).toBe(true)
  })

  it('leaves the irreversible steps to an admin', () => {
    const granted = setup.defaultRoleFeatures?.employee ?? []
    expect(granted).not.toContain('delivery_os.deploy.approve')
    expect(granted).not.toContain('delivery_os.release.approve')
  })
})

describe('the example project', () => {
  function emWith(existing: unknown) {
    const persisted: unknown[] = []
    return {
      persisted,
      em: {
        findOne: jest.fn(async () => existing),
        create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'example-id', ...data })),
        persist: jest.fn((entity: unknown) => { persisted.push(entity) }),
      },
    }
  }

  it('creates a project that starts at the brief, so the flow is walked rather than faked', async () => {
    const { em, persisted } = emWith(null)
    const project = await seedExampleDeliveryProject(em as never, scope)

    expect(project).toMatchObject({
      name: EXAMPLE_PROJECT_NAME,
      inputMode: 'from_brief',
      targetProfileId: EXAMPLE_TARGET_PROFILE_ID,
    })
    expect(project?.activeBaselineId).toBeUndefined()
    expect(project?.brief).toBe(EXAMPLE_BRIEF)
    expect(persisted).toHaveLength(1)
  })

  it('is idempotent, so seeding twice does not leave two example projects', async () => {
    const { em, persisted } = emWith({ id: 'already-there' })
    await expect(seedExampleDeliveryProject(em as never, scope)).resolves.toBeNull()
    expect(persisted).toEqual([])
  })

  it('carries a brief an agent can actually structure', () => {
    for (const fragment of ['#082C55', 'Knowledge assistants', 'Out of scope', 'keyboard operation with a visible focus ring']) {
      expect(EXAMPLE_BRIEF).toContain(fragment)
    }
    expect(EXAMPLE_BRIEF.length).toBeGreaterThan(2000)
  })
})
