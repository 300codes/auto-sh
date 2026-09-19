import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { reportError } from '@open-mercato/telemetry'
import { settingsInputSchema, settingsResponseSchema } from '../../data/validators'
import { createDeliveryWorkflowSettingsService, serializeSettings } from '../../lib/settingsService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_workflows.settings.view'] },
  PUT: { requireAuth: true, requireFeatures: ['delivery_workflows.settings.manage'] },
}

async function context(request: Request, feature: string) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId || !auth.sub) throw new CrudHttpError(401, { error: '[internal] Authentication required' })
  const org = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = org?.selectedId ?? auth.orgId
  if (!organizationId) throw new CrudHttpError(400, { error: '[internal] Organization required' })
  const scope = { tenantId: auth.tenantId, organizationId }
  const rbac = container.resolve<{ userHasAllFeatures(userId: string, features: string[], scope: { tenantId: string; organizationId: string }): Promise<boolean> }>('rbacService')
  if (!await rbac.userHasAllFeatures(auth.sub, [feature], scope)) throw new CrudHttpError(403, { error: '[internal] Settings denied' })
  return { container, auth, scope, service: container.resolve<ReturnType<typeof createDeliveryWorkflowSettingsService>>('deliveryWorkflowSettingsService') }
}
function failure(error: unknown) {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  reportError(error, { module: 'delivery_workflows', code: 'delivery_workflows.settings_failed' })
  return NextResponse.json({ error: '[internal] Settings unavailable' }, { status: 500 })
}
export async function GET(request: Request) {
  try {
    const { service, scope } = await context(request, 'delivery_workflows.settings.view')
    return NextResponse.json(serializeSettings(await service.get(scope)))
  } catch (error) { return failure(error) }
}
export async function PUT(request: Request) {
  try {
    const { service, scope, auth, container } = await context(request, 'delivery_workflows.settings.manage')
    const existing = await service.get(scope)
    const guardInput = { ...scope, userId: auth.sub, resourceKind: 'delivery_workflows.settings', resourceId: existing?.id ?? 'new',
      operation: existing ? 'update' as const : 'create' as const, requestMethod: 'PUT', requestHeaders: request.headers }
    const guard = await validateCrudMutationGuard(container, guardInput)
    if (guard && !guard.ok) throw new CrudHttpError(guard.status, guard.body)
    const row = await service.save(scope, await readJsonSafe(request), request, auth.sub)
    if (guard?.shouldRunAfterSuccess) await runCrudMutationGuardAfterSuccess(container, { ...guardInput, resourceId: row.id, metadata: guard.metadata })
    return NextResponse.json(serializeSettings(row))
  } catch (error) { return failure(error) }
}
export const openApi = { methods: {
  GET: { summary: 'Read the scoped default Delivery process', tags: ['Delivery Workflows'], responses: [{ status: 200, description: 'Settings', schema: settingsResponseSchema }] },
  PUT: { summary: 'Select an exact published Delivery process version for new projects', tags: ['Delivery Workflows'], requestBody: settingsInputSchema,
    responses: [{ status: 200, description: 'Settings', schema: settingsResponseSchema }, { status: 409, description: 'Concurrent settings edit' }] },
} }
