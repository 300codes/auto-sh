import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { reportError } from '@open-mercato/telemetry'
import type { DeliveryOsFlowQueries } from '@open-mercato/core/modules/delivery_os/commands/flowQueries'
import { DeliveryWorkflowProjectBinding } from '../../../../data/entities'
import { projectBindingResponseSchema } from '../../../../data/validators'

const features = ['delivery_os.projects.view', 'workflows.definitions.view']
export const metadata = { GET: { requireAuth: true, requireFeatures: features } }
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId || !auth.sub) throw new CrudHttpError(401, { error: '[internal] Authentication required' })
    const parsedId = z.uuid().safeParse((await context.params).id)
    if (!parsedId.success) throw new CrudHttpError(404, { error: '[internal] Not found' })
    const container = await createRequestContainer()
    const organization = await resolveOrganizationScopeForRequest({ container, auth, request })
    const organizationId = organization?.selectedId ?? auth.orgId
    if (!organizationId) throw new CrudHttpError(400, { error: '[internal] Organization required' })
    const scope = { tenantId: auth.tenantId, organizationId }
    const rbac = container.resolve<{ userHasAllFeatures(userId: string, required: string[], scope: { tenantId: string; organizationId: string }): Promise<boolean> }>('rbacService')
    if (!await rbac.userHasAllFeatures(auth.sub, features, scope)) throw new CrudHttpError(403, { error: '[internal] Project workflow access denied' })
    const status = await container.resolve<DeliveryOsFlowQueries>('deliveryOsFlowQueries').flowStatus(parsedId.data, scope)
    const binding = await findOneWithDecryption(container.resolve<EntityManager>('em'), DeliveryWorkflowProjectBinding,
      { ...scope, projectId: parsedId.data }, undefined, scope)
    if (binding && status.workflowInstanceId !== binding.workflowInstanceId) throw new CrudHttpError(409, { error: '[internal] Project workflow binding is inconsistent' })
    return NextResponse.json(projectBindingResponseSchema.parse({
      schemaVersion: 'delivery-workflow-binding.v1', projectId: parsedId.data,
      binding: binding ? {
        definitionId: binding.definitionId, version: binding.version, workflowId: binding.workflowId,
        workflowInstanceId: binding.workflowInstanceId,
        studioHref: `/backend/definitions/visual-editor?id=${encodeURIComponent(binding.definitionId)}`,
      } : null,
    }))
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    reportError(error, { module: 'delivery_workflows', code: 'delivery_workflows.binding_read_failed' })
    return NextResponse.json({ error: '[internal] Project workflow unavailable' }, { status: 500 })
  }
}
export const openApi = { methods: { GET: {
  summary: 'Read the scoped exact-version Delivery project workflow binding', tags: ['Delivery Workflows'],
  pathParams: z.object({ id: z.uuid() }),
  responses: [{ status: 200, description: 'Project binding', schema: projectBindingResponseSchema }],
} } }
