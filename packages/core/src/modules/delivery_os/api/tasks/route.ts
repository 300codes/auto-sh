import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { E } from '#generated/entities.ids.generated'
import { parseDeliveryInput } from '../../commands/shared'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TaskCommandResult } from '../../commands/tasks'
import { DeliveryTask } from '../../data/entities'
import { taskUpdateSchema } from '../../data/validators'
import { uuidSchema } from '../../lib/contracts'
import { createDeliveryOsCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import {
  deliveryErrorBodySchema,
  optimisticLockConflictSchema,
  taskListResponseSchema,
  taskUpdateResponseSchema,
} from '../schemas'

const rawBodySchema = z.object({}).passthrough()

const anyBodySchema = z.unknown()

const taskIdSchema = z.object({ id: uuidSchema })

const routeMetadata = {
  PUT: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: DeliveryTask,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.delivery_os.delivery_task },
  actions: {
    update: {
      commandId: 'delivery_os.tasks.update',
      schema: anyBodySchema,
      mapInput: ({ raw }) => parseDeliveryInput(taskUpdateSchema, raw ?? {}),
      response: ({ result }: { result: TaskCommandResult }) => ({
        ok: true,
        updatedAt: result.updatedAt,
        status: result.status,
      }),
    },
    delete: {
      commandId: 'delivery_os.tasks.delete',
      schema: rawBodySchema,
      mapInput: ({ parsed, ctx }) => {
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        return parseDeliveryInput(taskIdSchema, { id })
      },
      response: () => ({ ok: true }),
    },
  },
})

const { PUT, DELETE } = crud

export { PUT, DELETE }

const crudOpenApi = createDeliveryOsCrudOpenApi({
  resourceName: 'Delivery task',
  pluralName: 'Delivery tasks',
  listResponseSchema: taskListResponseSchema,
  update: {
    schema: taskUpdateSchema,
    responseSchema: taskUpdateResponseSchema,
    description:
      'Edits a task or moves it to a user-settable status (`draft`, `ready`, `blocked`, `cancelled`). Send the optimistic-lock header.',
  },
  del: {
    schema: taskIdSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Archives a task (soft delete).',
  },
}, {
  PUT: [
    { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
    { status: 404, description: 'Task not found in this scope', schema: deliveryErrorBodySchema },
    { status: 409, description: 'Invalid transition or active attempt', schema: deliveryErrorBodySchema },
    { status: 409, description: 'Stale updatedAt', schema: optimisticLockConflictSchema },
    { status: 422, description: 'Graph, acceptance-criteria or ready-gate violation', schema: deliveryErrorBodySchema },
  ],
  DELETE: [
    { status: 404, description: 'Task not found in this scope', schema: deliveryErrorBodySchema },
    { status: 409, description: 'Active attempt, reconciliation required or stale updatedAt', schema: deliveryErrorBodySchema },
    { status: 422, description: 'Task has live dependents', schema: deliveryErrorBodySchema },
  ],
})

const { GET: _listIsServedPerProject, ...writeMethods } = crudOpenApi.methods

export const openApi: OpenApiRouteDoc = { ...crudOpenApi, methods: writeMethods }
