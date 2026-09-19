/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('./routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('./routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('./routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('./routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))

import '@open-mercato/core/modules/delivery_os/commands'
import { metadata, openApi } from '../projects/[id]/comment-imports/route'
import { FOREIGN_ORG_ID } from '../../commands/__tests__/baselineTestKit'
import { commentImportResultSchema, deliveryFlowErrorBodySchema } from '../../lib/contracts'
import { expectStatus, type Json } from './flowHelpers'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  expectFrozenError,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeState,
  signInAs,
} from './routeTestKit'
import {
  STAFF_PROJECT_ID,
  batchFixture,
  importOnce,
  postCommentImport,
  prepareLinkedProject,
  replyFixture,
  resetCommentRouteKit,
  threadFixture,
  registerFakeKanban,
} from './commentRouteKit'

const IMPORT_FEATURE = 'delivery_os.comments.import'
const KEY = 'import-key-0001'

async function expectFlowError(response: Response, status: number, code: string): Promise<Json> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(body).success).toBe(true)
  return body
}

beforeEach(() => {
  resetRouteState()
  resetCommentRouteKit()
})

describe('POST /projects/:id/comment-imports (F11)', () => {
  it('declares the import feature and documents 201 and the 200 replay', () => {
    expect(isAllowedBy(metadata, 'POST', [IMPORT_FEATURE])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
    expect(openApi.methods.POST?.responses?.map((response) => response.status)).toEqual([201, 200])
  })

  it('imports one thread with its reply as one staff card with one comment', async () => {
    const projectId = await prepareLinkedProject()
    const board = registerFakeKanban()
    const batch = batchFixture(projectId, { threads: [threadFixture({ replies: [replyFixture()] })] })
    const body = await expectStatus(await postCommentImport(projectId, batch, { key: KEY }), 201)

    const parsed = commentImportResultSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    expect(body).toMatchObject({
      projectId,
      stageId: 'ux',
      replayed: false,
      counts: { threadsCreated: 1, threadsUpdated: 0, repliesCreated: 1, repliesUpdated: 0, skipped: 0 },
      cursor: { after: null, next: 'page-2' },
    })
    expect(board.tasks).toHaveLength(1)
    expect(board.comments).toHaveLength(1)
    expect(routeState.store.commentThreads).toHaveLength(1)
    expect(routeState.store.commentReplies).toHaveLength(1)
    expect(routeState.store.commentThreads[0].staffTaskId).toBe(board.tasks[0].id)
    expect(routeState.store.staffLinks[0].syncCursors).toMatchObject({ FIGFILE0001: { cursor: 'page-2', lastBatchKey: KEY } })
  })

  it('answers 200 replayed for the same key and batch without touching the board', async () => {
    const projectId = await prepareLinkedProject()
    const board = registerFakeKanban()
    const batch = batchFixture(projectId, { threads: [threadFixture({ replies: [replyFixture()] })] })
    const first = await expectStatus(await postCommentImport(projectId, batch, { key: KEY }), 201)
    const replay = await expectStatus(await postCommentImport(projectId, batch, { key: KEY }), 200)

    expect(replay).toMatchObject({ replayed: true, counts: { threadsCreated: 0, threadsUpdated: 0, repliesCreated: 0, repliesUpdated: 0, skipped: 0 } })
    expect((replay.threads as Array<{ threadId: string }>)[0].threadId).toBe((first.threads as Array<{ threadId: string }>)[0].threadId)
    expect(board.tasks).toHaveLength(1)
    expect(board.comments).toHaveLength(1)
    expect(routeState.store.commentThreads).toHaveLength(1)
  })

  it('answers 409 idempotency_conflict for the same key with another batch and 409 sync_cursor_conflict for a stale cursor', async () => {
    const projectId = await prepareLinkedProject()
    registerFakeKanban()
    await importOnce(projectId, KEY)
    const other = batchFixture(projectId, { cursor: { after: 'page-2', next: 'page-3' }, threads: [threadFixture({ threadKey: 'thr-2' })] })
    await expectFrozenError(await postCommentImport(projectId, other, { key: KEY }), 409, 'idempotency_conflict')
    await expectFlowError(await postCommentImport(projectId, batchFixture(projectId, { threads: [threadFixture({ threadKey: 'thr-3' })] }), { key: 'import-key-0002' }), 409, 'sync_cursor_conflict')
    expect(routeState.store.commentThreads).toHaveLength(1)
  })

  it('requires the Idempotency-Key before the body and rejects an oversized or unknown-version body', async () => {
    const projectId = await prepareLinkedProject()
    registerFakeKanban()
    await expectFrozenError(await postCommentImport(projectId, { garbage: true }, { key: null }), 400, 'idempotency_key_required')
    await expectFrozenError(
      await postCommentImport(projectId, batchFixture(projectId), { key: KEY, headers: { 'content-length': '2000001' } }),
      413,
      'payload_too_large',
    )
    await expectFlowError(
      await postCommentImport(projectId, { ...batchFixture(projectId), schemaVersion: 'delivery.comment-import/v2' }, { key: KEY }),
      422,
      'unsupported_schema_version',
    )
    expect(routeState.store.commentThreads).toHaveLength(0)
  })

  it('answers 422 staff_link_required without a link and without the Kanban adapter', async () => {
    const projectId = await prepareLinkedProject()
    routeState.kanbanAdapter = null
    const noAdapter = await expectFlowError(await postCommentImport(projectId, batchFixture(projectId), { key: KEY }), 422, 'staff_link_required')
    expect((noAdapter.details as Array<{ code: string }>)[0].code).toBe('staff_module_unavailable')

    routeState.store.staffLinks = []
    registerFakeKanban()
    const noLink = await expectFlowError(await postCommentImport(projectId, batchFixture(projectId), { key: KEY }), 422, 'staff_link_required')
    expect((noLink.details as Array<{ code: string }>)[0].code).toBe('staff_link_required')
    expect(routeState.store.commentThreads).toHaveLength(0)
  })

  it('answers 400 for a stage outside the frozen enum and 422 foreign_reference for a batch of another project', async () => {
    const projectId = await prepareLinkedProject()
    registerFakeKanban()
    await expectFlowError(
      await postCommentImport(projectId, { ...batchFixture(projectId), stageId: 'implementation' }, { key: KEY }),
      400,
      'validation_failed',
    )
    await expectFrozenError(
      await postCommentImport(projectId, batchFixture(STAFF_PROJECT_ID), { key: KEY }),
      422,
      'foreign_reference',
    )
    expect(routeState.store.commentThreads).toHaveLength(0)
  })

  it('answers 404 for a project of another tenant and of another organization', async () => {
    const projectId = await prepareLinkedProject()
    registerFakeKanban()
    const body = batchFixture(projectId)
    signInAs({ tenantId: FOREIGN_TENANT_ID })
    await expectFrozenError(await postCommentImport(projectId, body, { key: KEY }), 404, 'not_found')
    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFrozenError(await postCommentImport(projectId, body, { key: KEY }), 404, 'not_found')
    expect(routeState.store.commentThreads).toHaveLength(0)
  })
})
