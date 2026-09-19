import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  createCommandBusStaffKanbanAdapter,
  STAFF_TASK_COMMENT_CREATE_COMMAND_ID,
  STAFF_TASK_COMMENT_UPDATE_COMMAND_ID,
  STAFF_TASK_CREATE_COMMAND_ID,
  STAFF_TASK_STATUS_TABLE,
  STAFF_TASK_UPDATE_COMMAND_ID,
  type StaffKanbanSession,
} from '../staffKanbanAdapter'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_PROJECT_ID = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa'
const STATUS_ID = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb'
const TASK_ID = 'cccccccc-0000-4000-8000-cccccccccccc'
const COMMENT_ID = 'dddddddd-0000-4000-8000-dddddddddddd'
const TX_CONTEXT = { trx: 'thread-transaction' }

type ForkOptions = { keepTransactionContext?: boolean }
type FakeEm = { fork: jest.Mock; getConnection: jest.Mock; getTransactionContext: jest.Mock; label: string }

function makeEm(label: string, execute: jest.Mock, forks: ForkOptions[]): FakeEm {
  const em: FakeEm = {
    label,
    fork: jest.fn((options: ForkOptions = {}) => {
      forks.push(options)
      return makeEm(`${label}>fork`, execute, forks)
    }),
    getConnection: jest.fn(() => ({ execute })),
    getTransactionContext: jest.fn(() => TX_CONTEXT),
  }
  return em
}

function makeSession(results: Record<string, unknown> = {}) {
  const forks: ForkOptions[] = []
  const execute = jest.fn(async () => [{ id: STATUS_ID }])
  const tx = makeEm('tx', execute, forks)
  const engine = { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => undefined), other: jest.fn(() => 'kept') }
  const calls: Array<{ commandId: string; input: Record<string, unknown>; ctx: CommandRuntimeContext }> = []
  const bus = {
    execute: jest.fn(async (commandId: string, options: { input: Record<string, unknown>; ctx: CommandRuntimeContext }) => {
      calls.push({ commandId, input: options.input, ctx: options.ctx })
      return { result: results[commandId] ?? {}, logEntry: null }
    }),
  }
  const services: Record<string, unknown> = { commandBus: bus, dataEngine: engine, rbacService: { marker: true } }
  const ctx = {
    container: { resolve: (name: string) => services[name] },
    auth: { sub: 'user', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: new Request('http://localhost/api', { headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-19T08:00:00.000Z' } }),
  } as unknown as CommandRuntimeContext
  const session: StaffKanbanSession = { ctx, tx: tx as unknown as EntityManager, scope: { tenantId: TENANT_ID, organizationId: ORG_ID } }
  return { session, engine, bus, calls, execute, forks }
}

describe('default deliveryStaffKanbanAdapter', () => {
  it('reads the default status with one scoped SQL select inside the session transaction', async () => {
    const { session, execute } = makeSession()
    const adapter = createCommandBusStaffKanbanAdapter()
    await expect(adapter.resolveDefaultStatusId(STAFF_PROJECT_ID, session)).resolves.toBe(STATUS_ID)
    const [sql, params, method, transaction] = execute.mock.calls[0] as unknown as [string, unknown[], string, unknown]
    expect(sql).toContain(`from ${STAFF_TASK_STATUS_TABLE}`)
    expect(sql).toContain('tenant_id = ? and organization_id = ? and time_project_id = ?')
    expect(sql).toContain('deleted_at is null order by is_default desc, position asc limit 1')
    expect(params).toEqual([TENANT_ID, ORG_ID, STAFF_PROJECT_ID])
    expect(method).toBe('all')
    expect(transaction).toBe(TX_CONTEXT)
  })

  it('answers null when the staff project has no status column', async () => {
    const { session, execute } = makeSession()
    execute.mockResolvedValueOnce([])
    await expect(createCommandBusStaffKanbanAdapter().resolveDefaultStatusId(STAFF_PROJECT_ID, session)).resolves.toBeNull()
  })

  it('calls the four public staff commands with scoped inputs and returns their ids', async () => {
    const { session, calls } = makeSession({
      [STAFF_TASK_CREATE_COMMAND_ID]: { taskId: TASK_ID },
      [STAFF_TASK_COMMENT_CREATE_COMMAND_ID]: { commentId: COMMENT_ID },
    })
    const adapter = createCommandBusStaffKanbanAdapter()
    await expect(adapter.createTask({ staffProjectId: STAFF_PROJECT_ID, statusId: STATUS_ID, title: 'Title', description: 'Body' }, session)).resolves.toEqual({ taskId: TASK_ID })
    await adapter.updateTask({ taskId: TASK_ID, title: 'New', description: 'New body' }, session)
    await expect(adapter.createComment({ taskId: TASK_ID, body: 'Reply' }, session)).resolves.toEqual({ commentId: COMMENT_ID })
    await adapter.updateComment({ commentId: COMMENT_ID, body: 'Edited' }, session)
    expect(calls.map((call) => [call.commandId, call.input])).toEqual([
      [STAFF_TASK_CREATE_COMMAND_ID, { tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: STAFF_PROJECT_ID, taskStatusId: STATUS_ID, title: 'Title', description: 'Body' }],
      [STAFF_TASK_UPDATE_COMMAND_ID, { id: TASK_ID, title: 'New', description: 'New body' }],
      [STAFF_TASK_COMMENT_CREATE_COMMAND_ID, { tenantId: TENANT_ID, organizationId: ORG_ID, taskId: TASK_ID, body: 'Reply' }],
      [STAFF_TASK_COMMENT_UPDATE_COMMAND_ID, { id: COMMENT_ID, body: 'Edited' }],
    ])
  })

  it('fails when a staff create command returns no id', async () => {
    const { session } = makeSession()
    await expect(createCommandBusStaffKanbanAdapter().createTask({ staffProjectId: STAFF_PROJECT_ID, statusId: STATUS_ID, title: 'T', description: 'D' }, session)).rejects.toThrow('[internal]')
  })

  it('uses Staff-owned transactions and forwards stable creation keys without replacing DI or side effects', async () => {
    const { session, calls, forks, engine } = makeSession({
      [STAFF_TASK_CREATE_COMMAND_ID]: { taskId: TASK_ID },
      [STAFF_TASK_COMMENT_CREATE_COMMAND_ID]: { commentId: COMMENT_ID },
    })
    const adapter = createCommandBusStaffKanbanAdapter()
    await adapter.createTask({ staffProjectId: STAFF_PROJECT_ID, statusId: STATUS_ID, title: 'T', description: 'D', idempotencyKey: 'thread-key' }, session)
    await adapter.createComment({ taskId: TASK_ID, body: 'Reply', idempotencyKey: 'reply-key' }, session)
    expect(calls[0].input.idempotencyKey).toBe('thread-key')
    expect(calls[1].input.idempotencyKey).toBe('reply-key')
    expect(calls[0].ctx.container).toBe(session.ctx.container)
    expect(calls[0].ctx.transactionalEm).toBeUndefined()
    expect(calls[0].ctx.request).toBeUndefined()
    expect(calls[0].ctx.container.resolve('dataEngine')).toBe(engine)
    expect(forks).toHaveLength(0)
  })
})
