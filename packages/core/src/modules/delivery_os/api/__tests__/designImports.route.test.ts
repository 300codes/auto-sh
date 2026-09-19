/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('./routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('./routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('./routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('./routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))
import '@open-mercato/core/modules/delivery_os/commands'
import { GET as LIST, POST } from '../projects/[id]/design-imports/route'
import { GET, PUT } from '../projects/[id]/design-imports/[sessionId]/route'
import { GET as PORTFOLIO } from '../portfolio/route'
import { designImportListSchema, designImportSessionSchema } from '../../lib/designImportContracts'
import { loadDesignManifestFixture } from '../../lib/fixtures'
import { createProject, expectStatus } from './flowHelpers'
import { ALL_FEATURES, VIEW_ONLY, apiRequest, readBody, resetRouteState, routeParams, routeState, signInAs } from './routeTestKit'

beforeEach(() => { resetRouteState(); signInAs({ features: ALL_FEATURES }) })
test('all four import routes persist partial state, require the right version, and enforce read/write ACLs', async () => {
  const project = await createProject()
  const projectId = String(project.id)
  const created = await POST(apiRequest('POST', `/projects/${projectId}/design-imports`, { body: { manifest: loadDesignManifestFixture() }, lock: String(project.updatedAt) }), routeParams(projectId))
  const session = designImportSessionSchema.parse(await expectStatus(created, 201))
  const detailParams = { params: { id: projectId, sessionId: session.id } }
  const read = await GET(apiRequest('GET', `/projects/${projectId}/design-imports/${session.id}`), detailParams)
  expect(designImportSessionSchema.parse(await expectStatus(read, 200)).status).toBe('partial')
  const list = await LIST(apiRequest('GET', `/projects/${projectId}/design-imports`), routeParams(projectId))
  expect(designImportListSchema.parse(await expectStatus(list, 200)).items.map((item) => item.id)).toEqual([session.id])
  const incomplete = await PUT(apiRequest('PUT', `/projects/${projectId}/design-imports/${session.id}`, { body: { action: 'complete' }, lock: session.updatedAt }), detailParams)
  expect((await expectStatus(incomplete, 200)).status).toBe('partial')
  expect((await PUT(apiRequest('PUT', `/projects/${projectId}/design-imports/${session.id}`, { body: { action: 'cancel' } }), detailParams)).status).toBe(428)
  signInAs({ features: VIEW_ONLY })
  expect((await GET(apiRequest('GET', `/projects/${projectId}/design-imports/${session.id}`), detailParams)).status).toBe(200)
  expect((await PUT(apiRequest('PUT', `/projects/${projectId}/design-imports/${session.id}`, { body: { action: 'cancel' }, lock: session.updatedAt }), detailParams)).status).toBe(403)
  expect((await POST(apiRequest('POST', `/projects/${projectId}/design-imports`, { body: { manifest: loadDesignManifestFixture() }, lock: String(project.updatedAt) }), routeParams(projectId))).status).toBe(403)
  routeState.store.projects[0].organizationId = '99999999-9999-4999-8999-999999999999'
  expect((await GET(apiRequest('GET', `/projects/${projectId}/design-imports/${session.id}`), detailParams)).status).toBe(404)
})
test('portfolio batches scoped projections and omits foreign projects without leaking their status', async () => {
  const first = await createProject()
  const second = await createProject()
  routeState.store.projects.find((row) => row.id === second.id)!.organizationId = '99999999-9999-4999-8999-999999999999'
  const response = await PORTFOLIO(apiRequest('GET', `/portfolio?ids=${first.id},${second.id}`))
  const body = await expectStatus(response, 200)
  expect(body.items).toEqual([expect.objectContaining({ projectId: first.id, nextAction: expect.objectContaining({ kind: 'none' }) })])
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect((await PORTFOLIO(apiRequest('GET', '/portfolio?ids=invalid'))).status).toBe(400)
  signInAs({ features: [] })
  expect((await PORTFOLIO(apiRequest('GET', `/portfolio?ids=${first.id}`))).status).toBe(403)
})
