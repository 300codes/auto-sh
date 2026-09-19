import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  API,
  STAFF_FEATURES,
  approveStage,
  caller,
  cleanupRegistry,
  createOwnerOrgUser,
  createPinnedProject,
  createRegistry,
  createSiblingOrgUser,
  createStaffProject,
  designArtifact,
  expectError,
  expectNothingLeft,
  importComments,
  linkStaffProject,
  listCommentThreads,
  listStaffComments,
  listStaffTasks,
  loadFixture,
  projectVersion,
  putStaffLink,
  recordArtifact,
  scopeArtifact,
  sql,
  triageThread,
  withStage,
  type ArtifactRef,
  type Call,
  type CallResult,
} from './flowSpecKit'
import type {
  CommentImportBatchV1,
  CommentImportResult,
  CommentThreadListItem,
  DesignStageContent,
  FigmaRef,
  StageArtifactV1,
  StaffLink,
} from '../lib/contracts'

/**
 * TC-DELIVERY-FLOW-03: design comment import into the linked staff Kanban board (FLOW-F2), on the real database.
 *
 * Owner: OSS stream (FLOW-F2). The jest tests cover the pure import rules and the command over an in-memory store; this
 * spec proves what only the running app can: one staff card per source thread and one card comment per reply through the
 * real staff module, the stored per-file cursor and batch key behind replay, idempotency conflict and the stale-cursor
 * refusal, an edited reply updating its staff comment in place, the Figma version binding to a recorded UX artifact, two
 * parallel deliveries of the same next page never duplicating a card, and the import never bumping the project version.
 *
 * All imports run as one owner-organisation user carrying `delivery_os.*` and `staff.*`: the staff module lets only the
 * author edit a card comment, so the edited-reply path needs the same actor as the first import.
 *
 * ENVIRONMENT: API fixtures plus DB fixtures (`withClient` reads DATABASE_URL), so the app and the fixtures must share one
 * database. Staff rows and delivery rows have no hard-delete route; teardown hard-deletes by project id and staff project
 * id and `afterAll` asserts nothing is left.
 */

type RowCounts = { threads: string; replies: string; tasks: string; comments: string }
type ThreadListBody = { items: CommentThreadListItem[]; total: number }

const FILE_KEY = 'FIGFILE0001'
const FIGMA_VERSION = '1234567890'
const EDITED_REPLY = 'Moving it above the fold and enlarging the tap target.'
const NEW_REPLY = 'Agreed, please also check the tablet layout.'
const SECOND_THREAD_BODY = 'The footer contrast is too low.'
const SECOND_THREAD_URL = 'https://www.figma.com/design/FIGFILE0001?node-id=56-78#1002'
const UX_FIGMA_REF: FigmaRef = {
  fileKey: FILE_KEY,
  nodeId: '12:34',
  name: 'Home wireframe',
  figmaVersion: FIGMA_VERSION,
  url: 'https://www.figma.com/design/FIGFILE0001?node-id=12-34',
}

const key = (label: string): string => `tc-flow-03-${label}-${randomUUID()}`

function pageOne(projectId: string, artifactId: string | null): CommentImportBatchV1 {
  return { ...loadFixture<CommentImportBatchV1>('flow/comment-import.v1.json'), projectId, artifactId }
}

function pageTwo(first: CommentImportBatchV1): CommentImportBatchV1 {
  const [thread] = first.threads
  const [reply] = thread.replies
  return {
    ...first,
    fetchedAt: '2026-09-19T11:10:00.000Z',
    cursor: { after: 'page-2', next: 'page-3' },
    threads: [
      {
        ...thread,
        replies: [
          { ...reply, body: EDITED_REPLY, editedAt: '2026-09-19T11:00:00.000Z' },
          {
            commentKey: 'cmt-2002',
            author: { name: 'Anna Kowalska', externalId: 'figma-user-1', email: null },
            body: NEW_REPLY,
            createdAt: '2026-09-19T11:02:00.000Z',
            editedAt: null,
            deleted: false,
          },
        ],
      },
      {
        threadKey: 'thr-1002',
        nodeId: '56:78',
        sourceUrl: SECOND_THREAD_URL,
        author: { name: 'Anna Kowalska', externalId: 'figma-user-1', email: null },
        body: SECOND_THREAD_BODY,
        createdAt: '2026-09-19T11:05:00.000Z',
        updatedAt: null,
        status: 'open',
        figmaVersion: null,
        replies: [],
      },
    ],
  }
}

function uxArtifactWithFigmaRef(projectId: string, scope: ArtifactRef): StageArtifactV1 {
  const base = designArtifact(projectId, 'ux', [withStage('scope', scope)], 'UX wireframes carrying the Figma version')
  const content = base.content as DesignStageContent
  return { ...base, content: { ...content, figmaRefs: [UX_FIGMA_REF] } } as StageArtifactV1
}

function importResult(result: CallResult): CommentImportResult {
  return result.body as unknown as CommentImportResult
}

function rowCounts(projectId: string, staffProjectId: string): Promise<RowCounts[]> {
  return sql<RowCounts>(
    `select (select count(*) from delivery_comment_threads where project_id = $1) as threads,
            (select count(*) from delivery_comment_replies where thread_id in (select id from delivery_comment_threads where project_id = $1)) as replies,
            (select count(*) from staff_time_tasks where time_project_id = $2) as tasks,
            (select count(*) from staff_time_task_comments c join staff_time_tasks t on t.id = c.task_id where t.time_project_id = $2) as comments`,
    [projectId, staffProjectId],
  )
}

async function threadList(call: Call, projectId: string): Promise<ThreadListBody> {
  const listed = await listCommentThreads(call, projectId)
  expect(listed.status, `F12 threads: ${JSON.stringify(listed.body)}`).toBe(200)
  return listed.body as unknown as ThreadListBody
}

async function readStaffLink(call: Call, projectId: string): Promise<StaffLink> {
  const link = await call('GET', `${API}/projects/${projectId}/staff-link`)
  expect(link.status, `F10 read link: ${JSON.stringify(link.body)}`).toBe(200)
  return link.body as unknown as StaffLink
}

test.describe('TC-DELIVERY-FLOW-03: design comments land on the linked staff board', () => {
  const registry = createRegistry()

  test.afterAll(async ({ request }) => {
    await expectNothingLeft(request, registry)
  })

  test('one card per thread, one comment per reply, replay and parallel next page', async ({ request }) => {
    test.slow()
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const owner = await createOwnerOrgUser(request, token, registry, 'flow03', STAFF_FEATURES)
      const call = caller(request, owner.token)

      const id = await createPinnedProject(call, registry, 'TC-DELIVERY-FLOW-03 import')
      const scope = await recordArtifact(call, id, scopeArtifact(id))
      await approveStage(call, id, 'scope', scope)
      const ux = await recordArtifact(call, id, uxArtifactWithFigmaRef(id, scope))
      const staffProjectId = await createStaffProject(call, registry, 'flow03 board')
      const linked = await linkStaffProject(call, id, staffProjectId)
      expect(linked).toMatchObject({ projectId: id, staffProjectId })

      const first = pageOne(id, ux.artifactId)
      const [sourceThread] = first.threads
      const [sourceReply] = sourceThread.replies
      const versionBefore = await projectVersion(call, id)
      const keyA = key('page-1')
      const imported = await importComments(call, id, first, keyA)
      expect(imported.status, `F11 page 1: ${JSON.stringify(imported.body)}`).toBe(201)
      const pageOneResult = importResult(imported)
      expect(pageOneResult).toMatchObject({
        projectId: id,
        fileKey: FILE_KEY,
        stageId: 'ux',
        replayed: false,
        counts: { threadsCreated: 1, threadsUpdated: 0, repliesCreated: 1, repliesUpdated: 0, skipped: 0 },
      })
      expect(pageOneResult.threads).toHaveLength(1)
      const importedThread = pageOneResult.threads[0]
      expect(importedThread).toMatchObject({ threadKey: sourceThread.threadKey, versionConfirmed: true, outcome: 'created' })
      expect(importedThread.replies).toHaveLength(1)
      expect(importedThread.replies[0]).toMatchObject({ commentKey: sourceReply.commentKey, outcome: 'created' })
      expect(await projectVersion(call, id), 'the import never bumps the project version').toBe(versionBefore)

      const tasks = await listStaffTasks(call, staffProjectId)
      expect(tasks, 'one staff card for one thread').toHaveLength(1)
      const [card] = tasks
      expect(card.title).toBe(sourceThread.body)
      expect((card.description ?? '').startsWith(`Source: ${sourceThread.sourceUrl}\n`), `card description: ${card.description}`).toBe(true)
      expect(importedThread.staffTaskId).toBe(card.id)
      const comments = await listStaffComments(call, card.id)
      expect(comments, 'one card comment for one reply').toHaveLength(1)
      expect(comments[0].body).toContain(sourceReply.body)
      expect(importedThread.replies[0].staffCommentId).toBe(comments[0].id)
      const originalCommentId = comments[0].id

      const afterPageOne = await threadList(call, id)
      expect(afterPageOne.total).toBe(1)
      expect(afterPageOne.items[0]).toMatchObject({
        threadId: importedThread.threadId,
        threadKey: sourceThread.threadKey,
        staffTaskId: card.id,
        triageStatus: 'new',
        versionConfirmed: true,
        artifactId: ux.artifactId,
        figmaVersion: FIGMA_VERSION,
      })
      expect(afterPageOne.items[0].replies).toHaveLength(1)
      expect(afterPageOne.items[0].replies[0]).toMatchObject({ commentKey: sourceReply.commentKey, staffCommentId: originalCommentId })
      const storedCursor = (await readStaffLink(call, id)).syncCursors[FILE_KEY]
      expect(storedCursor).toMatchObject({ cursor: 'page-2', lastBatchKey: keyA })
      const countsAfterPageOne = (await rowCounts(id, staffProjectId))[0]
      expect(countsAfterPageOne).toEqual({ threads: '1', replies: '1', tasks: '1', comments: '1' })

      const replay = await importComments(call, id, first, keyA)
      expect(replay.status, `F11 replay: ${JSON.stringify(replay.body)}`).toBe(200)
      const replayResult = importResult(replay)
      expect(replayResult.replayed).toBe(true)
      expect(replayResult.counts).toEqual({ threadsCreated: 0, threadsUpdated: 0, repliesCreated: 0, repliesUpdated: 0, skipped: 0 })
      expect(replayResult.threads[0]).toMatchObject({ threadId: importedThread.threadId, staffTaskId: card.id })
      expect((await rowCounts(id, staffProjectId))[0], 'the replay wrote nothing').toEqual(countsAfterPageOne)
      expect(await listStaffTasks(call, staffProjectId)).toHaveLength(1)
      expect(await listStaffComments(call, card.id)).toHaveLength(1)

      const otherBody = { ...first, fetchedAt: '2026-09-19T10:20:00.000Z' }
      expectError(await importComments(call, id, otherBody, keyA), 409, 'idempotency_conflict', 'F11 same key, other batch')
      expectError(await importComments(call, id, first, key('stale')), 409, 'sync_cursor_conflict', 'F11 stale cursor')
      expect((await rowCounts(id, staffProjectId))[0], 'the refused batches wrote nothing').toEqual(countsAfterPageOne)
      expect((await readStaffLink(call, id)).syncCursors[FILE_KEY]).toMatchObject({ cursor: 'page-2', lastBatchKey: keyA })

      const second = pageTwo(first)
      const keyB = key('page-2-b')
      const keyC = key('page-2-c')
      const parallel = await Promise.all([importComments(call, id, second, keyB), importComments(call, id, second, keyC)])
      for (const [index, result] of parallel.entries()) {
        expect([200, 201, 409], `F11 parallel page 2 #${index}: ${JSON.stringify(result.body)}`).toContain(result.status)
        if (result.status === 409) expectError(result, 409, 'sync_cursor_conflict', `F11 parallel page 2 #${index}`)
      }
      const created = parallel.filter((result) => result.status === 201)
      expect(created.length, 'at least one parallel delivery imports the page').toBeGreaterThanOrEqual(1)
      const createdThread = importResult(created[0]).threads.find((thread) => thread.threadKey === 'thr-1002')
      expect(createdThread, 'the new thread is in the 201 result').toBeDefined()
      expect(createdThread?.versionConfirmed).toBe(false)
      expect(await projectVersion(call, id), 'the parallel imports never bump the project version').toBe(versionBefore)

      const threadRows = await sql<{ total: string }>('select count(*) as total from delivery_comment_threads where project_id = $1', [id])
      expect(threadRows[0]?.total, 'one thread row per thread key').toBe('2')
      const cards = await listStaffTasks(call, staffProjectId)
      expect(cards, 'one staff card per thread key after the parallel page').toHaveLength(2)
      const afterPageTwo = await threadList(call, id)
      expect(afterPageTwo.total).toBe(2)
      const firstThread = afterPageTwo.items.find((thread) => thread.threadKey === 'thr-1001')
      const secondThread = afterPageTwo.items.find((thread) => thread.threadKey === 'thr-1002')
      expect(firstThread?.staffTaskId).toBe(card.id)
      expect(firstThread?.versionConfirmed).toBe(true)
      expect(secondThread).toMatchObject({ versionConfirmed: false, figmaVersion: null, sourceUrl: SECOND_THREAD_URL, triageStatus: 'new' })
      expect(cards.map((task) => task.id).sort()).toEqual([card.id, secondThread?.staffTaskId].sort())
      const secondCard = cards.find((task) => task.id === secondThread?.staffTaskId)
      expect(secondCard?.title).toBe(SECOND_THREAD_BODY)
      expect((secondCard?.description ?? '').startsWith(`Source: ${SECOND_THREAD_URL}\n`)).toBe(true)
      expect([...new Set((firstThread?.replies ?? []).map((reply) => reply.commentKey))].sort()).toEqual(['cmt-2001', 'cmt-2002'])
      const latestEdit = (firstThread?.replies ?? [])
        .filter((reply) => reply.commentKey === 'cmt-2001')
        .reduce<CommentThreadListItem['replies'][number] | null>((latest, reply) => (!latest || reply.revision > latest.revision ? reply : latest), null)
      expect(latestEdit).toMatchObject({ body: EDITED_REPLY, staffCommentId: originalCommentId })

      const firstCardComments = await listStaffComments(call, card.id)
      expect(firstCardComments, 'the edited reply is updated in place plus one new comment').toHaveLength(2)
      const editedComment = firstCardComments.find((comment) => comment.id === originalCommentId)
      expect(editedComment?.body).toContain(EDITED_REPLY)
      expect(firstCardComments.some((comment) => comment.id !== originalCommentId && comment.body.includes(NEW_REPLY))).toBe(true)
      expect(await listStaffComments(call, secondCard?.id ?? ''), 'a thread without replies has no card comment').toHaveLength(0)

      const settled = (await readStaffLink(call, id)).syncCursors[FILE_KEY]
      expect(settled.cursor).toBe('page-3')
      const winnerKey = settled.lastBatchKey
      expect([keyB, keyC]).toContain(winnerKey)
      expect(parallel[winnerKey === keyB ? 0 : 1].status, 'the stored batch key belongs to a 201 delivery').toBe(201)
      const countsAfterPageTwo = (await rowCounts(id, staffProjectId))[0]
      const retried = await importComments(call, id, second, winnerKey ?? '')
      expect(retried.status, `F11 retry of the winning key: ${JSON.stringify(retried.body)}`).toBe(200)
      expect(importResult(retried).replayed).toBe(true)
      expect(importResult(retried).counts).toMatchObject({ threadsCreated: 0, repliesCreated: 0 })
      expect((await rowCounts(id, staffProjectId))[0], 'the retry wrote nothing').toEqual(countsAfterPageTwo)
    } finally {
      await cleanupRegistry(request, token, registry)
    }
  })

  test('an unlinked project refuses the import and a sibling organisation sees 404', async ({ request }) => {
    test.slow()
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const owner = await createOwnerOrgUser(request, token, registry, 'flow03-scope', STAFF_FEATURES)
      const call = caller(request, owner.token)

      const unlinked = await createPinnedProject(call, registry, 'TC-DELIVERY-FLOW-03 unlinked')
      expectError(await importComments(call, unlinked, pageOne(unlinked, null), key('unlinked')), 422, 'staff_link_required', 'F11 without a staff link')
      const unlinkedRows = await sql<{ total: string }>('select count(*) as total from delivery_comment_threads where project_id = $1', [unlinked])
      expect(unlinkedRows[0]?.total, 'the refused import wrote nothing').toBe('0')

      const id = await createPinnedProject(call, registry, 'TC-DELIVERY-FLOW-03 scope')
      const staffProjectId = await createStaffProject(call, registry, 'flow03 scope board')
      await linkStaffProject(call, id, staffProjectId)
      const batch = pageOne(id, null)
      const imported = await importComments(call, id, batch, key('owner'))
      expect(imported.status, `F11 owner import: ${JSON.stringify(imported.body)}`).toBe(201)
      expect(importResult(imported).threads[0]?.versionConfirmed, 'no artifact carries the version').toBe(false)
      const ownerThread = (await threadList(call, id)).items[0]
      expect(ownerThread).toBeDefined()
      const countsBefore = (await rowCounts(id, staffProjectId))[0]
      expect(countsBefore).toEqual({ threads: '1', replies: '1', tasks: '1', comments: '1' })

      const sibling = await createSiblingOrgUser(request, owner.token, registry, 'comments')
      const siblingCall = caller(request, sibling.token)
      const ownerLock = await projectVersion(call, id)
      const probes: Array<[string, () => Promise<CallResult>]> = [
        ['F10 read link', () => siblingCall('GET', `${API}/projects/${id}/staff-link`)],
        ['F10 link', () => putStaffLink(siblingCall, id, staffProjectId, ownerLock)],
        ['F11 import', () => importComments(siblingCall, id, { ...batch, cursor: { after: 'page-2', next: 'page-3' } }, key('sibling'))],
        ['F12 threads', () => listCommentThreads(siblingCall, id)],
        ['F13 triage', () => triageThread(siblingCall, id, ownerThread.threadId, { triageStatus: 'triaged' }, ownerThread.updatedAt)],
      ]
      for (const [label, probe] of probes) {
        const result = await probe()
        expectError(result, 404, 'not_found', `${label} as org B user`)
        expect(JSON.stringify(result.body), `${label} leaks nothing`).not.toContain(id)
      }
      expect((await rowCounts(id, staffProjectId))[0], 'the foreign probes wrote nothing').toEqual(countsBefore)
      const unchanged = (await threadList(call, id)).items[0]
      expect(unchanged).toMatchObject({ threadId: ownerThread.threadId, triageStatus: 'new', updatedAt: ownerThread.updatedAt })
      expect((await readStaffLink(call, id)).staffProjectId).toBe(staffProjectId)
    } finally {
      await cleanupRegistry(request, token, registry)
    }
  })
})
