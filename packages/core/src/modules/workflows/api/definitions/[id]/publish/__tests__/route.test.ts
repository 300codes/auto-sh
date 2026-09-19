import { NextRequest } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { POST, metadata } from '../route'
const mockPublish = jest.fn()
const mockAuth = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({ resolve: (name: string) => {
  if (name !== 'workflowPublishedDefinitionService') throw new Error('Unexpected service')
  return { publish: mockPublish }
} }) }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => mockAuth() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: async () => ({ selectedId: 'org' }) }))
jest.mock('../../../serialize', () => ({ serializeWorkflowDefinition: (definition: unknown) => definition }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
beforeEach(() => { jest.clearAllMocks(); mockAuth.mockReturnValue({ sub: 'publisher', tenantId: 'tenant', orgId: 'org' }) })
const request = () => new NextRequest('http://local/api/workflows/definitions/definition/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: { workflowName: 'Edited' } }) })
test('route delegates publication to the scoped public service with publisher and headers', async () => {
  mockPublish.mockResolvedValue({ published: { id: 'version-2', version: 2 }, breakingChanges: [] })
  const response = await POST(request(), { params: Promise.resolve({ id: 'definition' }) })
  expect(response.status).toBe(200)
  expect(metadata.requireFeatures).toEqual(['workflows.definitions.publish'])
  expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ definitionId: 'definition', tenantId: 'tenant', organizationId: 'org', userId: 'publisher', input: { draft: { workflowName: 'Edited' } }, requestHeaders: expect.any(Headers) }))
})
test.each([403, 409])('public service denial %s is preserved by the route', async (status) => {
  mockPublish.mockRejectedValue(new CrudHttpError(status, { error: 'Refused' }))
  const response = await POST(request(), { params: Promise.resolve({ id: 'definition' }) })
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ error: 'Refused' })
})
test('anonymous requests never reach publication service', async () => {
  mockAuth.mockReturnValue(null)
  expect((await POST(request(), { params: Promise.resolve({ id: 'definition' }) })).status).toBe(401)
  expect(mockPublish).not.toHaveBeenCalled()
})
