const mockGenerateObject = jest.fn()
const mockResolveModel = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => null }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => ({
  createModelFactory: () => ({ resolveModel: (...args: unknown[]) => mockResolveModel(...args) }),
}), { virtual: true })
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-sdk', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}), { virtual: true })

import handle, { metadata } from '../project-brief-intake'

const payload = {
  projectId: '44444444-4444-4444-8444-444444444444',
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
let project: Record<string, unknown> | null
let storedIntake: unknown

const em = {
  fork: () => em,
  findOne: async () => storedIntake,
}
const container = {
  resolve: (name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return { execute: mockCommand }
    throw new Error(`[internal] unresolved ${name}`)
  },
}

function run(): Promise<void> {
  return handle(payload, container as never)
}

function seedCalls(): Array<Record<string, unknown>> {
  return mockCommand.mock.calls.filter(([id]) => id === 'delivery_os.intake.seed_from_brief').map(([, options]) => options.input)
}

beforeEach(() => {
  jest.resetAllMocks()
  storedIntake = null
  project = { id: payload.projectId, inputMode: 'from_brief', brief: ' Studio site selling three services. ', targetProfileId: 'wordpress-theme' }
  mockFindOneWithDecryption.mockImplementation(async () => project)
  mockResolveModel.mockReturnValue({ model: { id: 'fake-model' } })
  mockGenerateObject.mockResolvedValue({ object: { businessGoal: 'Sell three services', features: ['Contact form'] } })
  mockCommand.mockResolvedValue({ result: {} })
})

describe('project-brief-intake subscriber', () => {
  it('subscribes persistently to project creation', () => {
    expect(metadata).toMatchObject({ event: 'delivery_os.project.created', persistent: true })
  })

  it('structures the brief and seeds the wizard through the in-process command', async () => {
    await run()
    expect(mockGenerateObject.mock.calls[0][0].prompt).toContain('Studio site selling three services.')
    expect(seedCalls()).toEqual([{ projectId: payload.projectId, extracted: expect.objectContaining({ businessGoal: 'Sell three services', features: ['Contact form'] }) }])
  })

  it.each([
    ['a design-first project', { inputMode: 'from_design' }],
    ['an empty brief', { brief: '   ' }],
    ['a missing project', null],
  ])('does nothing for %s', async (_label, overrides) => {
    project = overrides === null ? null : { ...project, ...overrides }
    await run()
    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(seedCalls()).toEqual([])
  })

  it('leaves an already started wizard untouched', async () => {
    storedIntake = { id: 'intake-row' }
    await run()
    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(seedCalls()).toEqual([])
  })

  it('degrades quietly when no model is configured', async () => {
    mockResolveModel.mockImplementation(() => { throw new Error('No LLM provider is configured') })
    await expect(run()).resolves.toBeUndefined()
    expect(seedCalls()).toEqual([])
  })

  it('refuses an extraction that does not match the wizard contract', async () => {
    mockGenerateObject.mockResolvedValue({ object: { businessGoal: 'x'.repeat(8001) } })
    await run()
    expect(seedCalls()).toEqual([])
  })

  it('does not fail the event when the seeding command throws', async () => {
    mockCommand.mockRejectedValue(new Error('locked'))
    await expect(run()).resolves.toBeUndefined()
  })
})
