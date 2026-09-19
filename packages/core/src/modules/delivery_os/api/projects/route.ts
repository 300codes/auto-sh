import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { E } from '#generated/entities.ids.generated'
import type { ProjectCommandResult } from '../../commands/projects'
import { parseDeliveryInput, resolveDeliveryScope } from '../../commands/shared'
import { DeliveryProject } from '../../data/entities'
import { projectCreateSchema, projectListQuerySchema, projectUpdateSchema } from '../../data/validators'
import { uuidSchema } from '../../lib/contracts'
import { createDeliveryOsCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import {
  deliveryErrorBodySchema,
  optimisticLockConflictSchema,
  projectCreateResponseSchema,
  projectListItemSchema,
  projectUpdateResponseSchema,
} from '../schemas'
import { serializeProjectListRow } from '../serializers'

const rawBodySchema = z.object({}).passthrough()

const anyBodySchema = z.unknown()

const projectIdSchema = z.object({ id: uuidSchema })

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['delivery_os.projects.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: DeliveryProject,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.delivery_os.delivery_project },
  list: {
    schema: projectListQuerySchema,
    entityId: E.delivery_os.delivery_project,
    fields: [
      'id',
      'name',
      'input_mode',
      'brief',
      'target_profile_id',
      'target_profile_version',
      'repository_ref',
      'active_baseline_id',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    sortFieldMap: { name: 'name', createdAt: 'created_at', updatedAt: 'updated_at' },
    defaultSort: { field: 'createdAt', dir: 'desc' },
    export: { enabled: false },
    buildFilters: async (query, ctx) => {
      const scope = resolveDeliveryScope(ctx)
      const filters: Record<string, unknown> = { organization_id: { $eq: scope.organizationId } }
      if (query.search) filters.name = { $ilike: buildIlikeTerm(query.search) }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => serializeProjectListRow(item),
  },
  actions: {
    create: {
      commandId: 'delivery_os.projects.create',
      schema: anyBodySchema,
      mapInput: ({ raw }) => parseDeliveryInput(projectCreateSchema, raw ?? {}),
      response: ({ result }: { result: ProjectCommandResult }) => ({ id: result.projectId, updatedAt: result.updatedAt }),
      status: 201,
    },
    update: {
      commandId: 'delivery_os.projects.update',
      schema: anyBodySchema,
      mapInput: ({ raw }) => parseDeliveryInput(projectUpdateSchema, raw ?? {}),
      response: ({ result }: { result: ProjectCommandResult }) => ({ ok: true, updatedAt: result.updatedAt }),
    },
    delete: {
      commandId: 'delivery_os.projects.delete',
      schema: rawBodySchema,
      mapInput: ({ parsed, ctx }) => {
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        return parseDeliveryInput(projectIdSchema, { id })
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }

export function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const includeArchived = parseBooleanToken(url.searchParams.get('includeArchived')) === true
  url.searchParams.delete('withDeleted')
  if (includeArchived) url.searchParams.set('withDeleted', 'true')
  return crud.GET(new Request(url, request))
}

export const openApi = createDeliveryOsCrudOpenApi({
  resourceName: 'Delivery project',
  pluralName: 'Delivery projects',
  querySchema: projectListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(projectListItemSchema),
  create: {
    schema: projectCreateSchema,
    responseSchema: projectCreateResponseSchema,
    description: 'Creates a delivery project with an empty draft specification.',
  },
  update: {
    schema: projectUpdateSchema,
    responseSchema: projectUpdateResponseSchema,
    description: 'Updates project fields or replaces the draft specification. Send the optimistic-lock header.',
  },
  del: {
    schema: projectIdSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Archives a project (soft delete). Blocked while an attempt is active or unreconciled.',
  },
}, {
  POST: [
    { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
    { status: 422, description: 'Unknown target profile', schema: deliveryErrorBodySchema },
  ],
  PUT: [
    { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
    { status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema },
    { status: 409, description: 'Stale updatedAt', schema: optimisticLockConflictSchema },
  ],
  DELETE: [
    { status: 404, description: 'Project not found in this scope', schema: deliveryErrorBodySchema },
    { status: 409, description: 'Active attempt, reconciliation required or stale updatedAt', schema: deliveryErrorBodySchema },
  ],
})
