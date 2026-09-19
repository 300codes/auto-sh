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
import { metadata, openApi } from '../tasks/[id]/package/route'
import { FOREIGN_ORG_ID } from '../../commands/__tests__/baselineTestKit'
import { requestCancellation } from '../../lib/attempts'
import { taskPackageV1Schema, type ExecutionAttempt } from '../../lib/contracts'
import { IDEMPOTENCY_KEY, UNKNOWN_ATTEMPT_ID, getPackage, reserveAttemptId, seedReadyTask } from './attemptRouteKit'
import {
  EM_WRITE_METHODS,
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  TASK_ID,
  em,
  expectFrozenError,
  isAllowedBy,
  resetRouteState,
  routeState,
  signInAs,
} from './routeTestKit'

function clearWriteSpies(): void {
  for (const method of EM_WRITE_METHODS) em[method].mockClear()
  routeState.writes = 0
}

function expectNoWrites(): void {
  for (const method of EM_WRITE_METHODS) expect(em[method]).not.toHaveBeenCalled()
  expect(routeState.writes).toBe(0)
}

beforeEach(() => {
  resetRouteState()
})

describe('GET /api/delivery_os/tasks/:id/package', () => {
  it('requires attempts.manage and answers 401 without a session', async () => {
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
    expect(isAllowedBy(metadata, 'GET', ['delivery_os.attempts.manage'])).toBe(true)
    expect(isAllowedBy(metadata, 'GET', EMPLOYEE_FEATURES)).toBe(false)
    routeState.auth = null
    expect((await getPackage(UNKNOWN_ATTEMPT_ID)).status).toBe(401)
  })

  it('exports TaskPackage v1 twice with identical content and performs zero writes', async () => {
    const task = seedReadyTask()
    const attemptId = await reserveAttemptId()
    const registerBefore = JSON.stringify(task.executionAttempts)
    expect(em.transactional).toHaveBeenCalled()
    clearWriteSpies()

    const first = await getPackage(attemptId)
    const second = await getPackage(attemptId)
    const body = await first.json()
    expect(first.status).toBe(200)
    expect(taskPackageV1Schema.safeParse(body).success).toBe(true)
    expect(body).toMatchObject({ taskId: TASK_ID, attemptId, idempotencyKey: IDEMPOTENCY_KEY })
    expect(await second.json()).toEqual(body)
    expectNoWrites()
    expect(JSON.stringify(task.executionAttempts)).toBe(registerBefore)
  })

  it('answers 404 attempt_not_found for an unknown attempt and creates nothing', async () => {
    const task = seedReadyTask()
    clearWriteSpies()
    await expectFrozenError(await getPackage(UNKNOWN_ATTEMPT_ID), 404, 'attempt_not_found')
    await expectFrozenError(await getPackage(null), 400, 'validation_failed')
    await expectFrozenError(await getPackage('not-a-uuid'), 400, 'validation_failed')
    expectNoWrites()
    expect(task).toMatchObject({ executionAttempts: [], attemptNumber: 0, status: 'ready' })
  })

  it('answers 409 attempt_cancelled and 409 attempt_closed with the checkAttemptOpen codes', async () => {
    const task = seedReadyTask()
    const attemptId = await reserveAttemptId()
    const open = task.executionAttempts as ExecutionAttempt[]
    const cancelled = requestCancellation(open, { attemptId, now: '2026-09-19T10:00:00.000Z' })
    if (!cancelled.ok) throw new Error('[internal] fixture cancellation failed')
    task.executionAttempts = cancelled.register
    await expectFrozenError(await getPackage(attemptId), 409, 'attempt_cancelled')

    task.executionAttempts = open.map((attempt) => ({ ...attempt, state: 'result_received' }))
    await expectFrozenError(await getPackage(attemptId), 409, 'attempt_closed')

    task.executionAttempts = [{ attemptId: 'broken' }]
    await expectFrozenError(await getPackage(attemptId), 409, 'reconciliation_required')
  })

  it('answers 404 for a second tenant, a second organization, an archived task and a malformed id', async () => {
    const task = seedReadyTask()
    const attemptId = await reserveAttemptId()
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await getPackage(attemptId), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await getPackage(attemptId, 'nope'), 404, 'not_found')
    task.deletedAt = new Date()
    await expectFrozenError(await getPackage(attemptId), 404, 'not_found')
  })
})
