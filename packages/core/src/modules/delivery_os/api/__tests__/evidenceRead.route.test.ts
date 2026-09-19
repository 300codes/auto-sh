/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { GET as readFile } from '../projects/[id]/evidence/[evidenceId]/attachments/[attachmentId]/route'
import { GET as readDetail } from '../projects/[id]/evidence/[evidenceId]/route'
import { GET as readList } from '../projects/[id]/evidence/route'
const mockFeatures = jest.fn()
const mockEvidence = jest.fn()
const mockDescribe = jest.fn()
const mockRead = jest.fn()
const mockList = jest.fn()
const mockDetail = jest.fn()
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const projectId = '33333333-3333-4333-8333-333333333333'
const evidenceId = '44444444-4444-4444-8444-444444444444'
const attachmentId = '55555555-5555-4555-8555-555555555555'
jest.mock('../../commands/evidenceQueries', () => ({ requireScopedEvidence: (...args: unknown[]) => mockEvidence(...args) }))
jest.mock('../routeSupport', () => ({
  ...jest.requireActual('../routeSupport'),
  resolveDeliveryRouteContext: async () => ({ auth: { sub: 'user', tenantId: scope.tenantId, orgId: scope.organizationId }, container: { resolve: (key: string) => key === 'attachmentService' ? { describeScoped: mockDescribe, readScoped: mockRead } : { list: mockList, detail: mockDetail } } }),
  requireDeliveryFeatures: (...args: unknown[]) => mockFeatures(...args),
  resolveRouteEm: () => ({}),
}))
const context = { params: { id: projectId, evidenceId, attachmentId } }
function request(suffix = '') { return new Request(`http://localhost/api/delivery_os/projects/${projectId}/evidence${suffix}`) }
beforeEach(() => {
  jest.clearAllMocks(); mockFeatures.mockResolvedValue(undefined)
  mockEvidence.mockResolvedValue({ kind: 'screenshot', attachmentIds: [attachmentId], payload: { attachmentId } })
  mockDescribe.mockResolvedValue({ entityId: 'delivery_os:project', recordId: projectId, mimeType: 'image/png' })
  mockRead.mockResolvedValue({ buffer: Buffer.from('png'), contentDisposition: 'inline; filename="screen.png"', mimeType: 'image/png' })
  mockList.mockResolvedValue({ items: [], nextOffset: null }); mockDetail.mockResolvedValue({ id: evidenceId })
})
it('checks membership, scoped metadata and scoped bytes each time', async () => {
  const response = await readFile(request('/file'), context)
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/png')
  expect(mockDescribe.mock.calls[0][0].auth).toMatchObject({ tenantId: scope.tenantId, orgId: scope.organizationId })
  expect(mockRead.mock.calls[0][0]).toMatchObject({ attachmentId, expectedOwner: { entityId: 'delivery_os:project', recordId: projectId } })
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it('never reads a file not linked to this evidence', async () => {
  mockEvidence.mockResolvedValue({ attachmentIds: [], payload: {} })
  expect((await readFile(request('/file'), context)).status).toBe(404)
  expect(mockRead).not.toHaveBeenCalled(); expect(mockDescribe).not.toHaveBeenCalled()
})
it.each(['tenant', 'organization', 'missing bytes'])('propagates unavailable %s as a 404', async () => {
  mockRead.mockRejectedValue(new CrudHttpError(404, { error: 'Not found' }))
  expect((await readFile(request('/file'), context)).status).toBe(404)
})
it('forces HTML to download', async () => {
  mockDescribe.mockResolvedValue({ entityId: 'delivery_os:project', recordId: projectId, mimeType: 'text/html' })
  const response = await readFile(request('/file'), context)
  expect(mockRead.mock.calls[0][0].forceDownload).toBe(true)
  expect(response.headers.get('content-type')).toBe('application/octet-stream')
  expect(response.headers.get('content-security-policy')).toContain('sandbox')
})
it.each([readFile, readDetail, readList])('enforces ACL directly on every read handler', async (handler) => {
  mockFeatures.mockRejectedValue(new CrudHttpError(403, { error: 'Forbidden' }))
  expect((await handler(request(), context)).status).toBe(403)
  expect(mockRead).not.toHaveBeenCalled(); expect(mockList).not.toHaveBeenCalled(); expect(mockDetail).not.toHaveBeenCalled()
})
it('passes bounded baseline filters to read-only query service', async () => {
  expect((await readList(request(`?baselineId=${evidenceId}&group=baseline&limit=25`), context)).status).toBe(200)
  expect(mockList).toHaveBeenCalledWith(scope, projectId, { baselineId: evidenceId, group: 'baseline', limit: 25, offset: 0 })
  expect((await readList(request(`?baselineId=${evidenceId}&group=baseline&limit=101`), context)).status).toBe(400)
})
