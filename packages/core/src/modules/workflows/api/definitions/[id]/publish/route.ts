import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { reportError } from '@open-mercato/telemetry'
import { serializeWorkflowDefinition } from '../../serialize'
import { publishDefinitionInputSchema, type PublishedDefinitionService } from '../../../../lib/published-definition-service'

export const metadata = { requireAuth: true, requireFeatures: ['workflows.definitions.publish'] }

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId
    if (!tenantId || !organizationId) return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
    const service = container.resolve<PublishedDefinitionService>('workflowPublishedDefinitionService')
    const result = await service.publish({ definitionId: id, tenantId, organizationId, userId: auth.sub,
      input: await readJsonSafe(request, {}), requestHeaders: request.headers })
    return NextResponse.json({ data: serializeWorkflowDefinition(result.published), breakingChanges: result.breakingChanges, message: 'Workflow definition published successfully' })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    reportError(error, { module: 'workflows', code: 'workflows.publication_failed' })
    return NextResponse.json({ error: 'Failed to publish workflow definition' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Publish a new workflow definition version',
      description:
        'Mints a frozen published version snapshotting the definition and its IO port contract. Returns affected sub-workflow callers; pass acknowledgeBreakingChanges=true to publish despite breaking changes.',
      tags: ['Workflows'],
      pathParams: z.object({ id: z.string().describe('Workflow definition id') }),
      requestBody: publishDefinitionInputSchema,
      responses: [
        {
          status: 200,
          description: 'Published',
          example: {
            data: { id: '…', workflowId: 'verify-policy', version: 2, lifecycle: 'published' },
            breakingChanges: [],
            message: 'Workflow definition published successfully',
          },
        },
        {
          status: 409,
          description: 'Breaking changes not acknowledged',
          example: {
            error: 'Publishing would break existing sub-workflow mappings',
            breakingChanges: [{ workflowId: 'order-flow', version: 1, stepId: 'sub', brokenMappings: ['input:orderId'] }],
          },
        },
        { status: 404, description: 'Not found', example: { error: 'Workflow definition not found' } },
      ],
    },
  },
}
