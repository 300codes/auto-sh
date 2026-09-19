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

  it('hands staff a context whose em stays in the thread transaction, also after fork, and carries no request', async () => {
    const { session, calls, forks } = makeSession({ [STAFF_TASK_CREATE_COMMAND_ID]: { taskId: TASK_ID } })
    await createCommandBusStaffKanbanAdapter().createTask({ staffProjectId: STAFF_PROJECT_ID, statusId: STATUS_ID, title: 'T', description: 'D' }, session)
    const staffCtx = calls[0].ctx
    expect(staffCtx.request).toBeUndefined()
    expect(staffCtx.transactionalEm).toBe(session.tx)
    expect(staffCtx.auth).toBe(session.ctx.auth)
    const em = staffCtx.container.resolve('em') as unknown as FakeEm
    expect(em.label).toBe('tx>fork')
    expect(em.getTransactionContext()).toBe(TX_CONTEXT)
    const forked = em.fork() as unknown as FakeEm
    forked.fork({ clear: true } as ForkOptions)
    expect(forks.every((options) => options.keepTransactionContext === true)).toBe(true)
    expect(forks).toHaveLength(3)
    expect(staffCtx.container.resolve('rbacService')).toEqual({ marker: true })
  })

  it('holds staff side effects back until the transaction committed and drops them on rollback', async () => {
    const { session, calls, engine } = makeSession({ [STAFF_TASK_CREATE_COMMAND_ID]: { taskId: TASK_ID } })
    const adapter = createCommandBusStaffKanbanAdapter()
    const mark = { action: 'created' as const, entity: { id: TASK_ID }, identifiers: { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID } }

    await adapter.createTask({ staffProjectId: STAFF_PROJECT_ID, statusId: STATUS_ID, title: 'T', description: 'D' }, session)
    const staffEngine = calls[0].ctx.container.resolve('dataEngine') as typeof engine
    staffEngine.markOrmEntityChange(mark)
    await staffEngine.flushOrmEntityChanges()
    expect(staffEngine.other()).toBe('kept')
    expect(engine.markOrmEntityChange).not.toHaveBeenCalled()
    expect(engine.flushOrmEntityChanges).not.toHaveBeenCalled()

    await adapter.settle?.(session, false)
    expect(engine.markOrmEntityChange).not.toHaveBeenCalled()

    await adapter.createTask({ staffProjectId: STAFF_PROJECT_ID, statusId: STATUS_ID, title: 'T', description: 'D' }, session)
    ;(calls[1].ctx.container.resolve('dataEngine') as typeof engine).markOrmEntityChange(mark)
    await adapter.settle?.(session, true)
    expect(engine.markOrmEntityChange).toHaveBeenCalledTimes(1)
    expect(engine.markOrmEntityChange).toHaveBeenCalledWith(mark)
    expect(engine.flushOrmEntityChanges).toHaveBeenCalledTimes(1)
  })
})
