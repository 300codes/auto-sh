import type { OpenApiMethodDoc, OpenApiResponseDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'
import type { ZodTypeAny } from 'zod'

export const DELIVERY_OS_OPENAPI_TAG = 'Delivery OS'

export const defaultOkResponseSchema = sharedDefaultOkResponseSchema

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildDeliveryOsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: DELIVERY_OS_OPENAPI_TAG,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated tenant and organization.`,
})

export type DeliveryOsCrudErrors = Partial<Record<'POST' | 'PUT' | 'DELETE', OpenApiResponseDoc[]>>

export function createDeliveryOsCrudOpenApi(options: CrudOpenApiOptions, errors: DeliveryOsCrudErrors = {}): OpenApiRouteDoc {
  const doc = buildDeliveryOsCrudOpenApi(options)
  const methods: OpenApiRouteDoc['methods'] = { ...doc.methods }
  for (const [method, methodErrors] of Object.entries(errors) as Array<[keyof DeliveryOsCrudErrors, OpenApiResponseDoc[]]>) {
    const methodDoc: OpenApiMethodDoc | undefined = methods[method]
    if (methodDoc) methods[method] = { ...methodDoc, errors: methodErrors }
  }
  return { ...doc, methods }
}
