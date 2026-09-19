const mockExecute = jest.fn()
const mockPrepare = jest.fn()
const mockFeatures = jest.fn()
const projectId = '33333333-3333-4333-8333-333333333333'
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

jest.mock('@open-mercato/core/modules/delivery_os/api/routeSupport', () => ({
  resolveDeliveryRouteContext: async () => ({ auth: { tenantId: scope.tenantId, orgId: scope.organizationId }, container: { resolve: () => ({ prepare: mockPrepare }) } }),
  requireDeliveryFeatures: (...args: unknown[]) => mockFeatures(...args),
  requireRouteStage: async () => ({ project: { id: projectId } }),
  readCappedRouteBody: async (request: Request) => JSON.parse(await request.text()),
  executeDeliveryCommand: (...args: unknown[]) => mockExecute(...args),
  deliveryErrorResponse: (error: { status?: number; body?: unknown }) => Response.json(error.body ?? {}, { status: error.status ?? 500 }),
}))

import { POST, metadata } from '../api/projects/[id]/sync/route'
import { FigmaReadError } from '../lib/client'

const request = () => new Request('http://localhost/api/delivery_figma/projects/project/sync', { method: 'POST', body: JSON.stringify({ fileKey: 'file', stageId: 'ux', artifactId: null }) })
const page = { batch: { projectId }, idempotencyKey: 'key' }

beforeEach(() => {
  mockExecute.mockReset()
  mockPrepare.mockReset().mockResolvedValue([page, page])
  mockFeatures.mockReset().mockResolvedValue(undefined)
})

it('requires comments permission before preparing any external fetch', async () => {
  expect(metadata.POST.requireFeatures).toEqual(['delivery_os.comments.import'])
  mockFeatures.mockRejectedValueOnce({ status: 403, body: { code: 'forbidden' } })
  expect((await POST(request(), { params: { id: projectId } })).status).toBe(403)
  expect(mockPrepare).not.toHaveBeenCalled()
})

it('executes each page through the guarded public command', async () => {
  mockExecute.mockResolvedValue({ blocked: null, result: { counts: { skipped: 0 } } })
  const response = await POST(request(), { params: { id: projectId } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ complete: true, results: [{ counts: { skipped: 0 } }, { counts: { skipped: 0 } }] })
  expect(mockExecute).toHaveBeenCalledWith(expect.anything(), scope, expect.objectContaining({ commandId: 'delivery_os.comments.import', body: page, pathInput: { projectId } }))
})

it('stops subsequent pages on a guard rejection or partial result', async () => {
  mockExecute.mockResolvedValueOnce({ blocked: Response.json({ blocked: true }, { status: 409 }) })
  expect((await POST(request(), { params: { id: projectId } })).status).toBe(409)
  expect(mockExecute).toHaveBeenCalledTimes(1)
  mockExecute.mockReset().mockResolvedValue({ blocked: null, result: { counts: { skipped: 1 } } })
  const partial = await POST(request(), { params: { id: projectId } })
  expect(partial.status).toBe(207)
  expect(await partial.json()).toMatchObject({ complete: false })
  expect(mockExecute).toHaveBeenCalledTimes(1)
})

it('reports a rate limit as retryable without exposing upstream response data', async () => {
  mockPrepare.mockRejectedValueOnce(new FigmaReadError('figma_rate_limited'))
  const response = await POST(request(), { params: { id: projectId } })
  expect(response.status).toBe(429)
  expect(await response.json()).toEqual({ code: 'figma_rate_limited', error: 'delivery_figma.errors.figma_rate_limited' })
  expect(mockExecute).not.toHaveBeenCalled()
})
