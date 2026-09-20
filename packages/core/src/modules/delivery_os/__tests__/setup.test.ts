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

  it('carries the brief the walkthrough was really built from', () => {
    for (const fragment of ['#082C55', 'Asystenci wiedzy', 'Poza zakresem', 'obsługa klawiaturą']) {
      expect(EXAMPLE_BRIEF).toContain(fragment)
    }
    expect(EXAMPLE_BRIEF.length).toBeGreaterThan(2000)
  })
})

describe('the walkthrough content', () => {
  it('ships the renders the agent produced, each bound to the Figma node it came from', async () => {
    const { EXAMPLE_ASSETS, EXAMPLE_FIGMA_FILE_KEY, readExampleAsset } = await import('../lib/exampleAssets')
    expect(EXAMPLE_ASSETS.length).toBeGreaterThanOrEqual(4)
    for (const asset of EXAMPLE_ASSETS) {
      expect(asset.nodeId).toMatch(/^[0-9]+:[0-9]+$/)
      const { bytes, sha256 } = await readExampleAsset(asset)
      expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
      expect(sha256).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(EXAMPLE_FIGMA_FILE_KEY).toMatch(/^[A-Za-z0-9]{10,}$/)
  })

  it('maps every planned task onto criteria the scope declares', async () => {
    const { EXAMPLE_SCOPE_CONTENT, EXAMPLE_TASKS } = await import('../lib/exampleContent')
    const known = new Set(EXAMPLE_SCOPE_CONTENT.acceptanceCriteria.map((criterion) => criterion.id))
    expect(EXAMPLE_TASKS.length).toBeGreaterThan(0)
    for (const task of EXAMPLE_TASKS) {
      expect(task.acIds.length).toBeGreaterThan(0)
      for (const acId of task.acIds) expect(known.has(acId)).toBe(true)
    }
  })

  it('keeps no encrypted tenant material in the repository', async () => {
    const { EXAMPLE_INTAKE_BRIEF } = await import('../lib/exampleContent')
    const serialised = JSON.stringify(EXAMPLE_INTAKE_BRIEF)
    expect(serialised).not.toMatch(/:v1"$|:v1$/)
    expect(serialised).toContain('#082C55')
  })
})
