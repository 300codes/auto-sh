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
import { POST, metadata, openApi } from '../tasks/[id]/attempts/[attemptId]/cancel/route'
import { DELETE as DELETE_PROJECT } from '../projects/route'
import * as tasksRoute from '../tasks/route'
import { POST as IMPORT_RESULT } from '../tasks/[id]/results/route'
import { FOREIGN_ORG_ID, PROJECT_ID, STALE_UPDATED_AT, UPDATED_AT } from '../../commands/__tests__/baselineTestKit'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { emitDeliveryOsEvent } from '../../events'
import { attemptCancelResponseSchema } from '../schemas'
import { UNKNOWN_ATTEMPT_ID, exportPackage, reserve, reserveAttemptId, seedReadyTask } from './attemptRouteKit'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  TASK_ID,
  apiRequest,
  detailCodesOf,
  expectFrozenError,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

function cancel(
  attemptId: string,
  options: { body?: unknown; lock?: string | Date | null; taskId?: string } = {},
): Promise<Response> {
  const taskId = options.taskId ?? TASK_ID
  return POST(
    apiRequest('POST', `/tasks/${taskId}/attempts/${attemptId}/cancel`, {
      body: options.body ?? {},
      lock: options.lock === undefined ? UPDATED_AT : options.lock,
    }),
    { params: { id: taskId, attemptId } },
  )
}

function importResult(body: unknown): Promise<Response> {
  return IMPORT_RESULT(apiRequest('POST', `/tasks/${TASK_ID}/results`, { body }), routeParams(TASK_ID))
}

beforeEach(() => {
  resetRouteState()
  jest.mocked(emitDeliveryOsEvent).mockClear()
})

describe('POST /api/delivery_os/tasks/:id/attempts/:attemptId/cancel — guards', () => {
  it('requires attempts.manage: a user with projects.manage and results.import is refused', () => {
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.attempts.manage'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.*'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.projects.manage'])).toBe(false)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    expect((await cancel(UNKNOWN_ATTEMPT_ID)).status).toBe(401)
  })
})

describe('POST /api/delivery_os/tasks/:id/attempts/:attemptId/cancel', () => {
  it('answers 200 with the documented body that never claims a stop, and repeats idempotently', async () => {
    const task = seedReadyTask()
    const attemptId = await reserveAttemptId()
    jest.mocked(emitDeliveryOsEvent).mockClear()

    const response = await cancel(attemptId, { body: { reason: 'Operator picked the wrong screen' } })
    const body = await readBody(response)
    expect(response.status).toBe(200)
    expect(attemptCancelResponseSchema.safeParse(body).success).toBe(true)
    expect(Object.keys(body).sort()).toEqual(['attemptId', 'state', 'stopConfirmation', 'taskStatus', 'taskUpdatedAt'])
    expect(body).toMatchObject({ attemptId, state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed', taskStatus: 'executing' })
    expect(task.status).toBe('executing')
    expect((task.executionAttempts as Array<Record<string, unknown>>)[0]).toMatchObject({
      state: 'cancel_requested',
      stopConfirmation: 'stop_unconfirmed',
      closedAt: null,
    })
    expect(JSON.stringify(task.executionAttempts)).not.toContain('Operator picked the wrong screen')
    const updates = jest.mocked(emitDeliveryOsEvent).mock.calls.filter(([eventId]) => eventId === 'delivery_os.task.updated')
    expect(updates).toHaveLength(1)

    const repeat = await cancel(attemptId, { lock: STALE_UPDATED_AT })
    expect(repeat.status).toBe(200)
    expect(await readBody(repeat)).toEqual(body)
    expect(jest.mocked(emitDeliveryOsEvent).mock.calls.filter(([eventId]) => eventId === 'delivery_os.task.updated')).toHaveLength(1)
  })

  it('ignores ids and scope sent in the body', async () => {
    const task = seedReadyTask()
    const attemptId = await reserveAttemptId()
    const response = await cancel(attemptId, { body: { attemptId: UNKNOWN_ATTEMPT_ID, taskId: FOREIGN_ORG_ID, organizationId: FOREIGN_ORG_ID } })
    expect(response.status).toBe(200)
    expect((task.executionAttempts as Array<{ state: string }>)[0].state).toBe('cancel_requested')
  })

  it('needs the task version: 428 without it, platform 409 when stale', async () => {
    const task = seedReadyTask()
    const attemptId = await reserveAttemptId()
    await expectFrozenError(await cancel(attemptId, { lock: null }), 428, 'optimistic_lock_required')
    const stale = await cancel(attemptId, { lock: STALE_UPDATED_AT })
    expect(stale.status).toBe(409)
    expect((await readBody(stale)).code).toBe('optimistic_lock_conflict')
    expect((task.executionAttempts as Array<{ state: string }>)[0].state).toBe('reserved')
  })

  it('answers 400 for a reason above the cap, 404 for an unknown attempt, a foreign scope and a malformed id', async () => {
    const task = seedReadyTask()
    const attemptId = await reserveAttemptId()
    await expectFrozenError(await cancel(attemptId, { body: { reason: 'x'.repeat(2001) } }), 400, 'validation_failed')
    await expectFrozenError(await cancel(UNKNOWN_ATTEMPT_ID), 404, 'attempt_not_found')
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await cancel(attemptId), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await cancel('nope'), 404, 'not_found')
    await expectFrozenError(await cancel(attemptId, { taskId: 'nope' }), 404, 'not_found')
    expect((task.executionAttempts as Array<{ state: string }>)[0].state).toBe('reserved')
  })

  it('after a cancel refuses a new reservation, both archives and a late result, and records no evidence', async () => {
    const task = seedReadyTask()
    const attemptId = await reserveAttemptId()
    const manifest = buildResultManifest(await exportPackage(attemptId))
    expect((await cancel(attemptId)).status).toBe(200)

    await expectFrozenError(await reserve({ key: 'reserve-key-after-cancel' }), 409, 'attempt_active')
    const taskArchive = await tasksRoute.DELETE(apiRequest('DELETE', `/tasks?id=${TASK_ID}`, { lock: UPDATED_AT }))
    expect(detailCodesOf(await expectFrozenError(taskArchive, 409, 'attempt_active'))).toContain('attempt_cancel_requested')
    const projectArchive = await DELETE_PROJECT(apiRequest('DELETE', `/projects?id=${PROJECT_ID}`, { lock: UPDATED_AT }))
    await expectFrozenError(projectArchive, 409, 'attempt_active')

    await expectFrozenError(await importResult({ attemptId, manifest }), 409, 'attempt_cancelled')
    expect(routeState.store.evidence).toHaveLength(0)
    expect(task).toMatchObject({ status: 'executing', deletedAt: null })
    expect(task.executionAttempts).toHaveLength(1)
  })

  it('refuses to cancel an accepted attempt, while the identical result replay still answers duplicate', async () => {
    seedReadyTask()
    const attemptId = await reserveAttemptId()
    const manifest = buildResultManifest(await exportPackage(attemptId))
    const accepted = await importResult({ attemptId, manifest })
    expect(accepted.status).toBe(201)

    await expectFrozenError(await cancel(attemptId), 409, 'attempt_not_active')
    const replay = await importResult({ attemptId, manifest })
    expect(replay.status).toBe(200)
    expect(await readBody(replay)).toMatchObject({ duplicate: true, evidenceId: (await readBody(accepted)).evidenceId })
    expect(routeState.store.evidence).toHaveLength(1)
  })
})
