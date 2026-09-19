/** @jest-environment node */
jest.mock('../../commands/reportContext', () => ({ loadReportContext: jest.fn() }))
jest.mock('../routeSupport', () => ({
  resolveDeliveryRouteContext: jest.fn(), readRouteId: jest.fn(), readRouteBody: jest.fn(),
  executeDeliveryCommand: jest.fn(), resolveRouteEm: jest.fn(), requireProjectIncludingArchived: jest.fn(),
  deliveryErrorResponse: jest.fn((error) => new Response(JSON.stringify(error.body ?? {}), { status: error.status ?? 500 })),
}))
import { GET, POST, metadata, openApi } from '../projects/[id]/release-candidate/route'
import { executeDeliveryCommand, readRouteBody, readRouteId, requireProjectIncludingArchived, resolveDeliveryRouteContext, resolveRouteEm } from '../routeSupport'
import { loadReportContext } from '../../commands/reportContext'

const projectId = '11111111-1111-4111-8111-111111111111'
const scope = { tenantId: '22222222-2222-4222-8222-222222222222', organizationId: '33333333-3333-4333-8333-333333333333' }
const updatedAt = new Date('2026-09-19T12:00:00.000Z')
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveDeliveryRouteContext).mockResolvedValue({ auth: { sub: projectId, tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId } as never)
  jest.mocked(readRouteId).mockResolvedValue(projectId)
  jest.mocked(resolveRouteEm).mockReturnValue({} as never)
  jest.mocked(requireProjectIncludingArchived).mockResolvedValue({ id: projectId, updatedAt } as never)
})
it('guards nomination with deploy approval, preserving read permission', () => {
  expect(metadata.POST.requireFeatures).toEqual(['delivery_os.deploy.approve'])
  expect(metadata.GET.requireFeatures).toEqual(['delivery_os.projects.view'])
  expect(openApi.methods.POST?.requestBody).toBeDefined()
})
it('returns scoped current candidate and project version without requiring an active baseline', async () => {
  jest.mocked(loadReportContext).mockResolvedValue({ mode: 'legacy', flow: null, currentCandidate: null })
  const response = await GET(new Request('http://localhost/api'), {})
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ currentCandidate: null, projectUpdatedAt: updatedAt.toISOString() })
  expect(requireProjectIncludingArchived).toHaveBeenCalledWith({}, projectId, scope)
})
it('passes writes through guarded command with authoritative project path', async () => {
  const body = { projectId: 'foreign', baselineId: projectId }
  jest.mocked(readRouteBody).mockResolvedValue(body)
  jest.mocked(executeDeliveryCommand).mockResolvedValue({ blocked: null, result: { currentCandidate: null, projectUpdatedAt: updatedAt.toISOString() } })
  const response = await POST(new Request('http://localhost/api', { method: 'POST' }), {})
  expect(response.status).toBe(201)
  expect(executeDeliveryCommand).toHaveBeenCalledWith(expect.anything(), scope, expect.objectContaining({ commandId: 'delivery_os.release_candidates.nominate', body, pathInput: { projectId }, resourceId: projectId, operation: 'custom' }))
})
it('returns mutation guard rejection without reporting success', async () => {
  jest.mocked(readRouteBody).mockResolvedValue({})
  const blocked = new Response('{}', { status: 409 })
  jest.mocked(executeDeliveryCommand).mockResolvedValue({ blocked })
  expect(await POST(new Request('http://localhost/api', { method: 'POST' }), {})).toBe(blocked)
})
