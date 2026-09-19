import { createContainer, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WorkflowDefinition } from '../../data/entities'
import { createPublishedDefinitionService } from '../published-definition-service'
import { assertImmutableDefinitionUpdate } from '../definition-edit-safety'

const mockAuthorizeGrant = jest.fn(async () => null)
const mockSyncPrincipal = jest.fn(async () => undefined)
const mockGuard = jest.fn(async () => null)
const mockAfterGuard = jest.fn(async () => undefined)
jest.mock('../definition-grant', () => ({
  normalizeGrantedFeatures: (value: string[] | null) => value ?? [],
  authorizeWorkflowGrantChange: (...args: unknown[]) => mockAuthorizeGrant(...args as []),
  syncWorkflowDefinitionPrincipal: (...args: unknown[]) => mockSyncPrincipal(...args as []),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => mockGuard(...args as []),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => mockAfterGuard(...args as []),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (em: EntityManager, entity: typeof WorkflowDefinition, where: object, options: object) => em.findOne(entity, where, options) }))
jest.mock('../caller-graph', () => ({ findSubWorkflowCallers: async () => [] }))
jest.mock('../event-trigger-service', () => ({ invalidateTriggerCache: jest.fn() }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const data = {
  steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }, { stepId: 'end', stepName: 'End', stepType: 'END' }],
  transitions: [{ transitionId: 'finish', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
} as WorkflowDefinition['definition']

function fixture() {
  const source = Object.assign(new WorkflowDefinition(), { id: '33333333-3333-4333-8333-333333333333', ...scope,
    workflowId: 'delivery', workflowName: 'Delivery', definition: structuredClone(data), lifecycle: 'published', version: 1,
    metadata: { immutablePolicy: 'delivery' }, grantedFeatures: ['delivery_os.projects.view'], kind: 'workflow' })
  const rows = [source]
  const lock = jest.fn(async () => [])
  let pending = Promise.resolve()
  const em = {
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>, options?: { orderBy?: object }) => {
      const matching = rows.filter((row) => Object.entries(where).every(([key, value]) => key === 'deletedAt' || row[key as keyof WorkflowDefinition] === value))
      if (options?.orderBy) matching.sort((first, second) => second.version - first.version)
      return matching[0] ?? null
    }),
    create: (_entity: unknown, value: Partial<WorkflowDefinition>) => Object.assign(new WorkflowDefinition(), value),
    persist: (row: WorkflowDefinition) => { rows.push(row) }, flush: async () => undefined,
    getConnection: () => ({ execute: lock }),
    transactional: async <Result>(work: (manager: unknown) => Promise<Result>) => {
      const previous = pending
      let unlock!: () => void
      pending = new Promise<void>((resolve) => { unlock = resolve })
      await previous
      try { return await work(em) } finally { unlock() }
    },
  }
  const allowed = jest.fn(async () => true)
  const event = jest.fn(async () => undefined)
  const container = createContainer()
  container.register({ em: asValue(em), rbacService: asValue({ userHasAllFeatures: allowed }), eventBus: asValue({ emitEvent: event }) })
  const service = createPublishedDefinitionService(container)
  return { source, rows, em, allowed, event, lock, service, request: { ...scope, definitionId: source.id, userId: 'publisher', input: {} } }
}

beforeEach(() => { jest.clearAllMocks(); mockAuthorizeGrant.mockResolvedValue(null); mockGuard.mockResolvedValue(null) })

test('exact read never returns another version, organization, draft or a code fallback', async () => {
  const context = fixture()
  expect(await context.service.getExactPublished(scope, 'delivery', 1)).toBe(context.source)
  expect(await context.service.getExactPublished(scope, 'delivery', 2)).toBeNull()
  expect(await context.service.getExactPublished({ ...scope, organizationId: 'foreign' }, 'delivery', 1)).toBeNull()
  context.source.lifecycle = 'draft'
  expect(await context.service.getExactPublished(scope, 'delivery', 1)).toBeNull()
})

test('publishing reauthorizes the publisher grant and mints distinct identities under a transaction lock', async () => {
  const context = fixture()
  const results = await Promise.all([context.service.publish(context.request), context.service.publish(context.request)])
  expect(results.map((result) => result.published.version)).toEqual([2, 3])
  expect(new Set(context.rows.map((row) => row.id)).size).toBe(3)
  expect(context.source.version).toBe(1)
  expect(context.lock).toHaveBeenCalledTimes(2)
  expect(mockAuthorizeGrant).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'publisher', current: [], requested: ['delivery_os.projects.view'] }))
  expect(mockSyncPrincipal).toHaveBeenCalledTimes(2)
  expect(context.event).toHaveBeenCalledTimes(2)
})

test('denied publication and denied grant never create a version', async () => {
  const context = fixture()
  context.allowed.mockResolvedValue(false)
  await expect(context.service.publish(context.request)).rejects.toMatchObject({ status: 403 })
  context.allowed.mockResolvedValue(true)
  mockAuthorizeGrant.mockResolvedValue({ status: 403, body: { error: 'Denied' } } as never)
  await expect(context.service.publish(context.request)).rejects.toMatchObject({ status: 403 })
  expect(context.rows).toHaveLength(1)
  expect(mockSyncPrincipal).not.toHaveBeenCalled()
})

test('mutation guard refusal and missing scope fail closed', async () => {
  const context = fixture()
  mockGuard.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } } as never)
  await expect(context.service.publish(context.request)).rejects.toMatchObject({ status: 409 })
  await expect(context.service.publish({ ...context.request, userId: '' })).rejects.toMatchObject({ status: 401 })
  expect(context.rows).toHaveLength(1)
})

test('new version snapshots edited conditions without mutating v1, including after completion/restart', async () => {
  const context = fixture()
  const definition = structuredClone(data)
  definition.transitions[0].condition = { field: 'approved', operator: '=', value: true }
  const next = await context.service.publish({ ...context.request, input: { draft: { definition } } })
  expect(next.published.definition.transitions[0].condition).toEqual(definition.transitions[0].condition)
  expect(context.source.definition.transitions[0].condition).toBeUndefined()
  const restarted = createPublishedDefinitionService(createContainer().register({ em: asValue(context.em) }))
  expect((await restarted.getExactPublished(scope, 'delivery', 1))?.definition).toEqual(data)
  expect(() => assertImmutableDefinitionUpdate(context.source, { definition })).toThrow()
  expect(() => assertImmutableDefinitionUpdate(context.source, { metadata: {} })).toThrow()
  expect(() => assertImmutableDefinitionUpdate({ ...context.source, metadata: null }, { definition })).not.toThrow()
})

test.each(['COMPLETED', 'RUNNING', 'WAITING'])('reuses the pinned %s instance after service restart', async (status) => {
  const context = fixture()
  const instance = { id: 'instance', definitionId: context.source.id, version: 1, status }
  const originalFind = context.em.findOne.getMockImplementation()!
  context.em.findOne.mockImplementation(async (entity, where, options) =>
    'correlationKey' in where ? instance as unknown as WorkflowDefinition : originalFind(entity, where, options))
  const startWorkflow = jest.fn()
  const executeWorkflow = jest.fn()
  const restarted = createPublishedDefinitionService(createContainer().register({
    em: asValue(context.em), workflowExecutor: asValue({ startWorkflow, executeWorkflow }),
  }))
  const input = { workflowId: 'delivery', version: 1, definitionId: context.source.id,
    correlationKey: 'delivery-project:project', initialContext: {}, userId: 'operator' }
  expect(await restarted.ensureInstance(scope, input)).toEqual({ instanceId: 'instance', definitionId: context.source.id, created: false })
  instance.version = 2
  await expect(restarted.ensureInstance(scope, input)).rejects.toMatchObject({ status: 409 })
  expect(startWorkflow).not.toHaveBeenCalled()
  expect(executeWorkflow).not.toHaveBeenCalled()
})

test('published Delivery policy freezes tool config, grant, trigger metadata and deletion, while draft edits remain possible', () => {
  const { source } = fixture()
  const definition = structuredClone(source.definition)
  definition.steps[0].config = { tool: 'new-side-effect' }
  for (const update of [{ definition }, { grantedFeatures: ['*'] }, { metadata: { immutablePolicy: 'delivery', triggers: [] } }, { deletedAt: new Date() }]) {
    expect(() => assertImmutableDefinitionUpdate(source, update)).toThrow()
  }
  expect(() => assertImmutableDefinitionUpdate({ ...source, lifecycle: 'draft' }, { definition })).not.toThrow()
})
