import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DeliveryWorkflowProjectBinding, DeliveryWorkflowSettings } from '../../data/entities'
import { createDeliveryProjectWorkflowService } from '../projectWorkflow'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (em: EntityManager, entity: object, where: object) => em.findOne(entity as never, where) }))
jest.mock('../templateMapper', () => ({ mapDeliveryWorkflow: (definition: { id: string; version: number; hash: string }) => ({
  definitionId: definition.id, definitionHash: definition.hash, hash: `template-${definition.version}`,
  template: { templateId: 'delivery', version: definition.version },
}) }))
const scope = { tenantId: 'tenant-a', organizationId: 'org-a' }
function fixture() {
  const settings = Object.assign(new DeliveryWorkflowSettings(), { ...scope, workflowId: 'delivery', version: 1,
    definitionId: 'version-1', definitionHash: 'native-1', templateHash: 'template-1' })
  const rows: DeliveryWorkflowProjectBinding[] = []
  const definitions = [{ id: 'version-1', workflowId: 'delivery', version: 1, hash: 'native-1' },
    { id: 'version-2', workflowId: 'delivery', version: 2, hash: 'native-2' }]
  const em = {
    transactional: async <Result>(work: (manager: unknown) => Promise<Result>) => work(em),
    getConnection: () => ({ execute: jest.fn(async () => []) }),
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      const candidates = entity === DeliveryWorkflowSettings ? [settings] : rows
      return candidates.find((row) => Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)) ?? null
    },
    create: (_entity: unknown, values: object) => Object.assign(new DeliveryWorkflowProjectBinding(), values),
    persist: (row: DeliveryWorkflowProjectBinding) => { if (!rows.includes(row)) rows.push(row) }, flush: async () => undefined,
  }
  const ensureInstance = jest.fn(async (_scope, input) => ({ instanceId: `instance:${input.correlationKey}`, definitionId: input.definitionId }))
  const published = { getExactPublished: jest.fn(async (_scope, _id, version) => definitions.find((row) => row.version === version)), ensureInstance }
  const container = createContainer().register({ workflowPublishedDefinitionService: asValue(published) })
  return { service: createDeliveryProjectWorkflowService(container), em: em as unknown as EntityManager, settings, rows, definitions, ensureInstance }
}
test('new projects follow current default but existing project keeps its exact version and distinct instance on restart', async () => {
  const context = fixture()
  const first = await context.service.initialize(scope, 'project-a', 'operator', context.em)
  Object.assign(context.settings, { version: 2, definitionId: 'version-2', definitionHash: 'native-2', templateHash: 'template-2' })
  const second = await context.service.initialize(scope, 'project-b', 'operator', context.em)
  const restarted = await context.service.initialize(scope, 'project-a', 'operator', context.em)
  expect(first).toEqual(restarted)
  expect(second?.definitionId).toBe('version-2')
  expect(first?.workflowInstanceId).not.toBe(second?.workflowInstanceId)
  expect(context.rows).toHaveLength(2)
  expect(context.ensureInstance.mock.calls[0][1].correlationKey).toBe('delivery-project:project-a')
})
test('scope isolation and tampered native semantic hash prevent execution', async () => {
  const context = fixture()
  expect(await context.service.initialize({ ...scope, organizationId: 'foreign' }, 'project-a', 'operator', context.em)).toBeNull()
  context.definitions[0].hash = 'changed-condition'
  await expect(context.service.initialize(scope, 'project-a', 'operator', context.em)).rejects.toMatchObject({ status: 409 })
  expect(context.ensureInstance).not.toHaveBeenCalled()
  expect(context.rows).toHaveLength(0)
})

test('manual pin binds its selected exact version rather than the organization default', async () => {
  const context = fixture()
  const selected = await context.service.initialize(scope, 'project', 'operator', context.em, { workflowId: 'delivery', version: 2 })
  expect(selected?.definitionId).toBe('version-2')
  expect(context.rows[0].version).toBe(2)
  await expect(context.service.initialize(scope, 'project', 'operator', context.em, { workflowId: 'delivery', version: 1 })).rejects.toMatchObject({ status: 409 })
})
