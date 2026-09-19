import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DeliveryWorkflowSettings } from '../../data/entities'
import { createDeliveryWorkflowSettingsService, serializeSettings } from '../settingsService'
const mockLock = jest.fn(async () => undefined)
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: (...args: unknown[]) => mockLock(...args as []) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (em: EntityManager, entity: object, where: object) => em.findOne(entity as never, where) }))
jest.mock('../templateMapper', () => ({ mapDeliveryWorkflow: () => ({ definitionHash: 'native', hash: 'template' }) }))
const scope = { tenantId: 'tenant-a', organizationId: 'org-a' }
function fixture() {
  const row = Object.assign(new DeliveryWorkflowSettings(), { ...scope, id: 'settings', workflowId: 'delivery', version: 1,
    definitionId: 'definition-1', definitionHash: 'native', templateHash: 'template', updatedAt: new Date('2026-09-19T12:00:00Z') })
  const em = {
    findOne: async (_entity: unknown, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => row[key as keyof DeliveryWorkflowSettings] === value) ? row : null,
    transactional: async <Result>(work: (manager: unknown) => Promise<Result>) => work(em),
    getConnection: () => ({ execute: jest.fn(async () => []) }), persist: jest.fn(), flush: jest.fn(),
  }
  const allowed = jest.fn(async () => true)
  const exact = jest.fn(async () => ({ id: 'definition-2', workflowId: 'delivery', version: 2, enabled: true }))
  const container = createContainer().register({ em: asValue(em), rbacService: asValue({ userHasAllFeatures: allowed }), workflowPublishedDefinitionService: asValue({ getExactPublished: exact }) })
  return { row, em, allowed, exact, service: createDeliveryWorkflowSettingsService(container) }
}
beforeEach(() => { mockLock.mockReset(); mockLock.mockResolvedValue(undefined) })
test('settings reads are scoped and include the exact Studio ID and optimistic version', async () => {
  const context = fixture()
  expect(await context.service.get({ ...scope, organizationId: 'foreign' })).toBeNull()
  expect(serializeSettings(await context.service.get(scope))).toMatchObject({ setting: {
    updatedAt: '2026-09-19T12:00:00.000Z', studioHref: '/backend/definitions/visual-editor?id=definition-1',
  } })
})
test('stale settings update fails 409 before changing the default', async () => {
  const context = fixture()
  mockLock.mockRejectedValue(new CrudHttpError(409, { error: 'Conflict' }))
  await expect(context.service.save(scope, { workflowId: 'delivery', version: 2 }, new Request('http://local/settings'), 'user')).rejects.toMatchObject({ status: 409 })
  expect(context.row.version).toBe(1)
  expect(context.em.persist).not.toHaveBeenCalled()
})
test('denied writer never resolves the native workflow and authorized update checks the exact version', async () => {
  const context = fixture()
  context.allowed.mockResolvedValue(false)
  await expect(context.service.save(scope, { workflowId: 'delivery', version: 2 }, new Request('http://local/settings'), 'user')).rejects.toMatchObject({ status: 403 })
  expect(context.exact).not.toHaveBeenCalled()
  context.allowed.mockResolvedValue(true)
  await context.service.save(scope, { workflowId: 'delivery', version: 2 }, new Request('http://local/settings'), 'user')
  expect(context.exact).toHaveBeenCalledWith(scope, 'delivery', 2)
  expect(context.row.version).toBe(2)
  expect(mockLock).toHaveBeenCalledTimes(1)
})
