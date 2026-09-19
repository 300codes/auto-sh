import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  STAFF_API,
  STAFF_FEATURES,
  approvalFor,
  approveStage,
  caller,
  cleanupRegistry,
  commentBatch,
  createOwnerOrgUser,
  createProject,
  createRegistry,
  createSiblingOrgUser,
  createStaffProject,
  createTask,
  designArtifact,
  expectError,
  expectNothingLeft,
  getFlow,
  importComments,
  linkStaffProject,
  listCommentThreads,
  listStaffStatuses,
  listStaffTasks,
  pinProject,
  postDecision,
  projectVersion,
  putStaffLink,
  recordArtifact,
  scopeArtifact,
  seedApprovedBaseline,
  sql,
  stageCurrencies,
  taskVersion,
  triageThread,
  withStage,
  type ArtifactRef,
  type Call,
  type CallResult,
  type Json,
} from './flowSpecKit'

/**
 * TC-DELIVERY-FLOW-04: the staff Kanban board and comment triage never approve a stage, on the real database.
 *
 * Owner: OSS stream (FLOW-F2). The jest tests cover `blockingThreadsFor` and the triage command over an in-memory store;
 * this spec proves the chain end to end: an imported open thread without a confirmed design version (`artifactId: null`)
 * blocks the F8 approval of the UX stage; triaging it, linking it to a delivery task and moving its staff card to the
 * Done column change nothing on the delivery side (no approval, no currency change, the delivery task stays `draft`);
 * only a deferral bound to the exact artifact id and content hash lifts the block, and a new UX version is blocked again
 * because the deferral names the old hash. Triage is guarded by the THREAD version (409 stale, 428 missing). The staff
 * link refuses a staff project the caller cannot reach (another organisation, unknown id) with the same 404.
 *
 * ENVIRONMENT: API fixtures plus DB fixtures (`withClient` reads DATABASE_URL), so the app and the fixtures must share one
 * database; the `staff` module must be enabled. Everything is driven by a fixture user carrying `delivery_os.*` and
 * `staff.*`; teardown hard-deletes delivery and staff rows by id and `afterAll` asserts nothing is left.
 */

type Detail = { path: string; code: string }
type ThreadItem = {
  threadId: string
  threadKey: string
  triageStatus: string
  deferral: { artifactId: string; contentHash: string } | null
  linkedDeliveryTaskId: string | null
  staffTaskId: string | null
  updatedAt: string
}

const THREAD_KEY = 'thr-1001'

const key = (label: string): string => `tc-flow-04-${label}-${randomUUID()}`

async function threadByKey(call: Call, projectId: string, threadKey: string): Promise<ThreadItem> {
  const listed = await listCommentThreads(call, projectId)
  expect(listed.status, `F12 threads: ${JSON.stringify(listed.body)}`).toBe(200)
  const thread = (listed.body.items as ThreadItem[]).find((item) => item.threadKey === threadKey)
  expect(thread, `thread ${threadKey} listed`).toBeDefined()
  return thread as ThreadItem
}

function expectBlocked(result: CallResult, label: string): void {
  expectError(result, 422, 'blocking_comments_open', label)
  expect(result.body.details as Detail[], `${label}: thread detail`).toContainEqual(
    expect.objectContaining({ path: `threads.${THREAD_KEY}`, code: 'blocking_comments_open' }),
  )
}

async function approveUx(call: Call, projectId: string, ref: ArtifactRef, label: string): Promise<CallResult> {
  return postDecision(call, projectId, 'ux', approvalFor(ref), { key: key(label), lock: await projectVersion(call, projectId) })
}

async function uxDecisionCount(projectId: string): Promise<string> {
  const rows = await sql<{ total: string }>("select count(*) as total from delivery_flow_stage_decisions where project_id = $1 and stage_id = 'ux'", [projectId])
  return rows[0]?.total ?? '0'
}

test.describe('TC-DELIVERY-FLOW-04: the staff Kanban never approves a stage', () => {
  const registry = createRegistry()

  test.afterAll(async ({ request }) => {
    await expectNothingLeft(request, registry)
  })

  test('Kanban Done never approves; only a hash-bound deferral lifts the block, and a new UX version revokes it', async ({ request }) => {
    test.slow()
    let adminToken: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const owner = await createOwnerOrgUser(request, adminToken, registry, 'flow04', [...STAFF_FEATURES, 'attachments.view', 'attachments.manage'])
      const call = caller(request, owner.token)
      const { projectId: id, baselineId } = await seedApprovedBaseline(request, owner.token, call, registry, 'flow04-kanban')
      const deliveryTask = await createTask(call, id, baselineId, 'Task T draft')
      const pinned = await pinProject(call, id, await projectVersion(call, id))
      expect(pinned.status, `F4 pin: ${JSON.stringify(pinned.body)}`).toBe(201)
      const scope = await recordArtifact(call, id, scopeArtifact(id))
      await approveStage(call, id, 'scope', scope)
      const uxV1 = await recordArtifact(call, id, designArtifact(id, 'ux', [withStage('scope', scope)]))

      const staffProjectId = await createStaffProject(call, registry, 'flow04 board')
      const statuses = await listStaffStatuses(call, staffProjectId)
      const defaultColumn = statuses.find((status) => status.isDefault)
      const doneColumn = statuses.find((status) => status.isDone)
      expect(defaultColumn, 'the staff board has a default column').toBeDefined()
      expect(doneColumn, 'the staff board has a done column').toBeDefined()
      await linkStaffProject(call, id, staffProjectId)
      const imported = await importComments(call, id, commentBatch(id, { artifactId: null }), key('import'))
      expect(imported.status, `F11 import: ${JSON.stringify(imported.body)}`).toBe(201)

      const fresh = await threadByKey(call, id, THREAD_KEY)
      expect(fresh.triageStatus).toBe('new')
      expect(fresh.staffTaskId, 'the imported thread has a staff card').not.toBeNull()
      const cardId = fresh.staffTaskId as string
      const cardsBefore = await listStaffTasks(call, staffProjectId)
      const card = cardsBefore.find((item) => item.id === cardId)
      expect(card, 'the staff card is listed on the linked board').toBeDefined()
      expect(card?.taskStatusId, 'the card lands in the default column').toBe(defaultColumn?.id)

      expectBlocked(await approveUx(call, id, uxV1, 'ux-new'), 'F8 ux v1 with a new thread')

      const triaged = await triageThread(call, id, fresh.threadId, { triageStatus: 'triaged', linkedDeliveryTaskId: deliveryTask.taskId }, fresh.updatedAt)
      expect(triaged.status, `F13 triaged: ${JSON.stringify(triaged.body)}`).toBe(200)
      expect(triaged.body).toMatchObject({ threadId: fresh.threadId, triageStatus: 'triaged' })
      const afterTriage = await threadByKey(call, id, THREAD_KEY)
      expect(afterTriage).toMatchObject({ triageStatus: 'triaged', linkedDeliveryTaskId: deliveryTask.taskId, deferral: null })
      expectBlocked(await approveUx(call, id, uxV1, 'ux-triaged'), 'F8 ux v1 with a triaged thread')

      const flowBeforeMove = await getFlow(call, id)
      const moved = await call('PATCH', `${STAFF_API}/tasks/${cardId}/status`, { body: { taskStatusId: doneColumn?.id }, lock: card?.updatedAt })
      expect(moved.status, `staff move to Done: ${JSON.stringify(moved.body)}`).toBe(200)
      expect(moved.body.taskStatusId).toBe(doneColumn?.id)
      const cardAfterMove = (await listStaffTasks(call, staffProjectId)).find((item) => item.id === cardId)
      expect(cardAfterMove?.taskStatusId, 'the card sits in the Done column').toBe(doneColumn?.id)

      expectBlocked(await approveUx(call, id, uxV1, 'ux-done'), 'F8 ux v1 after the card reached Done')
      const flowAfterMove = await getFlow(call, id)
      expect(stageCurrencies(flowAfterMove)).toEqual(stageCurrencies(flowBeforeMove))
      expect(stageCurrencies(flowAfterMove)).toMatchObject({ scope: 'approved', ux: 'pending' })
      expect(flowAfterMove.pendingApprovals).toEqual(flowBeforeMove.pendingApprovals)
      expect(flowAfterMove.pendingApprovals as Json[]).toContainEqual(expect.objectContaining({ stageId: 'ux', artifactId: uxV1.artifactId }))
      expect((await taskVersion(call, deliveryTask.taskId)).status, 'the linked delivery task stays draft').toBe('draft')
      const taskRows = await sql<{ status: string }>('select status from delivery_tasks where id = $1', [deliveryTask.taskId])
      expect(taskRows[0]?.status).toBe('draft')
      const afterMove = await threadByKey(call, id, THREAD_KEY)
      expect(afterMove.triageStatus, 'the staff move does not touch the thread triage').toBe('triaged')
      expect(afterMove.updatedAt).toBe(afterTriage.updatedAt)
      expect(await uxDecisionCount(id), 'no ux decision row after the refusals').toBe('0')

      expectError(await triageThread(call, id, fresh.threadId, { triageStatus: 'resolved' }, fresh.updatedAt), 409, 'optimistic_lock_conflict', 'F13 stale thread version')
      expectError(await triageThread(call, id, fresh.threadId, { triageStatus: 'resolved' }, null), 428, 'optimistic_lock_required', 'F13 without a thread version')
      const afterRefusedTriage = await threadByKey(call, id, THREAD_KEY)
      expect(afterRefusedTriage).toMatchObject({ triageStatus: 'triaged', updatedAt: afterTriage.updatedAt })

      const reason = 'Mobile booking button tracked in delivery task T'
      expectError(
        await triageThread(
          call,
          id,
          fresh.threadId,
          { triageStatus: 'deferred', deferral: { artifactId: uxV1.artifactId, contentHash: 'f'.repeat(64), reason } },
          afterRefusedTriage.updatedAt,
        ),
        422,
        'hash_mismatch',
        'F13 deferral with a foreign hash',
      )
      const deferred = await triageThread(
        call,
        id,
        fresh.threadId,
        { triageStatus: 'deferred', deferral: { artifactId: uxV1.artifactId, contentHash: uxV1.contentHash, reason } },
        (await threadByKey(call, id, THREAD_KEY)).updatedAt,
      )
      expect(deferred.status, `F13 deferred: ${JSON.stringify(deferred.body)}`).toBe(200)
      expect(deferred.body.triageStatus).toBe('deferred')
      const deferredThread = await threadByKey(call, id, THREAD_KEY)
      expect(deferredThread.triageStatus).toBe('deferred')
      expect(deferredThread.deferral).toMatchObject({ artifactId: uxV1.artifactId, contentHash: uxV1.contentHash })

      const approvedV1 = await approveUx(call, id, uxV1, 'ux-deferred')
      expect(approvedV1.status, `F8 ux v1 after the deferral: ${JSON.stringify(approvedV1.body)}`).toBe(201)
      expect(approvedV1.body).toMatchObject({ verdict: 'approved', currency: 'approved' })
      expect(stageCurrencies(await getFlow(call, id)).ux).toBe('approved')

      const uxV2 = await recordArtifact(call, id, designArtifact(id, 'ux', [withStage('scope', scope)], 'ux package v2'))
      expect(uxV2.version).toBe(2)
      expect(uxV2.contentHash).not.toBe(uxV1.contentHash)
      expectBlocked(await approveUx(call, id, uxV2, 'ux-v2'), 'F8 ux v2 with a deferral bound to v1')
      expect(await uxDecisionCount(id), 'only the v1 approval row exists').toBe('1')
    } finally {
      await cleanupRegistry(request, adminToken, registry)
    }
  })

  test('a staff project of another organisation or an unknown id is refused with 404; the own board links and replays', async ({ request }) => {
    test.slow()
    let adminToken: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const owner = await createOwnerOrgUser(request, adminToken, registry, 'flow04-link', STAFF_FEATURES)
      const call = caller(request, owner.token)
      const project = await createProject(call, registry, 'TC-DELIVERY-FLOW-04 link')
      const id = project.id
      const pinned = await pinProject(call, id, project.updatedAt)
      expect(pinned.status, `F4 pin: ${JSON.stringify(pinned.body)}`).toBe(201)

      const orgB = await createSiblingOrgUser(request, owner.token, registry, 'flow04', STAFF_FEATURES)
      const foreignStaffProjectId = await createStaffProject(caller(request, orgB.token), registry, 'flow04 org B board')
      const linkRows = async (): Promise<string> =>
        (await sql<{ total: string }>('select count(*) as total from delivery_staff_links where project_id = $1', [id]))[0]?.total ?? '0'

      const refusals: Array<[string, string]> = [
        ['foreign organisation', foreignStaffProjectId],
        ['unknown id', randomUUID()],
      ]
      for (const [label, staffProjectId] of refusals) {
        const refused = await putStaffLink(call, id, staffProjectId, await projectVersion(call, id))
        expectError(refused, 404, 'not_found', `F10 link to a staff project of ${label}`)
        expect(refused.body.details as Detail[], `${label}: detail`).toContainEqual(expect.objectContaining({ path: 'staffProjectId', code: 'not_found' }))
        expect(JSON.stringify(refused.body), `${label}: leaks nothing`).not.toContain(staffProjectId)
      }
      expect(await linkRows(), 'the refused links wrote nothing').toBe('0')

      const ownStaffProjectId = await createStaffProject(call, registry, 'flow04 own board')
      const linked = await linkStaffProject(call, id, ownStaffProjectId)
      expect(linked).toMatchObject({ projectId: id, staffProjectId: ownStaffProjectId })
      const replay = await putStaffLink(call, id, ownStaffProjectId, null)
      expect(replay.status, `F10 relink the same board without a header: ${JSON.stringify(replay.body)}`).toBe(200)
      expect(replay.body).toEqual(linked)
      expect(await linkRows(), 'one link row after the replay').toBe('1')
    } finally {
      await cleanupRegistry(request, adminToken, registry)
    }
  })
})
