/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('./routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('./routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('./routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('./routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))
import '@open-mercato/core/modules/delivery_os/commands'
import { GET as LIST } from '../projects/[id]/comment-threads/route'
import { POST as TRIAGE } from '../projects/[id]/comment-threads/[threadId]/triage/route'
import { GET as GET_LINK, PUT as LINK } from '../projects/[id]/staff-link/route'
import { POST as IMPORT } from '../projects/[id]/comment-imports/route'
import { apiRequest, readBody, resetRouteState, routeParams, routeState, signInAs, em } from './routeTestKit'
import { createProject, expectStatus, projectVersion } from './flowHelpers'
import { ACTOR_ID, ORG_ID, TENANT_ID } from '../../commands/__tests__/baselineTestKit'
import { createDeliveryOsCommentQueries } from '../../commands/commentQueries'
import type { EntityManager } from '@mikro-orm/postgresql'

const threadId = '66666666-6666-4666-8666-666666666666'
const staffProjectId = '77777777-7777-4777-8777-777777777777'
const now = new Date('2026-09-19T10:00:00.000Z')
let projectId: string
beforeEach(async () => {
  resetRouteState()
  projectId = String((await createProject()).id)
  routeState.store.commentThreads.push({
    id: threadId, projectId, tenantId: TENANT_ID, organizationId: ORG_ID, source: 'figma', fileKey: 'file', threadKey: 'thread', stageId: 'ux', artifactId: null,
    nodeId: null, sourceUrl: 'https://figma.com/file/file', author: { name: 'Client', email: null, externalId: null }, body: 'Please adjust spacing',
    sourceCreatedAt: now, sourceUpdatedAt: null, sourceStatus: 'open', figmaVersion: null, versionConfirmed: false, fetchedAt: now,
    staffTaskId: null, triageStatus: 'new', deferral: null, linkedDeliveryTaskId: null, createdAt: now, updatedAt: now,
  })
})

describe('F10–F13 scoped routes', () => {
  it('answers 404 for no link, links through the guarded command and permits same-id replay', async () => {
    const missing = await GET_LINK(apiRequest('GET', '/staff-link'), routeParams(projectId))
    expect(missing.status).toBe(404)
    expect(await readBody(missing)).toMatchObject({ code: 'not_found' })
    routeState.extraServices.timeTrackingAccessResolver = { resolveProjectAccess: async () => ({ canManageAll: true, projectIds: [] }) }
    routeState.queryEngine.query.mockResolvedValue({ items: [{ id: staffProjectId }], total: 1 })
    const linked = await expectStatus(await LINK(apiRequest('PUT', '/staff-link', { body: { staffProjectId }, lock: await projectVersion(projectId) }), routeParams(projectId)), 200)
    expect(linked).toMatchObject({ projectId, staffProjectId })
    await expectStatus(await LINK(apiRequest('PUT', '/staff-link', { body: { staffProjectId } }), routeParams(projectId)), 200)
    expect(routeState.store.staffLinks).toHaveLength(1)
  })

  it('lists only the requested scope, filters and returns latest reply revisions', async () => {
    for (const revision of [1, 2]) routeState.store.commentReplies.push({
      id: `88888888-8888-4888-8888-88888888888${revision}`, tenantId: TENANT_ID, organizationId: ORG_ID, threadId, commentKey: 'reply', revision,
      author: { name: 'Designer', email: null, externalId: null }, body: `revision ${revision}`, sourceCreatedAt: now, editedAt: now, deleted: revision === 2, fetchedAt: now, staffCommentId: null,
    })
    const listed = await expectStatus(await LIST(apiRequest('GET', '/comment-threads?stageId=ux&status=open&triage=new'), routeParams(projectId)), 200)
    expect(listed.total).toBe(1)
    expect(listed.items).toEqual([expect.objectContaining({ threadId, updatedAt: now.toISOString(), replies: [expect.objectContaining({ revision: 2, body: 'revision 2', deleted: true })] })])
    expect((await readBody(await LIST(apiRequest('GET', '/comment-threads?stageId=scope'), routeParams(projectId)))).total).toBe(0)
    signInAs({ orgId: '99999999-9999-4999-8999-999999999999' })
    await expectStatus(await LIST(apiRequest('GET', '/comment-threads'), routeParams(projectId)), 404)
  })

  it('triages using the thread version and rejects the stale repeat', async () => {
    const params = { params: { id: projectId, threadId } }
    const triaged = await expectStatus(await TRIAGE(apiRequest('POST', '/triage', { body: { triageStatus: 'resolved' }, lock: now.toISOString() }), params), 200)
    expect(triaged).toMatchObject({ threadId, triageStatus: 'resolved' })
    await expectStatus(await TRIAGE(apiRequest('POST', '/triage', { body: { triageStatus: 'new' }, lock: now.toISOString() }), params), 409)
    expect(routeState.store.stageDecisions).toEqual([])
  })

  it('enforces read/import/manage features and requires an idempotency key before importing', async () => {
    routeState.features = ['delivery_os.projects.view']
    await expectStatus(await LINK(apiRequest('PUT', '/staff-link', { body: { staffProjectId } }), routeParams(projectId)), 403)
    await expectStatus(await IMPORT(apiRequest('POST', '/comment-imports', { body: {} }), routeParams(projectId)), 403)
    routeState.features = ['delivery_os.comments.import']
    await expectStatus(await IMPORT(apiRequest('POST', '/comment-imports', { body: {} }), routeParams(projectId)), 400)
    await expectStatus(await LIST(apiRequest('GET', '/comment-threads'), routeParams(projectId)), 403)
  })


  it('forwards the validated F11 batch and path identity through mutation guards and preserves replay status', async () => {
    const batch = { schemaVersion: 'delivery.comment-import/v1', projectId, source: 'figma', fileKey: 'file', stageId: 'ux', artifactId: null, fetchedAt: now.toISOString(), cursor: { after: null, next: null }, threads: [] }
    const execute = jest.fn().mockResolvedValueOnce({ result: { replayed: false } }).mockResolvedValueOnce({ result: { replayed: true } })
    routeState.extraServices.commandBus = { execute }
    for (const status of [201, 200]) {
      await expectStatus(await IMPORT(apiRequest('POST', '/comment-imports', { body: { ...batch, trustedExecution: { actor: 'forged' } }, headers: { 'Idempotency-Key': 'batch-key' } }), routeParams(projectId)), status)
    }
    expect(execute).toHaveBeenCalledWith('delivery_os.comments.import', expect.objectContaining({ input: { batch, projectId, idempotencyKey: 'batch-key' } }))
  })

  it('provides a bounded scoped provider snapshot and refuses a partial oversized snapshot', async () => {
    const queries = createDeliveryOsCommentQueries(em as unknown as EntityManager)
    const ctx = { auth: { sub: ACTOR_ID, tenantId: TENANT_ID, orgId: ORG_ID }, selectedOrganizationId: ORG_ID } as Parameters<typeof queries.syncSnapshot>[0]
    const snapshot = await queries.syncSnapshot(ctx, { projectId, fileKey: 'file', stageId: 'ux' })
    expect(snapshot).toMatchObject({ cursor: null, threads: [{ threadKey: 'thread', body: 'Please adjust spacing' }] })
    routeState.store.commentThreads = Array.from({ length: 5001 }, () => ({ ...routeState.store.commentThreads[0] }))
    await expect(queries.syncSnapshot(ctx, { projectId, fileKey: 'file', stageId: 'ux' })).rejects.toMatchObject({ status: 400 })
  })
})
