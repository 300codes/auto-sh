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
import { metadata, openApi } from '../tasks/[id]/attempts/route'
import { FOREIGN_ORG_ID, STALE_UPDATED_AT } from '../../commands/__tests__/baselineTestKit'
import { reserveAttemptResponseSchema } from '../../lib/contracts'
import { BASE_REVISION, RESERVE_BODY, reserve, seedReadyTask } from './attemptRouteKit'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  TASK_ID,
  detailCodesOf,
  expectFrozenError,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeState,
  signInAs,
} from './routeTestKit'

const OTHER_REVISION = { kind: 'git', commitSha: '1111111111111111111111111111111111111111' }

beforeEach(() => {
  resetRouteState()
})

describe('POST /api/delivery_os/tasks/:id/attempts — guards', () => {
  it('requires attempts.manage: an import-only user cannot reserve', () => {
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.attempts.manage'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.*'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.results.import'])).toBe(false)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    expect((await reserve()).status).toBe(401)
  })
})

describe('POST /api/delivery_os/tasks/:id/attempts', () => {
  it('answers 201 for a new key, then 200 with the same attempt for the same key, even without a lock header', async () => {
    const task = seedReadyTask()
    const created = await reserve()
    const createdBody = await readBody(created)
    expect(created.status).toBe(201)
    expect(reserveAttemptResponseSchema.safeParse(createdBody).success).toBe(true)
    expect(Object.keys(createdBody)).not.toContain('created')
    expect(createdBody.packageUrl).toBe(`/api/delivery_os/tasks/${TASK_ID}/package?attemptId=${createdBody.attemptId}`)
    expect(task).toMatchObject({ status: 'executing', attemptNumber: 1 })

    for (const lock of [null, STALE_UPDATED_AT]) {
      const replay = await reserve({ lock })
      expect(replay.status).toBe(200)
      expect((await readBody(replay)).attemptId).toBe(createdBody.attemptId)
    }
    expect(task.executionAttempts).toHaveLength(1)
  })

  it('answers 409 idempotency_conflict for the same key with another payload and 409 attempt_active for a second key', async () => {
    const task = seedReadyTask()
    await reserve()
    const otherPayload = await reserve({ body: { mode: 'manual_handoff', baseRevision: OTHER_REVISION } })
    await expectFrozenError(otherPayload, 409, 'idempotency_conflict')
    await expectFrozenError(await reserve({ key: 'reserve-key-002' }), 409, 'attempt_active')
    expect(task.executionAttempts).toHaveLength(1)
  })

  it('answers 400 idempotency_key_required without the header, even with a bad body', async () => {
    const task = seedReadyTask()
    await expectFrozenError(await reserve({ key: null }), 400, 'idempotency_key_required')
    await expectFrozenError(await reserve({ key: null, body: { mode: 'automatic' } }), 400, 'idempotency_key_required')
    await expectFrozenError(await reserve({ key: 'has space' }), 400, 'validation_failed')
    expect(task).toMatchObject({ status: 'ready', attemptNumber: 0 })
  })

  it('rejects mode automatic and never forwards trustedExecution', async () => {
    const task = seedReadyTask()
    const automatic = await reserve({ body: { mode: 'automatic', baseRevision: BASE_REVISION } })
    const body = await expectFrozenError(automatic, 400, 'validation_failed')
    expect((body.details as Array<{ path?: string }>).map((detail) => detail.path)).toContain('mode')
    expect(task.status).toBe('ready')

    const smuggled = await reserve({
      body: {
        ...RESERVE_BODY,
        trustedExecution: { source: 'delivery_agents', actorUserId: TASK_ID },
        taskId: FOREIGN_ORG_ID,
        idempotencyKey: 'body-key',
      },
    })
    expect(smuggled.status).toBe(201)
    expect((task.executionAttempts as Array<{ idempotencyKey: string }>)[0].idempotencyKey).toBe('reserve-key-001')
    expect((await reserve({ lock: null })).status).toBe(200)
    expect((task.executionAttempts as Array<{ mode: string }>)[0].mode).toBe('manual_handoff')
  })

  it('needs the task version for a new key: 428 without it, platform 409 when stale', async () => {
    const task = seedReadyTask()
    await expectFrozenError(await reserve({ lock: null }), 428, 'optimistic_lock_required')
    const stale = await reserve({ lock: STALE_UPDATED_AT })
    expect(stale.status).toBe(409)
    expect((await readBody(stale)).code).toBe('optimistic_lock_conflict')
    expect(task).toMatchObject({ status: 'ready', attemptNumber: 0 })
  })

  it('answers 409 task_not_ready for a draft task and 422 revision_kind_mismatch for a snapshot revision', async () => {
    const task = seedReadyTask({ status: 'draft' })
    const notReady = await expectFrozenError(await reserve(), 409, 'task_not_ready')
    expect(detailCodesOf(notReady)).toContain('task_not_ready')
    task.status = 'ready'
    const snapshot = { kind: 'snapshot', contentHash: 'a'.repeat(64), externalWorkspaceId: 'workspace-1' }
    await expectFrozenError(await reserve({ body: { mode: 'manual_handoff', baseRevision: snapshot } }), 422, 'revision_kind_mismatch')
  })

  it('answers 404 for a second tenant, a second organization and a malformed id', async () => {
    const task = seedReadyTask()
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await reserve(), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await reserve({ taskId: 'nope' }), 404, 'not_found')
    expect(task.executionAttempts).toHaveLength(0)
  })
})
