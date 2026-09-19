import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { DeliveryScope } from './shared'

export const DELIVERY_STAFF_KANBAN_ADAPTER_KEY = 'deliveryStaffKanbanAdapter'

export const STAFF_TASK_CREATE_COMMAND_ID = 'staff.timesheets.tasks.create'
export const STAFF_TASK_UPDATE_COMMAND_ID = 'staff.timesheets.tasks.update'
export const STAFF_TASK_COMMENT_CREATE_COMMAND_ID = 'staff.timesheets.task_comments.create'
export const STAFF_TASK_COMMENT_UPDATE_COMMAND_ID = 'staff.timesheets.task_comments.update'
export const STAFF_TASK_STATUS_TABLE = 'staff_time_task_statuses'

/** `tx` is the transactional EntityManager of the thread being imported; every staff write of the thread must join it. */
export type StaffKanbanSession = { ctx: CommandRuntimeContext; tx: EntityManager; scope: DeliveryScope }

/**
 * Delivery-owned seam to the staff Kanban. The default implementation calls the staff module's public commands; tests and
 * other hosts register their own. `settle` is called once per session after the transaction ended, with its outcome.
 */
export type DeliveryStaffKanbanAdapter = {
  resolveDefaultStatusId(staffProjectId: string, session: StaffKanbanSession): Promise<string | null>
  createTask(input: { staffProjectId: string; statusId: string; title: string; description: string }, session: StaffKanbanSession): Promise<{ taskId: string }>
  updateTask(input: { taskId: string; title: string; description: string }, session: StaffKanbanSession): Promise<void>
  createComment(input: { taskId: string; body: string }, session: StaffKanbanSession): Promise<{ commentId: string }>
  updateComment(input: { commentId: string; body: string }, session: StaffKanbanSession): Promise<void>
  settle?(session: StaffKanbanSession, committed: boolean): Promise<void>
}

type SideEffectMark = Parameters<DataEngine['markOrmEntityChange']>[0]

function readId(result: unknown, key: 'taskId' | 'commentId', commandId: string): string {
  const value = typeof result === 'object' && result !== null ? (result as Record<string, unknown>)[key] : undefined
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error(`[internal] ${commandId} returned no ${key}`)
}

/**
 * Staff commands fork `container.resolve('em')` and the command bus reads snapshots from it directly, so the session
 * answers `em` with a real EntityManager that stays inside the thread transaction, also after `fork()`.
 */
function transactionBoundEm(tx: EntityManager): EntityManager {
  return keepTransactionOnFork(tx.fork({ keepTransactionContext: true }))
}

function keepTransactionOnFork(em: EntityManager): EntityManager {
  return new Proxy(em, {
    get(target, property) {
      if (property === 'fork') {
        return (options?: Parameters<EntityManager['fork']>[0]) => keepTransactionOnFork(target.fork({ ...options, keepTransactionContext: true }))
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Staff queues its index/event side effects on the data engine and the command bus drains them right after the command.
 * Inside an open transaction the rows are not visible yet, so the marks are held back until `settle(committed)`.
 */
function bufferingDataEngine(engine: DataEngine, marks: SideEffectMark[]): DataEngine {
  return new Proxy(engine, {
    get(target, property) {
      if (property === 'markOrmEntityChange') return (mark: SideEffectMark) => void marks.push(mark)
      if (property === 'flushOrmEntityChanges') return async () => undefined
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function createCommandBusStaffKanbanAdapter(): DeliveryStaffKanbanAdapter {
  const pending = new WeakMap<EntityManager, SideEffectMark[]>()

  function marksFor(session: StaffKanbanSession): SideEffectMark[] {
    const existing = pending.get(session.tx)
    if (existing) return existing
    const created: SideEffectMark[] = []
    pending.set(session.tx, created)
    return created
  }

  function staffContext(session: StaffKanbanSession): CommandRuntimeContext {
    const { ctx, tx } = session
    const em = transactionBoundEm(tx)
    const marks = marksFor(session)
    const container = new Proxy(ctx.container, {
      get(target, property) {
        if (property === 'resolve') {
          return (name: string) => {
            if (name === 'em') return em
            const resolved = target.resolve(name)
            return name === 'dataEngine' ? bufferingDataEngine(resolved as DataEngine, marks) : resolved
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    return { ...ctx, container, request: undefined, transactionalEm: tx }
  }

  async function run(commandId: string, input: Record<string, unknown>, session: StaffKanbanSession): Promise<unknown> {
    const bus = session.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await bus.execute(commandId, { input, ctx: staffContext(session) })
    return result
  }

  return {
    async resolveDefaultStatusId(staffProjectId, session) {
      const rows = (await session.tx.getConnection().execute(
        `select id from ${STAFF_TASK_STATUS_TABLE} where tenant_id = ? and organization_id = ? and time_project_id = ? and deleted_at is null order by is_default desc, position asc limit 1`,
        [session.scope.tenantId, session.scope.organizationId, staffProjectId],
        'all',
        session.tx.getTransactionContext(),
      )) as Array<{ id?: unknown }>
      const id = rows[0]?.id
      return typeof id === 'string' ? id : null
    },
    async createTask(input, session) {
      const { scope } = session
      const result = await run(
        STAFF_TASK_CREATE_COMMAND_ID,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          timeProjectId: input.staffProjectId,
          taskStatusId: input.statusId,
          title: input.title,
          description: input.description,
        },
        session,
      )
      return { taskId: readId(result, 'taskId', STAFF_TASK_CREATE_COMMAND_ID) }
    },
    async updateTask(input, session) {
      await run(STAFF_TASK_UPDATE_COMMAND_ID, { id: input.taskId, title: input.title, description: input.description }, session)
    },
    async createComment(input, session) {
      const { scope } = session
      const result = await run(
        STAFF_TASK_COMMENT_CREATE_COMMAND_ID,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: input.taskId, body: input.body },
        session,
      )
      return { commentId: readId(result, 'commentId', STAFF_TASK_COMMENT_CREATE_COMMAND_ID) }
    },
    async updateComment(input, session) {
      await run(STAFF_TASK_COMMENT_UPDATE_COMMAND_ID, { id: input.commentId, body: input.body }, session)
    },
    async settle(session, committed) {
      const marks = pending.get(session.tx) ?? []
      pending.delete(session.tx)
      if (!committed || marks.length === 0) return
      const engine = session.ctx.container.resolve('dataEngine') as DataEngine
      for (const mark of marks) engine.markOrmEntityChange(mark)
      await engine.flushOrmEntityChanges()
    },
  }
}
