jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))

import '@open-mercato/core/modules/delivery_os/commands'
import { LockMode } from '@mikro-orm/core'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DeliveryCommentThread, DeliveryFlowStageArtifact, DeliveryProject } from '../../data/entities'
import type { CommentThreadTriageCommandResult } from '../comments'
import {
  ACTOR_ID,
  catchHttpError,
  detailCodes,
  emptyStore,
  expectFrozenBody,
  FOREIGN_ORG_ID,
  getHandler,
  makeHarness,
  makeProject,
  matches,
  ORG_ID,
  PROJECT_ID,
  rowsFor,
  STALE_UPDATED_AT,
  TENANT_ID,
  UPDATED_AT,
  type Row,
  type Store,
} from './baselineTestKit'

const THREAD_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const UX_ARTIFACT_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const KV_ARTIFACT_ID = 'cccccccc-3333-4333-8333-cccccccccccc'
const FOREIGN_ARTIFACT_ID = 'dddddddd-4444-4444-8444-dddddddddddd'
const TASK_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const FOREIGN_TASK_ID = 'ffffffff-6666-4666-8666-ffffffffffff'
const OTHER_PROJECT_ID = '12121212-7777-4777-8777-121212121212'
const UX_HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)
const THREAD_UPDATED_AT = new Date('2026-09-19T10:00:00.000Z')

const triage = getHandler<CommentThreadTriageCommandResult>('delivery_os.comments.triage')

let store: Store
let artifacts: Row[]

function rows(entity: unknown): Row[] {
  return entity === DeliveryFlowStageArtifact ? artifacts : rowsFor(store, entity)
}

function threadLock(value: string = THREAD_UPDATED_AT.toISOString()): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: value }
}

function run(request: Row, options: { headers?: Record<string, string>; orgId?: string; threadId?: string } = {}): Promise<CommentThreadTriageCommandResult> {
  const { ctx } = makeHarness(store, { headers: options.headers ?? threadLock(), orgId: options.orgId })
  return Promise.resolve(triage.execute({ projectId: PROJECT_ID, threadId: options.threadId ?? THREAD_ID, triage: request }, ctx))
}

function threadRow(overrides: Row = {}): Row {
  return {
    id: THREAD_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    source: 'figma',
    fileKey: 'fileA',
    threadKey: 'thread-1',
    stageId: 'ux',
    artifactId: UX_ARTIFACT_ID,
    author: { name: 'Anna', externalId: null },
    body: 'Move the CTA',
    sourceStatus: 'open',
    triageStatus: 'new',
    deferral: null,
    linkedDeliveryTaskId: null,
    updatedAt: THREAD_UPDATED_AT,
    ...overrides,
  }
}

function artifactRow(id: string, stageId: string, overrides: Row = {}): Row {
  return { id, tenantId: TENANT_ID, organizationId: ORG_ID, projectId: PROJECT_ID, stageId, version: 1, contentHash: UX_HASH, ...overrides }
}

function deferral(overrides: Row = {}): Row {
  return { artifactId: UX_ARTIFACT_ID, contentHash: UX_HASH, reason: 'Agreed with the client to fix after launch', ...overrides }
}

beforeEach(() => {
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).find((row) => matches(row, where)) ?? null)
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).filter((row) => matches(row, where)))
  store = { ...emptyStore(), projects: [makeProject()], commentThreads: [threadRow()] }
  store.tasks.push({ id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, projectId: PROJECT_ID, deletedAt: null } as never)
  store.tasks.push({ id: FOREIGN_TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, projectId: OTHER_PROJECT_ID, deletedAt: null } as never)
  artifacts = [
    artifactRow(UX_ARTIFACT_ID, 'ux'),
    artifactRow(KV_ARTIFACT_ID, 'key_visual'),
    artifactRow(FOREIGN_ARTIFACT_ID, 'ux', { projectId: OTHER_PROJECT_ID }),
  ]
})

describe('delivery_os.comments.triage (F13)', () => {
  it('marks a thread triaged, links a delivery task of the same project and bumps only the thread version', async () => {
    const result = await run({ triageStatus: 'triaged', linkedDeliveryTaskId: TASK_ID })
    expect(result).toMatchObject({ threadId: THREAD_ID, projectId: PROJECT_ID, triageStatus: 'triaged' })
    const thread = store.commentThreads[0]
    expect(thread).toMatchObject({ triageStatus: 'triaged', linkedDeliveryTaskId: TASK_ID, deferral: null, body: 'Move the CTA' })
    expect((thread.updatedAt as Date).toISOString()).toBe(result.updatedAt)
    expect(store.projects[0].updatedAt).toEqual(UPDATED_AT)
    expect(store.tasks[0]).not.toHaveProperty('status')
  })

  it('row-locks the project before the thread inside the transaction', async () => {
    await run({ triageStatus: 'triaged' })
    const locked = mockFindOneWithDecryption.mock.calls
      .filter((call) => (call[3] as { lockMode?: LockMode } | undefined)?.lockMode === LockMode.PESSIMISTIC_WRITE)
      .map((call) => call[1])
    expect(locked).toEqual([DeliveryProject, DeliveryCommentThread])
  })

  it('records a hash-bound deferral with the deciding actor', async () => {
    await run({ triageStatus: 'deferred', deferral: deferral() })
    expect(store.commentThreads[0]).toMatchObject({
      triageStatus: 'deferred',
      deferral: { artifactId: UX_ARTIFACT_ID, contentHash: UX_HASH, reason: 'Agreed with the client to fix after launch', decidedBy: ACTOR_ID },
    })
  })

  it('clears a stored deferral when the thread leaves the deferred state and keeps the task link when it is not sent', async () => {
    store.commentThreads = [threadRow({ triageStatus: 'deferred', deferral: { ...deferral(), decidedBy: ACTOR_ID, decidedAt: UPDATED_AT.toISOString() }, linkedDeliveryTaskId: TASK_ID })]
    await run({ triageStatus: 'resolved' })
    expect(store.commentThreads[0]).toMatchObject({ triageStatus: 'resolved', deferral: null, linkedDeliveryTaskId: TASK_ID })
    store.commentThreads[0].updatedAt = THREAD_UPDATED_AT
    await run({ triageStatus: 'new', linkedDeliveryTaskId: null })
    expect(store.commentThreads[0]).toMatchObject({ triageStatus: 'new', linkedDeliveryTaskId: null })
  })

  it('requires the thread lock header and rejects a stale thread version with 409', async () => {
    expectFrozenBody(await catchHttpError(() => run({ triageStatus: 'triaged' }, { headers: {} })), 428, 'optimistic_lock_required')
    const stale = await catchHttpError(() => run({ triageStatus: 'triaged' }, { headers: threadLock(STALE_UPDATED_AT) }))
    expect(stale.status).toBe(409)
    expect(store.commentThreads[0].triageStatus).toBe('new')
  })

  it('does not accept the project version as the thread lock', async () => {
    const error = await catchHttpError(() => run({ triageStatus: 'triaged' }, { headers: threadLock(UPDATED_AT.toISOString()) }))
    expect(error.status).toBe(409)
  })

  it('rejects a deferral without artifact and reason', async () => {
    const error = await catchHttpError(() => run({ triageStatus: 'deferred' }))
    expect(detailCodes(error)).toContain('reason_required')
    expect(store.commentThreads[0].triageStatus).toBe('new')
  })

  it.each([
    ['an artifact of another project', { artifactId: FOREIGN_ARTIFACT_ID }],
    ['an artifact of another stage', { artifactId: KV_ARTIFACT_ID }],
    ['an unknown artifact', { artifactId: '99999999-0000-4000-8000-999999999999' }],
  ])('rejects a deferral bound to %s with 422 foreign_reference', async (_label, overrides) => {
    const error = await catchHttpError(() => run({ triageStatus: 'deferred', deferral: deferral(overrides) }))
    expectFrozenBody(error, 422, 'foreign_reference')
    expect(detailCodes(error)).toEqual(['foreign_artifact'])
    expect(store.commentThreads[0].deferral).toBeNull()
  })

  it('rejects a deferral whose hash is not the artifact content hash with 422 hash_mismatch', async () => {
    const error = await catchHttpError(() => run({ triageStatus: 'deferred', deferral: deferral({ contentHash: OTHER_HASH }) }))
    expectFrozenBody(error, 422, 'hash_mismatch')
  })

  it('rejects a delivery task of another project with 422 foreign_reference', async () => {
    const error = await catchHttpError(() => run({ triageStatus: 'triaged', linkedDeliveryTaskId: FOREIGN_TASK_ID }))
    expectFrozenBody(error, 422, 'foreign_reference')
    expect(detailCodes(error)).toEqual(['foreign_task'])
  })

  it('answers 404 for an unknown thread, a thread of another project and a caller of another organization', async () => {
    expectFrozenBody(await catchHttpError(() => run({ triageStatus: 'triaged' }, { threadId: '99999999-0000-4000-8000-999999999999' })), 404, 'not_found')
    store.commentThreads = [threadRow({ projectId: OTHER_PROJECT_ID })]
    expectFrozenBody(await catchHttpError(() => run({ triageStatus: 'triaged' })), 404, 'not_found')
    store.commentThreads = [threadRow()]
    expectFrozenBody(await catchHttpError(() => run({ triageStatus: 'triaged' }, { orgId: FOREIGN_ORG_ID })), 404, 'not_found')
  })

  it('rejects an unknown triage status', async () => {
    expectFrozenBody(await catchHttpError(() => run({ triageStatus: 'done' })), 400, 'validation_failed')
  })
})
