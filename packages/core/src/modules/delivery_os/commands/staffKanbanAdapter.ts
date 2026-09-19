import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DeliveryScope } from './shared'

export const DELIVERY_STAFF_KANBAN_ADAPTER_KEY = 'deliveryStaffKanbanAdapter'

export const STAFF_TASK_CREATE_COMMAND_ID = 'staff.timesheets.tasks.create'
export const STAFF_TASK_UPDATE_COMMAND_ID = 'staff.timesheets.tasks.update'
export const STAFF_TASK_COMMENT_CREATE_COMMAND_ID = 'staff.timesheets.task_comments.create'
export const STAFF_TASK_COMMENT_UPDATE_COMMAND_ID = 'staff.timesheets.task_comments.update'
export const STAFF_TASK_STATUS_TABLE = 'staff_time_task_statuses'

export type StaffKanbanSession = { ctx: CommandRuntimeContext; tx: EntityManager; scope: DeliveryScope }

export type DeliveryStaffKanbanAdapter = {
  resolveDefaultStatusId(staffProjectId: string, session: StaffKanbanSession): Promise<string | null>
  createTask(input: { staffProjectId: string; statusId: string; title: string; description: string; idempotencyKey?: string }, session: StaffKanbanSession): Promise<{ taskId: string }>
  updateTask(input: { taskId: string; title: string; description: string }, session: StaffKanbanSession): Promise<void>
  createComment(input: { taskId: string; body: string; idempotencyKey?: string }, session: StaffKanbanSession): Promise<{ commentId: string }>
  updateComment(input: { commentId: string; body: string }, session: StaffKanbanSession): Promise<void>
  settle?(session: StaffKanbanSession, committed: boolean): Promise<void>
}

function readId(result: unknown, key: 'taskId' | 'commentId', commandId: string): string {
  const value = typeof result === 'object' && result !== null ? (result as Record<string, unknown>)[key] : undefined
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error(`[internal] ${commandId} returned no ${key}`)
}

export function createCommandBusStaffKanbanAdapter(): DeliveryStaffKanbanAdapter {
  async function run(commandId: string, input: Record<string, unknown>, session: StaffKanbanSession): Promise<unknown> {
    const bus = session.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await bus.execute(commandId, { input, ctx: { ...session.ctx, request: undefined, transactionalEm: undefined } })
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
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
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
        { tenantId: scope.tenantId, organizationId: scope.organizationId, taskId: input.taskId, body: input.body, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) },
        session,
      )
      return { commentId: readId(result, 'commentId', STAFF_TASK_COMMENT_CREATE_COMMAND_ID) }
    },
    async updateComment(input, session) {
      await run(STAFF_TASK_COMMENT_UPDATE_COMMAND_ID, { id: input.commentId, body: input.body }, session)
    },
  }
}
