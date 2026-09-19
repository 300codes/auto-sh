import { GET } from '../route'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
const mockAuth = jest.fn()
const mockAllowed = jest.fn()
const mockStatus = jest.fn()
const mockFind = jest.fn()
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const projectId = '33333333-3333-4333-8333-333333333333'
const definitionId = '44444444-4444-4444-8444-444444444444'
const instanceId = '55555555-5555-4555-8555-555555555555'
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => mockAuth() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: async () => ({ selectedId: '22222222-2222-4222-8222-222222222222' }) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({ resolve: (name: string) => {
  if (name === 'rbacService') return { userHasAllFeatures: mockAllowed }
  if (name === 'deliveryOsFlowQueries') return { flowStatus: mockStatus }
  return {}
} }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => mockFind(...args) }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
const read = () => GET(new Request('http://local/binding'), { params: Promise.resolve({ id: projectId }) })
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockReturnValue({ sub: 'user', tenantId, orgId: organizationId })
  mockAllowed.mockResolvedValue(true)
  mockStatus.mockResolvedValue({ workflowInstanceId: instanceId })
  mockFind.mockResolvedValue({ definitionId, version: 3, workflowId: 'project-flow', workflowInstanceId: instanceId })
})
test('returns only the real binding identity and exact Studio URL after scoped project access', async () => {
  const response = await read()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ schemaVersion: 'delivery-workflow-binding.v1', projectId,
    binding: { definitionId, version: 3, workflowId: 'project-flow', workflowInstanceId: instanceId, studioHref: `/backend/definitions/visual-editor?id=${definitionId}` } })
  expect(mockStatus).toHaveBeenCalledWith(projectId, { tenantId, organizationId })
  expect(mockFind).toHaveBeenCalledWith(expect.anything(), expect.anything(), { tenantId, organizationId, projectId }, undefined, { tenantId, organizationId })
})
test('a built-in project has an explicit null binding without synthesizing a definition ID', async () => {
  mockFind.mockResolvedValue(null)
  expect(await (await read()).json()).toEqual({ schemaVersion: 'delivery-workflow-binding.v1', projectId, binding: null })
})
test('foreign or missing project is hidden before the binding lookup', async () => {
  mockStatus.mockRejectedValue(new CrudHttpError(404, { error: 'Not found' }))
  expect((await read()).status).toBe(404)
  expect(mockFind).not.toHaveBeenCalled()
})
test('permission denial and inconsistent instance linkage fail closed', async () => {
  mockAllowed.mockResolvedValue(false)
  expect((await read()).status).toBe(403)
  expect(mockFind).not.toHaveBeenCalled()
  mockAllowed.mockResolvedValue(true)
  mockStatus.mockResolvedValue({ workflowInstanceId: 'different-instance' })
  expect((await read()).status).toBe(409)
})
