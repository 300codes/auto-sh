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
import { metadata, openApi } from '../projects/[id]/comment-threads/[threadId]/triage/route'
import { ACTOR_ID, FOREIGN_ORG_ID, ORG_ID, TENANT_ID, type Row } from '../../commands/__tests__/baselineTestKit'
import { commentThreadDeferralSchema } from '../../lib/contracts'
import { commentThreadTriageResponseSchema } from '../schemas'
import { expectStatus } from './flowHelpers'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  TASK_ID,
  expectFrozenError,
  isAllowedBy,
  makeTaskRow,
  readBody,
  resetRouteState,
  routeState,
  signInAs,
} from './routeTestKit'
import {
  STAFF_PROJECT_ID,
  importOnce,
  postTriage,
  prepareLinkedProject,
  resetCommentRouteKit,
  storedThread,
  threadVersion,
  registerFakeKanban,
} from './commentRouteKit'

const IMPORT_FEATURE = 'delivery_os.comments.import'
const ARTIFACT_ID = 'cccccccc-0000-4000-8000-cccccccccccc'
const OTHER_STAGE_ARTIFACT_ID = 'cccccccc-0000-4000-8000-cccccccccccd'
const OTHER_PROJECT_ARTIFACT_ID = 'cccccccc-0000-4000-8000-ccccccccccce'
const UNKNOWN_THREAD_ID = 'eeeeeeee-0000-4000-8000-eeeeeeeeeeee'
const ARTIFACT_HASH = 'c'.repeat(64)
const OTHER_HASH = 'e'.repeat(64)
const TEMPLATE_HASH = 'd'.repeat(64)

/**
 * The import writes `updatedAt: new Date()`; triage writes another `new Date()`. Pinning the imported version to a
 * fixed earlier instant keeps "the version moved" and the stale-header replay deterministic on a fast clock.
 */
const PINNED_THREAD_VERSION = new Date('2026-09-19T11:00:00.000Z')

type ImportedThread = { projectId: string; threadId: string; thread: Row; lock: string }

async function importedThread(): Promise<ImportedThread> {
  const projectId = await prepareLinkedProject()
  registerFakeKanban()
  await importOnce(projectId)
  const thread = storedThread('thr-1')
  thread.updatedAt = PINNED_THREAD_VERSION
  return { projectId, threadId: thread.id as string, thread, lock: threadVersion('thr-1') }
}

function seedArtifact(projectId: string, overrides: Row = {}): string {
  const row: Row = {
    id: ARTIFACT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId,
    stageId: 'ux',
    version: 1,
    contentHash: ARTIFACT_HASH,
    source: 'manual',
    content: {},
    dependsOn: [],
    attachmentIds: [],
    templateHash: TEMPLATE_HASH,
    createdBy: ACTOR_ID,
    createdAt: new Date('2026-09-19T11:30:00.000Z'),
    ...overrides,
  }
  routeState.store.stageArtifacts.push(row)
  return row.id as string
}

function deferredBody(artifactId: string, contentHash: string): Record<string, unknown> {
  return { triageStatus: 'deferred', deferral: { artifactId, contentHash, reason: 'Waiting for the client workshop' } }
}

function untouched(thread: Row): Record<string, unknown> {
  return { triageStatus: thread.triageStatus, deferral: thread.deferral, linkedDeliveryTaskId: thread.linkedDeliveryTaskId }
}

const PRISTINE = { triageStatus: 'new', deferral: null, linkedDeliveryTaskId: null }

beforeEach(() => {
  resetRouteState()
  resetCommentRouteKit()
})

describe('POST /projects/:id/comment-threads/:threadId/triage (F13)', () => {
  it('declares the import feature on the only documented method', () => {
    expect(isAllowedBy(metadata, 'POST', [IMPORT_FEATURE])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
  })

  it('records a triaged status and moves the thread version forward', async () => {
    const { projectId, threadId, thread, lock } = await importedThread()
    const body = await expectStatus(await postTriage(projectId, threadId, { triageStatus: 'triaged' }, lock), 200)

    expect(commentThreadTriageResponseSchema.parse(body)).toEqual({ threadId, triageStatus: 'triaged', updatedAt: body.updatedAt })
    expect(thread.triageStatus).toBe('triaged')
    expect((thread.updatedAt as Date).toISOString()).toBe(body.updatedAt)
    expect((thread.updatedAt as Date).getTime()).toBeGreaterThan(PINNED_THREAD_VERSION.getTime())
  })

  it('requires the thread header: 428 without it, 409 when the captured version is replayed', async () => {
    const { projectId, threadId, thread, lock } = await importedThread()
    await expectFrozenError(await postTriage(projectId, threadId, { triageStatus: 'triaged' }, null), 428, 'optimistic_lock_required')
    await expectStatus(await postTriage(projectId, threadId, { triageStatus: 'resolved' }, lock), 200)

    const stale = await postTriage(projectId, threadId, { triageStatus: 'triaged' }, lock)
    const conflict = await readBody(stale)
    expect({ status: stale.status, code: conflict.code }).toEqual({ status: 409, code: 'optimistic_lock_conflict' })
    expect(thread.triageStatus).toBe('resolved')
  })

  it('answers 422 reason_required for a deferred triage without a deferral', async () => {
    const { projectId, threadId, thread, lock } = await importedThread()
    await expectFrozenError(await postTriage(projectId, threadId, { triageStatus: 'deferred' }, lock), 422, 'reason_required')
    expect(untouched(thread)).toEqual(PRISTINE)
  })

  it('binds a deferral to the artifact version it was decided for', async () => {
    const { projectId, threadId, thread, lock } = await importedThread()
    const artifactId = seedArtifact(projectId)
    const body = await expectStatus(await postTriage(projectId, threadId, deferredBody(artifactId, ARTIFACT_HASH), lock), 200)

    expect(body).toMatchObject({ threadId, triageStatus: 'deferred' })
    expect(commentThreadDeferralSchema.parse(thread.deferral)).toEqual({
      artifactId,
      contentHash: ARTIFACT_HASH,
      reason: 'Waiting for the client workshop',
      decidedBy: ACTOR_ID,
      decidedAt: body.updatedAt,
    })
  })

  it('refuses a deferral naming another stage, another project or another hash', async () => {
    const { projectId, threadId, thread, lock } = await importedThread()
    const otherStage = seedArtifact(projectId, { id: OTHER_STAGE_ARTIFACT_ID, stageId: 'scope' })
    const otherProject = seedArtifact(STAFF_PROJECT_ID, { id: OTHER_PROJECT_ARTIFACT_ID })
    const artifactId = seedArtifact(projectId)

    for (const foreign of [otherStage, otherProject]) {
      await expectFrozenError(await postTriage(projectId, threadId, deferredBody(foreign, ARTIFACT_HASH), lock), 422, 'foreign_reference')
    }
    await expectFrozenError(await postTriage(projectId, threadId, deferredBody(artifactId, OTHER_HASH), lock), 422, 'hash_mismatch')
    expect(untouched(thread)).toEqual(PRISTINE)
  })

  it('refuses a linked delivery task of another project', async () => {
    const { projectId, threadId, thread, lock } = await importedThread()
    routeState.store.tasks.push(makeTaskRow({ projectId: STAFF_PROJECT_ID }))

    await expectFrozenError(
      await postTriage(projectId, threadId, { triageStatus: 'triaged', linkedDeliveryTaskId: TASK_ID }, lock),
      422,
      'foreign_reference',
    )
    expect(untouched(thread)).toEqual(PRISTINE)
  })

  it('answers 404 for an unknown thread id and for a non-uuid one', async () => {
    const { projectId, thread, lock } = await importedThread()
    await expectFrozenError(await postTriage(projectId, UNKNOWN_THREAD_ID, { triageStatus: 'triaged' }, lock), 404, 'not_found')
    await expectFrozenError(await postTriage(projectId, 'not-a-uuid', { triageStatus: 'triaged' }, lock), 404, 'not_found')
    expect(untouched(thread)).toEqual(PRISTINE)
  })

  it('answers 404 for another tenant and for another organization', async () => {
    const { projectId, threadId, thread, lock } = await importedThread()
    signInAs({ tenantId: FOREIGN_TENANT_ID })
    await expectFrozenError(await postTriage(projectId, threadId, { triageStatus: 'triaged' }, lock), 404, 'not_found')
    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFrozenError(await postTriage(projectId, threadId, { triageStatus: 'triaged' }, lock), 404, 'not_found')
    expect(untouched(thread)).toEqual(PRISTINE)
  })
})
