import { GET as READ_STAFF_LINK, PUT as SET_STAFF_LINK } from '../projects/[id]/staff-link/route'
import { POST as IMPORT_COMMENTS } from '../projects/[id]/comment-imports/route'
import { GET as LIST_THREADS } from '../projects/[id]/comment-threads/route'
import { POST as TRIAGE_THREAD } from '../projects/[id]/comment-threads/[threadId]/triage/route'
import type { DeliveryStaffKanbanAdapter } from '../../commands/staffKanbanAdapter'
import type { Row } from '../../commands/__tests__/baselineTestKit'
import type { CommentImportBatchV1, CommentReply, CommentThread } from '../../lib/contracts'
import { expectStatus, projectVersion, type Json } from './flowHelpers'
import { apiRequest, routeParams, routeState } from './routeTestKit'
import { createPinnedProject } from './stageRouteKit'

export const STAFF_PROJECT_ID = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaa1'
export const OTHER_STAFF_PROJECT_ID = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaa2'
export const STATUS_ID = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbb1'
export const FILE_KEY = 'FIGFILE0001'
export const STAFF_TIME_PROJECT_ENTITY = 'staff:staff_time_project'

export type FakeStaffTask = { id: string; staffProjectId: string; statusId: string; title: string; description: string }
export type FakeStaffComment = { id: string; taskId: string; body: string }
export type FakeStaffBoard = { tasks: FakeStaffTask[]; comments: FakeStaffComment[] }

let fakeIdCounter = 0

function nextFakeId(): string {
  fakeIdCounter += 1
  return `dddddddd-0000-4000-8000-${String(fakeIdCounter).padStart(12, '0')}`
}

/** Resets the id sequence so every suite sees the same fake staff ids. */
export function resetCommentRouteKit(): void {
  fakeIdCounter = 0
}

/**
 * Registers the staff access resolver the link command reads from DI, plus the query-engine probe it uses to confirm the
 * staff project still exists. Ids outside `reachable` answer the same `404 not_found` as an unknown id.
 */
export function registerStaffProjects(reachable: string[], options: { canManageAll?: boolean; existing?: string[] } = {}): void {
  const existing = options.existing ?? reachable
  routeState.staffAccess = {
    resolveProjectAccess: async () => ({ canManageAll: options.canManageAll ?? false, projectIds: [...reachable] }),
  }
  routeState.queryEngine.query.mockImplementation(
    async (entityId: string, query: { filters?: Record<string, { $eq?: string }> }) => {
      if (entityId !== STAFF_TIME_PROJECT_ENTITY) return { items: [], total: 0 }
      const id = query.filters?.id?.$eq
      return typeof id === 'string' && existing.includes(id) ? { items: [{ id }], total: 1 } : { items: [], total: 0 }
    },
  )
}

/** Deterministic stand-in for the staff Kanban; the real adapter is exercised by the command suite. */
export function registerFakeKanban(options: { statusId?: string | null } = {}): FakeStaffBoard {
  const board: FakeStaffBoard = { tasks: [], comments: [] }
  const adapter: DeliveryStaffKanbanAdapter = {
    resolveDefaultStatusId: async () => (options.statusId === undefined ? STATUS_ID : options.statusId),
    createTask: async (input) => {
      const task = { id: nextFakeId(), ...input }
      board.tasks.push(task)
      return { taskId: task.id }
    },
    updateTask: async (input) => {
      const task = board.tasks.find((candidate) => candidate.id === input.taskId)
      if (!task) throw new Error('[internal] fake staff task missing')
      task.title = input.title
      task.description = input.description
    },
    createComment: async (input) => {
      const comment = { id: nextFakeId(), ...input }
      board.comments.push(comment)
      return { commentId: comment.id }
    },
    updateComment: async (input) => {
      const comment = board.comments.find((candidate) => candidate.id === input.commentId)
      if (!comment) throw new Error('[internal] fake staff comment missing')
      comment.body = input.body
    },
  }
  routeState.kanbanAdapter = adapter
  return board
}

export function replyFixture(overrides: Partial<CommentReply> = {}): CommentReply {
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

export function threadFixture(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    threadKey: 'thr-1',
    nodeId: '12:34',
    sourceUrl: 'https://www.figma.com/design/FIGFILE0001?node-id=12-34#1',
    author: { name: 'Anna Kowalska', externalId: 'figma-user-1', email: null },
    body: 'The booking button is hard to find on mobile.',
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: null,
    status: 'open',
    figmaVersion: 'v-100',
    replies: [],
    ...overrides,
  }
}

export function batchFixture(projectId: string, overrides: Partial<CommentImportBatchV1> = {}): CommentImportBatchV1 {
  return {
    schemaVersion: 'delivery.comment-import/v1',
    projectId,
    source: 'figma',
    fileKey: FILE_KEY,
    stageId: 'ux',
    artifactId: null,
    fetchedAt: '2026-09-19T10:10:00.000Z',
    cursor: { after: null, next: 'page-2' },
    threads: [threadFixture()],
    ...overrides,
  }
}

export function readStaffLink(projectId: string): Promise<Response> {
  return READ_STAFF_LINK(apiRequest('GET', `/projects/${projectId}/staff-link`), routeParams(projectId))
}

export function putStaffLink(projectId: string, body: unknown, lock: string | null = null): Promise<Response> {
  return SET_STAFF_LINK(apiRequest('PUT', `/projects/${projectId}/staff-link`, { body, lock }), routeParams(projectId))
}

export function postCommentImport(
  projectId: string,
  body: unknown,
  options: { key?: string | null; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  if (options.key !== null) headers['Idempotency-Key'] = options.key ?? 'import-key-0001'
  return IMPORT_COMMENTS(apiRequest('POST', `/projects/${projectId}/comment-imports`, { body, headers }), routeParams(projectId))
}

export function listCommentThreads(projectId: string, query = ''): Promise<Response> {
  return LIST_THREADS(apiRequest('GET', `/projects/${projectId}/comment-threads${query}`), routeParams(projectId))
}

export function postTriage(projectId: string, threadId: string, body: unknown, lock: string | null): Promise<Response> {
  return TRIAGE_THREAD(apiRequest('POST', `/projects/${projectId}/comment-threads/${threadId}/triage`, { body, lock }), {
    params: { id: projectId, threadId },
  })
}

/** Pinned project + reachable staff project + fake Kanban + the stored link — the starting point of every import test. */
export async function prepareLinkedProject(): Promise<string> {
  const projectId = await createPinnedProject()
  registerStaffProjects([STAFF_PROJECT_ID, OTHER_STAFF_PROJECT_ID])
  registerFakeKanban()
  await expectStatus(await putStaffLink(projectId, { staffProjectId: STAFF_PROJECT_ID }, await projectVersion(projectId)), 200)
  return projectId
}

export function storedThreads(): Row[] {
  return routeState.store.commentThreads
}

export function storedThread(threadKey: string): Row {
  const row = storedThreads().find((candidate) => candidate.threadKey === threadKey)
  if (!row) throw new Error(`[internal] comment thread ${threadKey} is not in the route store`)
  return row
}

export function threadVersion(threadKey: string): string {
  return (storedThread(threadKey).updatedAt as Date).toISOString()
}

export async function importOnce(projectId: string, key = 'import-key-0001', overrides: Partial<CommentImportBatchV1> = {}): Promise<Json> {
  return expectStatus(await postCommentImport(projectId, batchFixture(projectId, overrides), { key }), 201)
}
