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
import { metadata } from '../projects/[id]/comment-threads/route'
import { FOREIGN_ORG_ID, ORG_ID, PROJECT_ID, TENANT_ID } from '../../commands/__tests__/baselineTestKit'
import { commentThreadListResponseSchema, type CommentThreadListItem } from '../../lib/contracts'
import { expectStatus } from './flowHelpers'
import {
  FOREIGN_TENANT_ID,
  VIEW_ONLY,
  expectFrozenError,
  isAllowedBy,
  resetRouteState,
  routeState,
  signInAs,
} from './routeTestKit'
import {
  FILE_KEY,
  batchFixture,
  importOnce,
  listCommentThreads,
  postCommentImport,
  prepareLinkedProject,
  replyFixture,
  resetCommentRouteKit,
  storedThread,
  threadFixture,
  registerFakeKanban,
} from './commentRouteKit'

const KEY = 'import-key-0001'
const OLDER_UPDATED_AT = '2026-09-19T11:00:00.000Z'
const NEWER_UPDATED_AT = '2026-09-19T12:00:00.000Z'
const FOREIGN_THREAD_ID = '3c3c3c3c-3333-4333-8333-333333333331'

async function listThreads(projectId: string, query = ''): Promise<{ items: CommentThreadListItem[]; total: number }> {
  const body = await expectStatus(await listCommentThreads(projectId, query), 200)
  const parsed = commentThreadListResponseSchema.safeParse(body)
  if (!parsed.success) {
    expect(parsed.error.issues).toEqual([])
    throw new Error('[internal] the thread list does not match the frozen contract')
  }
  return parsed.data
}

function threadKeysOf(items: CommentThreadListItem[]): string[] {
  return items.map((item) => item.threadKey)
}

/** One batch carrying two threads, then two explicit activity stamps — the import itself writes both rows in the same tick. */
async function importTwoThreads(projectId: string): Promise<void> {
  const threads = [
    threadFixture({ replies: [replyFixture()] }),
    threadFixture({ threadKey: 'thr-2', nodeId: '56:78', replies: [replyFixture({ commentKey: 'cmt-2' })] }),
  ]
  await expectStatus(await postCommentImport(projectId, batchFixture(projectId, { threads }), { key: KEY }), 201)
  storedThread('thr-1').updatedAt = new Date(OLDER_UPDATED_AT)
  storedThread('thr-2').updatedAt = new Date(NEWER_UPDATED_AT)
}

/** The import can only write threads of the requested project, so the cross-project row is seeded straight into the store. */
function seedForeignProjectThread(): void {
  routeState.store.commentThreads.push({
    id: FOREIGN_THREAD_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    source: 'figma',
    fileKey: FILE_KEY,
    threadKey: 'thr-foreign',
    stageId: 'ux',
    artifactId: null,
    nodeId: '90:12',
    sourceUrl: 'https://www.figma.com/design/FIGFILE0001?node-id=90-12#1',
    author: { name: 'Ola Foreign', externalId: 'figma-user-9', email: null },
    body: 'A thread that belongs to another project.',
    sourceCreatedAt: new Date('2026-09-19T10:00:00.000Z'),
    sourceUpdatedAt: null,
    sourceStatus: 'open',
    figmaVersion: null,
    versionConfirmed: false,
    fetchedAt: new Date('2026-09-19T10:10:00.000Z'),
    staffTaskId: null,
    triageStatus: 'new',
    deferral: null,
    linkedDeliveryTaskId: null,
    createdAt: new Date(NEWER_UPDATED_AT),
    updatedAt: new Date(NEWER_UPDATED_AT),
  })
}

beforeEach(() => {
  resetRouteState()
  resetCommentRouteKit()
})

describe('GET /projects/:id/comment-threads (F12)', () => {
  it('declares the project view feature on GET', () => {
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'GET', [])).toBe(false)
  })

  it('lists an imported thread with its staff card, triage state and reply', async () => {
    const projectId = await prepareLinkedProject()
    const board = registerFakeKanban()
    const batch = batchFixture(projectId, { threads: [threadFixture({ replies: [replyFixture()] })] })
    await expectStatus(await postCommentImport(projectId, batch, { key: KEY }), 201)

    const listed = await listThreads(projectId)
    expect(listed.total).toBe(1)
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).toMatchObject({
      threadKey: 'thr-1',
      stageId: 'ux',
      sourceStatus: 'open',
      versionConfirmed: false,
      triageStatus: 'new',
      staffTaskId: board.tasks[0].id,
    })
    expect(listed.items[0].replies).toHaveLength(1)
    expect(listed.items[0].replies[0].staffCommentId).toBe(board.comments[0].id)
  })

  it('orders the threads by the newest activity first', async () => {
    const projectId = await prepareLinkedProject()
    registerFakeKanban()
    await importTwoThreads(projectId)

    const listed = await listThreads(projectId)
    expect(listed.total).toBe(2)
    expect(threadKeysOf(listed.items)).toEqual(['thr-2', 'thr-1'])
  })

  it('filters by stage, source status and triage state and rejects an unknown filter value', async () => {
    const projectId = await prepareLinkedProject()
    registerFakeKanban()
    await importOnce(projectId, KEY)

    expect((await listThreads(projectId, '?stageId=ux')).total).toBe(1)
    const otherStage = await listThreads(projectId, '?stageId=scope')
    expect({ items: otherStage.items, total: otherStage.total }).toEqual({ items: [], total: 0 })

    expect((await listThreads(projectId, '?status=resolved')).total).toBe(0)
    expect((await listThreads(projectId, '?triage=deferred')).total).toBe(0)

    const stored = storedThread('thr-1')
    stored.sourceStatus = 'resolved'
    stored.triageStatus = 'deferred'

    expect(threadKeysOf((await listThreads(projectId, '?status=resolved')).items)).toEqual(['thr-1'])
    expect(threadKeysOf((await listThreads(projectId, '?triage=deferred')).items)).toEqual(['thr-1'])
    expect((await listThreads(projectId, '?status=open')).total).toBe(0)
    expect((await listThreads(projectId, '?triage=new')).total).toBe(0)

    await expectFrozenError(await listCommentThreads(projectId, '?triage=nonsense'), 400, 'validation_failed')
  })

  it('rejects an out-of-range pageSize and page and pages through the ordered rows', async () => {
    const projectId = await prepareLinkedProject()
    registerFakeKanban()
    await importTwoThreads(projectId)

    await expectFrozenError(await listCommentThreads(projectId, '?pageSize=101'), 400, 'validation_failed')
    await expectFrozenError(await listCommentThreads(projectId, '?page=0'), 400, 'validation_failed')

    const secondPage = await listThreads(projectId, '?pageSize=1&page=2')
    expect(secondPage.total).toBe(2)
    expect(threadKeysOf(secondPage.items)).toEqual(['thr-1'])
  })

  it('never lists threads of another project and answers 404 outside the project scope', async () => {
    const projectId = await prepareLinkedProject()
    registerFakeKanban()
    await importOnce(projectId, KEY)
    seedForeignProjectThread()

    const listed = await listThreads(projectId)
    expect(listed.total).toBe(1)
    expect(threadKeysOf(listed.items)).toEqual(['thr-1'])

    await expectFrozenError(await listCommentThreads(PROJECT_ID), 404, 'not_found')
    signInAs({ tenantId: FOREIGN_TENANT_ID })
    await expectFrozenError(await listCommentThreads(projectId), 404, 'not_found')
    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFrozenError(await listCommentThreads(projectId), 404, 'not_found')
  })
})
