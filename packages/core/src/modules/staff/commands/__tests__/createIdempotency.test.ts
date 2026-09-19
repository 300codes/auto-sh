import type { EntityManager } from '@mikro-orm/postgresql'
import { staffCreateIdentity, readStaffCreateReplay, recordStaffCreate } from '../createIdempotency'
import { StaffCommandIdempotency } from '../../data/entities'

const mockFind = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFind(...args),
}))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const input = { ...scope, idempotencyKey: 'delivery:thread' }

function harness() {
  const transaction = { id: 'staff-owned' }
  const execute = jest.fn(async () => [])
  const em = {
    isInTransaction: jest.fn(() => true),
    getTransactionContext: jest.fn(() => transaction),
    getConnection: () => ({ execute }),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
  }
  return { em, manager: em as unknown as EntityManager, execute, transaction }
}

beforeEach(() => mockFind.mockReset())

it('leaves callers without a key on their existing path', async () => {
  const { manager, execute, em } = harness()
  const identity = staffCreateIdentity('create', scope, { title: 'A' })
  expect(identity).toBeNull()
  expect(await readStaffCreateReplay(manager, identity)).toBeNull()
  recordStaffCreate(manager, identity, 'resource')
  expect(execute).not.toHaveBeenCalled()
  expect(mockFind).not.toHaveBeenCalled()
  expect(em.persist).not.toHaveBeenCalled()
})

it('serializes same scoped keys in the resource transaction before reading the registry', async () => {
  const { manager, execute, transaction, em } = harness()
  const identity = staffCreateIdentity('create', input, { body: 'Text', taskId: 'task' })!
  mockFind.mockResolvedValueOnce(null)
  expect(await readStaffCreateReplay(manager, identity)).toBeNull()
  expect(execute).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'),
    [JSON.stringify([scope.tenantId, scope.organizationId, 'create', input.idempotencyKey])], 'all', transaction)
  expect(mockFind).toHaveBeenCalledWith(manager, StaffCommandIdempotency,
    { ...scope, operation: 'create', key: input.idempotencyKey }, undefined, expect.objectContaining(scope))
  recordStaffCreate(manager, identity, 'resource')
  expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ ...identity, resourceId: 'resource' }))
})

it('replays the same payload and refuses another payload with the same key', async () => {
  const { manager } = harness()
  const identity = staffCreateIdentity('create', input, { title: 'A', description: 'B' })!
  expect(staffCreateIdentity('create', input, { description: 'B', title: 'A' })).toEqual(identity)
  mockFind.mockResolvedValue({ payloadHash: identity.payloadHash, resourceId: 'created-once' })
  expect(await readStaffCreateReplay(manager, identity)).toBe('created-once')
  await expect(readStaffCreateReplay(manager, staffCreateIdentity('create', input, { title: 'Different' })))
    .rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'idempotency_conflict' }) })
})

it('fails closed outside a transaction and uses different locks across organizations and operations', async () => {
  const { manager, em, execute } = harness()
  em.isInTransaction.mockReturnValueOnce(false)
  await expect(readStaffCreateReplay(manager, staffCreateIdentity('create', input, {})))
    .rejects.toThrow('active transaction')
  mockFind.mockResolvedValue(null)
  await readStaffCreateReplay(manager, staffCreateIdentity('create', input, {}))
  await readStaffCreateReplay(manager, staffCreateIdentity('create', { ...input, organizationId: 'other' }, {}))
  await readStaffCreateReplay(manager, staffCreateIdentity('comment', input, {}))
  expect(new Set(execute.mock.calls.map((args: unknown[]) => JSON.stringify(args[1]))).size).toBe(3)
})
