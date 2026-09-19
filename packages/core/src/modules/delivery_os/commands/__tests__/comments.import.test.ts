jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockEmit = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../../events', () => ({ emitDeliveryOsEvent: (...args: unknown[]) => mockEmit(...args) }))

import '@open-mercato/core/modules/delivery_os/commands'
import fs from 'node:fs'
import path from 'node:path'
import { LockMode } from '@mikro-orm/core'
import { DeliveryCommentThread, DeliveryFlowStageArtifact, DeliveryProject } from '../../data/entities'
import { commentImportResultSchema, deliveryFlowErrorBodySchema, type CommentImportBatchV1, type CommentReply, type CommentThread } from '../../lib/contracts'
import { STAFF_COMMENT_MAX, STAFF_DESCRIPTION_MAX, STAFF_TITLE_MAX, STAFF_TRUNCATION_MARKER } from '../../lib/commentImport'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import type { CommentImportCommandResult } from '../comments'
import { DELIVERY_STAFF_KANBAN_ADAPTER_KEY, type DeliveryStaffKanbanAdapter } from '../staffKanbanAdapter'
import {
  catchHttpError,
  detailCodes,
  emptyStore,
  expectFrozenBody,
  getHandler,
  makeHarness,
  makeProject,
  matches,
  ORG_ID,
  PROJECT_ID,
  rowsFor,
  TENANT_ID,
  type Row,
  type Store,
} from './baselineTestKit'

const STAFF_PROJECT_ID = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa'
const STATUS_ID = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb'
const UX_ARTIFACT_V1 = 'cccccccc-0000-4000-8000-ccccccccccc1'
const UX_ARTIFACT_V2 = 'cccccccc-0000-4000-8000-ccccccccccc2'
const KV_ARTIFACT = 'cccccccc-0000-4000-8000-ccccccccccc3'
const FOREIGN_ARTIFACT = 'cccccccc-0000-4000-8000-ccccccccccc4'
const OTHER_PROJECT_ID = '12121212-7777-4777-8777-121212121212'
const FILE_KEY = 'FIGFILE0001'
const KEY = 'import-key-0001'

type FakeTask = { id: string; staffProjectId: string; statusId: string; title: string; description: string }
type FakeComment = { id: string; taskId: string; body: string }
type FakeStaff = { tasks: FakeTask[]; comments: FakeComment[] }

const importComments = getHandler<CommentImportCommandResult>('delivery_os.comments.import')

let store: Store
let artifacts: Row[]
let staff: FakeStaff
let adapter: jest.Mocked<Required<DeliveryStaffKanbanAdapter>>
let idCounter: number
let flushFailures: Array<() => unknown>
let onRollback: (() => void) | null
let createdAs: WeakMap<Row, unknown>

function expectFlowBody(error: Awaited<ReturnType<typeof catchHttpError>>, status: number, code: string): void {
  expect(error.status).toBe(status)
  expect(deliveryFlowErrorBodySchema.safeParse(error.body).success).toBe(true)
  expect(error.body.code).toBe(code)
}

function nextId(): string {
  idCounter += 1
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`
}

function rows(entity: unknown): Row[] {
  return entity === DeliveryFlowStageArtifact ? artifacts : rowsFor(store, entity)
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
}

function reply(overrides: Partial<CommentReply> = {}): CommentReply {
  return {
    commentKey: 'cmt-1',
    author: { name: 'Adam Designer', externalId: 'figma-user-2', email: null },
    body: 'Moving it above the fold.',
    createdAt: '2026-09-19T10:05:00.000Z',
    editedAt: null,
    deleted: false,
    ...overrides,
  }
}

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    threadKey: 'thr-1',
    nodeId: '12:34',
    sourceUrl: 'https://www.figma.com/design/FIGFILE0001?node-id=12-34#1',
    author: { name: 'Anna Kowalska', externalId: 'figma-user-1', email: null },
    body: 'The booking button is hard to find on mobile.\nSecond line with detail.',
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: null,
    status: 'open',
    figmaVersion: 'v-100',
    replies: [],
    ...overrides,
  }
}

function batch(overrides: Partial<CommentImportBatchV1> = {}): CommentImportBatchV1 {
  return {
    schemaVersion: 'delivery.comment-import/v1',
    projectId: PROJECT_ID,
    source: 'figma',
    fileKey: FILE_KEY,
    stageId: 'ux',
    artifactId: null,
    fetchedAt: '2026-09-19T10:10:00.000Z',
    cursor: { after: null, next: 'page-2' },
    threads: [thread()],
    ...overrides,
  }
}

function artifactRow(id: string, stageId: string, version: number, figmaVersion: string | null, overrides: Row = {}): Row {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    stageId,
    version,
    content: { figmaRefs: [{ fileKey: FILE_KEY, nodeId: null, name: 'Frames', figmaVersion, url: null }] },
    ...overrides,
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

type KanbanAdapter = Required<DeliveryStaffKanbanAdapter>

function mockOf<TKey extends keyof KanbanAdapter>(implementation: KanbanAdapter[TKey]): jest.MockedFunction<KanbanAdapter[TKey]> {
  return jest.fn(implementation as (...args: unknown[]) => unknown) as unknown as jest.MockedFunction<KanbanAdapter[TKey]>
}

/** The fake shares the thread transaction the way the default adapter does: a throw restores delivery rows and staff rows. */
function makeAdapter(): jest.Mocked<Required<DeliveryStaffKanbanAdapter>> {
  return {
    resolveDefaultStatusId: mockOf<'resolveDefaultStatusId'>(async () => STATUS_ID),
    createTask: mockOf<'createTask'>(async (input) => {
      const task = { id: nextId(), ...input }
      staff.tasks.push(task)
      return { taskId: task.id }
    }),
    updateTask: mockOf<'updateTask'>(async (input) => {
      const task = staff.tasks.find((candidate) => candidate.id === input.taskId)
      if (!task) throw new Error('[internal] fake staff task missing')
      task.title = input.title
      task.description = input.description
    }),
    createComment: mockOf<'createComment'>(async (input) => {
      const comment = { id: nextId(), ...input }
      staff.comments.push(comment)
      return { commentId: comment.id }
    }),
    updateComment: mockOf<'updateComment'>(async (input) => {
      const comment = staff.comments.find((candidate) => candidate.id === input.commentId)
      if (!comment) throw new Error('[internal] fake staff comment missing')
      comment.body = input.body
    }),
    settle: mockOf<'settle'>(async () => undefined),
  }
}

function run(input: { batch?: CommentImportBatchV1; key?: string | null; services?: Record<string, unknown> } = {}): Promise<CommentImportCommandResult> {
  const services = input.services ?? { [DELIVERY_STAFF_KANBAN_ADAPTER_KEY]: adapter }
  const { ctx, em } = makeHarness(store, { services })
  em.create.mockImplementation((entity: unknown, data: Row) => {
    const row = { id: nextId(), ...data }
    createdAs.set(row, entity)
    return row
  })
  em.persist.mockImplementation((row: Row) => {
    const target = rowsFor(store, createdAs.get(row))
    if (!target.includes(row)) target.push(row)
  })
  em.flush.mockImplementation(async () => {
    const failure = flushFailures.shift()
    if (failure) throw failure()
  })
  em.transactional.mockImplementation(async (work: (tx: typeof em) => Promise<unknown>) => {
    const snapshot = { threads: clone(store.commentThreads), replies: clone(store.commentReplies), links: clone(store.staffLinks), staff: clone(staff) }
    try {
      return await work(em)
    } catch (error) {
      store.commentThreads = snapshot.threads
      store.commentReplies = snapshot.replies
      store.staffLinks = snapshot.links
      staff = snapshot.staff
      onRollback?.()
      onRollback = null
      throw error
    }
  })
  const rawInput: Row = { projectId: PROJECT_ID, batch: input.batch ?? batch() }
  if (input.key !== null) rawInput.idempotencyKey = input.key ?? KEY
  return Promise.resolve(importComments.execute(rawInput, ctx))
}

function cursor(): Row | undefined {
  return (store.staffLinks[0].syncCursors as Record<string, Row>)[FILE_KEY]
}

beforeEach(() => {
  idCounter = 0
  flushFailures = []
  onRollback = null
  createdAs = new WeakMap()
  mockEmit.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).find((row) => matches(row, where)) ?? null)
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).filter((row) => matches(row, where)))
  store = {
    ...emptyStore(),
    projects: [
      makeProject({
        flowTemplateId: DEFAULT_FLOW_TEMPLATE.templateId,
        flowTemplateVersion: DEFAULT_FLOW_TEMPLATE.version,
        flowTemplateHash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE),
        flowTemplateSnapshot: DEFAULT_FLOW_TEMPLATE,
      } as never),
    ],
    staffLinks: [{ id: nextId(), tenantId: TENANT_ID, organizationId: ORG_ID, projectId: PROJECT_ID, staffProjectId: STAFF_PROJECT_ID, syncCursors: {}, updatedAt: new Date('2026-09-19T09:00:00.000Z') }],
  }
  artifacts = [
    artifactRow(UX_ARTIFACT_V1, 'ux', 1, 'v-100'),
    artifactRow(UX_ARTIFACT_V2, 'ux', 2, 'v-200'),
    artifactRow(KV_ARTIFACT, 'key_visual', 1, 'v-100'),
    artifactRow(FOREIGN_ARTIFACT, 'ux', 1, 'v-100', { projectId: OTHER_PROJECT_ID }),
  ]
  staff = { tasks: [], comments: [] }
  adapter = makeAdapter()
})

describe('delivery_os.comments.import (F11) — request checks in order', () => {
  it('requires the Idempotency-Key before anything else', async () => {
    const error = await catchHttpError(() => run({ key: null, batch: { ...batch(), projectId: OTHER_PROJECT_ID } }))
    expectFrozenBody(error, 400, 'idempotency_key_required')
  })

  it('answers 404 for a project outside the caller scope', async () => {
    store.projects = []
    expectFrozenBody(await catchHttpError(() => run()), 404, 'not_found')
  })

  it('answers 422 staff_link_required when the project is not linked to a staff project', async () => {
    store.staffLinks = []
    const error = await catchHttpError(() => run())
    expectFlowBody(error, 422, 'staff_link_required')
    expect(detailCodes(error)).toEqual(['staff_link_required'])
  })

  it('answers 422 stage_unknown for a stage that is not in the pinned snapshot', async () => {
    const template = { ...DEFAULT_FLOW_TEMPLATE, stages: DEFAULT_FLOW_TEMPLATE.stages.filter((stage) => stage.kind !== 'ux') }
    Object.assign(store.projects[0], { flowTemplateSnapshot: template })
    expectFlowBody(await catchHttpError(() => run()), 422, 'stage_unknown')
  })

  it('rejects a batch of another project with 422 foreign_reference', async () => {
    expectFrozenBody(await catchHttpError(() => run({ batch: batch({ projectId: OTHER_PROJECT_ID }) })), 422, 'foreign_reference')
  })

  it('rejects an artifact of another project or another stage with 422 foreign_reference', async () => {
    for (const artifactId of [FOREIGN_ARTIFACT, KV_ARTIFACT]) {
      const error = await catchHttpError(() => run({ batch: batch({ artifactId }) }))
      expectFrozenBody(error, 422, 'foreign_reference')
      expect(detailCodes(error)).toEqual(['foreign_artifact'])
    }
    expect(staff.tasks).toHaveLength(0)
  })

  it('rejects duplicate thread keys and duplicate comment keys with 422 duplicate_stable_id', async () => {
    expectFrozenBody(await catchHttpError(() => run({ batch: batch({ threads: [thread(), thread()] }) })), 422, 'duplicate_stable_id')
    const twice = thread({ replies: [reply(), reply()] })
    expectFrozenBody(await catchHttpError(() => run({ batch: batch({ threads: [twice] }) })), 422, 'duplicate_stable_id')
  })

  it('answers 409 sync_cursor_conflict when cursor.after does not continue the stored cursor', async () => {
    const error = await catchHttpError(() => run({ batch: batch({ cursor: { after: 'page-9', next: 'page-10' } }) }))
    expectFlowBody(error, 409, 'sync_cursor_conflict')
    expect(staff.tasks).toHaveLength(0)
    expect(store.commentThreads).toHaveLength(0)
  })

  it('answers 422 staff_link_required (staff_module_unavailable) when no Kanban adapter is registered', async () => {
    const error = await catchHttpError(() => run({ services: {} }))
    expectFlowBody(error, 422, 'staff_link_required')
    expect(detailCodes(error)).toEqual(['staff_module_unavailable'])
  })
})

describe('delivery_os.comments.import (F11) — comment import rules', () => {
  it('turns one thread into one staff task with the title and description rules', async () => {
    const result = await run()
    expect(commentImportResultSchema.safeParse(result).success).toBe(true)
    expect(result).toMatchObject({ replayed: false, counts: { threadsCreated: 1, threadsUpdated: 0, repliesCreated: 0, repliesUpdated: 0, skipped: 0 } })
    expect(staff.tasks).toHaveLength(1)
    const [task] = staff.tasks
    expect(task).toMatchObject({ staffProjectId: STAFF_PROJECT_ID, statusId: STATUS_ID, title: 'The booking button is hard to find on mobile.' })
    for (const part of ['Source: https://www.figma.com/design/FIGFILE0001', 'Author: Anna Kowalska', 'Date: 2026-09-19T10:00:00.000Z', 'Stage: ux', `Artifact: ${UX_ARTIFACT_V1}`, 'Second line with detail.']) {
      expect(task.description).toContain(part)
    }
    expect(store.commentThreads).toHaveLength(1)
    expect(store.commentThreads[0]).toMatchObject({ threadKey: 'thr-1', fileKey: FILE_KEY, staffTaskId: task.id, triageStatus: 'new', tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(result.threads[0]).toMatchObject({ threadKey: 'thr-1', staffTaskId: task.id, outcome: 'created' })
  })

  it('truncates long card texts with the marker while the delivery row keeps the full body', async () => {
    const body = `${'T'.repeat(400)}\n${'B'.repeat(9000)}`
    await run({ batch: batch({ threads: [thread({ body, replies: [reply({ body: 'R'.repeat(6000) })] })] }) })
    expect(staff.tasks[0].title).toHaveLength(STAFF_TITLE_MAX)
    expect(staff.tasks[0].title.endsWith(STAFF_TRUNCATION_MARKER)).toBe(true)
    expect(staff.tasks[0].description).toHaveLength(STAFF_DESCRIPTION_MAX)
    expect(staff.comments[0].body).toHaveLength(STAFF_COMMENT_MAX)
    expect(store.commentThreads[0].body).toBe(body)
    expect(store.commentReplies[0].body).toBe('R'.repeat(6000))
  })

  it('turns a reply into exactly one staff comment', async () => {
    const result = await run({ batch: batch({ threads: [thread({ replies: [reply()] })] }) })
    expect(staff.comments).toHaveLength(1)
    expect(staff.comments[0]).toMatchObject({ taskId: staff.tasks[0].id })
    expect(staff.comments[0].body).toContain('Moving it above the fold.')
    expect(store.commentReplies).toHaveLength(1)
    expect(store.commentReplies[0]).toMatchObject({ commentKey: 'cmt-1', revision: 1, staffCommentId: staff.comments[0].id, threadId: store.commentThreads[0].id })
    expect(result.threads[0].replies).toEqual([{ commentKey: 'cmt-1', staffCommentId: staff.comments[0].id, outcome: 'created' }])
  })

  it('stores an edit as a new reply revision and updates the same staff comment', async () => {
    await run({ batch: batch({ threads: [thread({ replies: [reply()] })] }) })
    const edited = reply({ body: 'Moved above the fold.', editedAt: '2026-09-19T11:00:00.000Z' })
    const result = await run({ key: 'import-key-0002', batch: batch({ cursor: { after: 'page-2', next: 'page-3' }, threads: [thread({ replies: [edited] })] }) })
    expect(store.commentReplies.map((row) => row.revision)).toEqual([1, 2])
    expect(staff.comments).toHaveLength(1)
    expect(staff.comments[0].body).toContain('Moved above the fold.')
    expect(adapter.updateComment).toHaveBeenCalledTimes(1)
    expect(adapter.updateTask).not.toHaveBeenCalled()
    expect(result.counts).toMatchObject({ threadsUpdated: 1, repliesUpdated: 1, repliesCreated: 0 })
  })

  it('keeps the delivery rows and the staff comment of a comment deleted at the source', async () => {
    await run({ batch: batch({ threads: [thread({ replies: [reply()] })] }) })
    await run({ key: 'import-key-0002', batch: batch({ cursor: { after: 'page-2', next: null }, threads: [thread({ replies: [reply({ deleted: true })] })] }) })
    expect(store.commentReplies).toHaveLength(2)
    expect(store.commentReplies[1]).toMatchObject({ revision: 2, deleted: true, staffCommentId: staff.comments[0].id })
    expect(staff.comments).toHaveLength(1)
    expect(staff.comments[0].body).toContain('[deleted at source]')
  })

  it('returns a reopened thread to triage new and drops its deferral', async () => {
    await run({ batch: batch({ threads: [thread({ status: 'resolved' })] }) })
    Object.assign(store.commentThreads[0], { triageStatus: 'deferred', deferral: { artifactId: UX_ARTIFACT_V1, contentHash: 'a'.repeat(64), reason: 'later', decidedBy: STATUS_ID, decidedAt: '2026-09-19T10:30:00.000Z' } })
    await run({ key: 'import-key-0002', batch: batch({ cursor: { after: 'page-2', next: null }, threads: [thread({ status: 'open' })] }) })
    expect(store.commentThreads[0]).toMatchObject({ sourceStatus: 'open', triageStatus: 'new', deferral: null })
  })

  it('returns a thread with a new reply to triage new, while a source resolve leaves triage alone', async () => {
    await run()
    Object.assign(store.commentThreads[0], { triageStatus: 'triaged' })
    await run({ key: 'import-key-0002', batch: batch({ cursor: { after: 'page-2', next: 'page-3' }, threads: [thread({ status: 'resolved' })] }) })
    expect(store.commentThreads[0]).toMatchObject({ sourceStatus: 'resolved', triageStatus: 'triaged' })
    await run({ key: 'import-key-0003', batch: batch({ cursor: { after: 'page-3', next: null }, threads: [thread({ status: 'resolved', replies: [reply()] })] }) })
    expect(store.commentThreads[0].triageStatus).toBe('new')
  })

  it('binds a thread with a figmaVersion to the artifact that carries it, never to the latest version', async () => {
    const result = await run()
    expect(store.commentThreads[0]).toMatchObject({ artifactId: UX_ARTIFACT_V1, versionConfirmed: true })
    expect(result.threads[0].versionConfirmed).toBe(true)
  })

  it('marks a thread without figmaVersion as unconfirmed and keeps artifactId as sent', async () => {
    const result = await run({ batch: batch({ threads: [thread({ figmaVersion: null })] }) })
    expect(store.commentThreads[0]).toMatchObject({ artifactId: null, versionConfirmed: false, figmaVersion: null })
    expect((store.commentThreads[0].fetchedAt as Date).toISOString()).toBe('2026-09-19T10:10:00.000Z')
    expect(result.threads[0].versionConfirmed).toBe(false)
    expect(staff.tasks[0].description).toContain('version unconfirmed')

    await run({ key: 'import-key-0002', batch: batch({ artifactId: UX_ARTIFACT_V2, cursor: { after: 'page-2', next: null }, threads: [thread({ threadKey: 'thr-2', figmaVersion: null })] }) })
    expect(store.commentThreads[1]).toMatchObject({ artifactId: UX_ARTIFACT_V2, versionConfirmed: false })
  })

  it('row-locks the project before the thread in every thread transaction', async () => {
    await run()
    const locked = mockFindOneWithDecryption.mock.calls
      .filter((call) => (call[3] as { lockMode?: LockMode } | undefined)?.lockMode === LockMode.PESSIMISTIC_WRITE)
      .map((call) => call[1])
    expect(locked.slice(0, 2)).toEqual([DeliveryProject, DeliveryCommentThread])
  })

  it('emits delivery_os.comment_thread.imported per written thread with ids only', async () => {
    await run({ batch: batch({ threads: [thread({ replies: [reply()] })] }) })
    expect(mockEmit).toHaveBeenCalledTimes(1)
    const [eventId, payload] = mockEmit.mock.calls[0] as [string, Row]
    expect(eventId).toBe('delivery_os.comment_thread.imported')
    expect(payload).toEqual({ projectId: PROJECT_ID, threadId: store.commentThreads[0].id, staffTaskId: staff.tasks[0].id, outcome: 'created', tenantId: TENANT_ID, organizationId: ORG_ID })
  })
})

describe('delivery_os.comments.import (F11) — idempotency, failures and the cursor', () => {
  it('advances the cursor and stores the batch key and hash only when every thread succeeded', async () => {
    await run()
    expect(cursor()).toMatchObject({ cursor: 'page-2', lastBatchKey: KEY, lastError: null })
    expect(cursor()?.lastBatchHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('replays the same key and batch with 200 replayed:true and writes nothing', async () => {
    const first = await run({ batch: batch({ threads: [thread({ replies: [reply()] })] }) })
    mockEmit.mockClear()
    const replay = await run({ batch: batch({ threads: [thread({ replies: [reply()] })] }) })
    expect(replay.replayed).toBe(true)
    expect(replay.threads[0]).toMatchObject({ threadId: first.threads[0].threadId, staffTaskId: first.threads[0].staffTaskId, outcome: 'unchanged' })
    expect(replay.threads[0].replies[0]).toMatchObject({ staffCommentId: staff.comments[0].id, outcome: 'unchanged' })
    expect(staff.tasks).toHaveLength(1)
    expect(staff.comments).toHaveLength(1)
    expect(adapter.createTask).toHaveBeenCalledTimes(1)
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('answers 409 idempotency_conflict for the same key with another batch', async () => {
    await run()
    const error = await catchHttpError(() => run({ batch: batch({ threads: [thread({ body: 'Another body' })] }) }))
    expectFrozenBody(error, 409, 'idempotency_conflict')
  })

  it('re-importing the same page under a new key creates no second card and no second comment', async () => {
    const page = batch({ cursor: { after: null, next: null }, threads: [thread({ replies: [reply()] })] })
    await run({ batch: page })
    const again = await run({ key: 'import-key-0002', batch: page })
    expect(again.threads[0]).toMatchObject({ outcome: 'unchanged' })
    expect(again.counts).toEqual({ threadsCreated: 0, threadsUpdated: 0, repliesCreated: 0, repliesUpdated: 0, skipped: 0 })
    expect(staff.tasks).toHaveLength(1)
    expect(staff.comments).toHaveLength(1)
    expect(store.commentThreads).toHaveLength(1)
    expect(store.commentReplies).toHaveLength(1)
  })

  it('commits thread 1, leaves no orphan of thread 2 and keeps the cursor when the staff adapter throws on thread 2', async () => {
    adapter.createTask.mockImplementationOnce(makeAdapter().createTask).mockImplementationOnce(async () => {
      throw new Error('[internal] staff board unavailable')
    })
    const result = await run({ batch: batch({ threads: [thread(), thread({ threadKey: 'thr-2' }), thread({ threadKey: 'thr-3' })] }) })
    expect(store.commentThreads.map((row) => row.threadKey)).toEqual(['thr-1', 'thr-3'])
    expect(staff.tasks).toHaveLength(2)
    expect(result.counts).toMatchObject({ threadsCreated: 2, skipped: 1 })
    expect(result.threads.map((entry) => entry.threadKey)).toEqual(['thr-1', 'thr-3'])
    expect(cursor()).toMatchObject({ cursor: null, lastBatchKey: null, lastBatchHash: null })
    expect(String(cursor()?.lastError)).toContain('thr-2')
    expect(adapter.settle.mock.calls.map((call) => call[1])).toEqual([true, false, true])
    expect(mockEmit).toHaveBeenCalledTimes(2)
  })

  it('lets a retry with the same key finish a partially failed batch without duplicating the committed card', async () => {
    adapter.createTask.mockImplementationOnce(makeAdapter().createTask).mockImplementationOnce(async () => {
      throw new Error('[internal] staff board unavailable')
    })
    const page = batch({ threads: [thread(), thread({ threadKey: 'thr-2' })] })
    await run({ batch: page })
    const retry = await run({ batch: page })
    expect(retry.replayed).toBe(false)
    expect(retry.threads.map((entry) => entry.outcome)).toEqual(['unchanged', 'created'])
    expect(staff.tasks).toHaveLength(2)
    expect(cursor()).toMatchObject({ cursor: 'page-2', lastBatchKey: KEY, lastError: null })
  })

  it('recovers a parallel import of the same thread (unique violation) as one card without a duplicate comment', async () => {
    const page = batch({ threads: [thread({ replies: [reply()] })] })
    flushFailures.push(() => {
      const winnerTask = { id: nextId(), staffProjectId: STAFF_PROJECT_ID, statusId: STATUS_ID, title: 'winner', description: 'winner' }
      const winnerComment = { id: nextId(), taskId: winnerTask.id, body: 'winner' }
      const winnerThreadId = nextId()
      onRollback = () => {
        staff.tasks.push(winnerTask)
        staff.comments.push(winnerComment)
        store.commentThreads.push({
          id: winnerThreadId,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          source: 'figma',
          fileKey: FILE_KEY,
          threadKey: 'thr-1',
          stageId: 'ux',
          artifactId: UX_ARTIFACT_V1,
          nodeId: '12:34',
          sourceUrl: page.threads[0].sourceUrl,
          author: page.threads[0].author,
          body: page.threads[0].body,
          sourceCreatedAt: new Date(page.threads[0].createdAt),
          sourceUpdatedAt: null,
          sourceStatus: 'open',
          figmaVersion: 'v-100',
          versionConfirmed: true,
          fetchedAt: new Date(page.fetchedAt),
          staffTaskId: winnerTask.id,
          triageStatus: 'new',
          deferral: null,
          linkedDeliveryTaskId: null,
          updatedAt: new Date(),
        })
        store.commentReplies.push({
          id: nextId(),
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          threadId: winnerThreadId,
          commentKey: 'cmt-1',
          revision: 1,
          author: page.threads[0].replies[0].author,
          body: page.threads[0].replies[0].body,
          sourceCreatedAt: new Date(page.threads[0].replies[0].createdAt),
          editedAt: null,
          deleted: false,
          staffCommentId: winnerComment.id,
          fetchedAt: new Date(page.fetchedAt),
        })
      }
      return uniqueViolation()
    })
    const result = await run({ batch: page })
    expect(store.commentThreads).toHaveLength(1)
    expect(store.commentReplies).toHaveLength(1)
    expect(staff.tasks).toHaveLength(1)
    expect(staff.comments).toHaveLength(1)
    expect(result.threads[0]).toMatchObject({ outcome: 'unchanged', staffTaskId: staff.tasks[0].id })
    expect(cursor()).toMatchObject({ cursor: 'page-2', lastBatchKey: KEY })
  })

  it('does not retry a unique violation raised after a staff write, so no second card or comment appears', async () => {
    await run({ batch: batch({ threads: [thread({ replies: [reply()] })] }) })
    flushFailures.push(uniqueViolation)
    const changed = batch({ cursor: { after: 'page-2', next: 'page-3' }, threads: [thread({ body: 'Rewritten request.', replies: [reply()] })] })
    const result = await run({ key: 'import-key-0002', batch: changed })
    expect(adapter.updateTask).toHaveBeenCalledTimes(1)
    expect(staff.tasks).toHaveLength(1)
    expect(staff.comments).toHaveLength(1)
    expect(store.commentThreads[0].body).toBe('The booking button is hard to find on mobile.\nSecond line with detail.')
    expect(result.counts).toMatchObject({ threadsUpdated: 0, skipped: 1 })
    expect(cursor()).toMatchObject({ cursor: 'page-2', lastBatchKey: null, lastBatchHash: null })
  })

  it('never rewinds a cursor that a concurrent delivery of the same page already advanced', async () => {
    const winner = { cursor: 'page-3', lastBatchKey: 'winner-key', lastBatchHash: 'a'.repeat(64), lastSyncAt: '2026-09-19T10:11:00.000Z', lastError: null }
    adapter.createTask.mockImplementationOnce(async (input) => {
      store.staffLinks[0].syncCursors = { [FILE_KEY]: winner }
      const task = { id: nextId(), ...input }
      staff.tasks.push(task)
      return { taskId: task.id }
    })
    const result = await run()
    expect(result.counts).toMatchObject({ threadsCreated: 1 })
    expect(cursor()).toEqual(winner)
  })

  it('skips every thread and keeps the cursor when the staff project has no status column', async () => {
    adapter.resolveDefaultStatusId.mockResolvedValueOnce(null)
    const result = await run({ batch: batch({ threads: [thread(), thread({ threadKey: 'thr-2' })] }) })
    expect(result.counts).toMatchObject({ threadsCreated: 0, skipped: 2 })
    expect(result.threads).toEqual([])
    expect(store.commentThreads).toHaveLength(0)
    expect(adapter.createTask).not.toHaveBeenCalled()
    expect(cursor()).toMatchObject({ cursor: null, lastBatchKey: null })
    expect(String(cursor()?.lastError)).toContain('thr-1')
  })

  it('skips a thread that already lives on another stage and still advances the cursor', async () => {
    await run()
    const result = await run({ key: 'import-key-0002', batch: batch({ stageId: 'key_visual', cursor: { after: 'page-2', next: 'page-3' } }) })
    expect(result.threads[0]).toMatchObject({ outcome: 'skipped' })
    expect(result.counts.skipped).toBe(1)
    expect(store.commentThreads[0].stageId).toBe('ux')
    expect(cursor()).toMatchObject({ cursor: 'page-3' })
    expect(String(cursor()?.lastError)).toContain('stage mismatch')
  })
})

describe('staff status is never authority', () => {
  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '__integration__' ? [] : sourceFiles(full)
      return /\.tsx?$/.test(entry.name) ? [full] : []
    })
  }

  it('has no delivery_os subscriber for staff.timesheets.time_task.status_changed', () => {
    const moduleRoot = path.resolve(__dirname, '../..')
    const offenders = sourceFiles(moduleRoot).filter((file) => fs.readFileSync(file, 'utf8').includes('staff.timesheets.time_task.status_changed'))
    expect(offenders).toEqual([])
  })

  it('reaches staff only through command ids, the DI adapter and one table name', () => {
    const moduleRoot = path.resolve(__dirname, '../..')
    const importers = sourceFiles(moduleRoot).filter((file) => /from ['"][^'"]*(modules\/staff|\.\.\/staff)\b/.test(fs.readFileSync(file, 'utf8')))
    expect(importers).toEqual([])
  })
})
