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
import { POST, metadata, openApi } from '../tasks/[id]/attempts/[attemptId]/reconcile/route'
import { POST as CANCEL } from '../tasks/[id]/attempts/[attemptId]/cancel/route'
import { DELETE as DELETE_PROJECT } from '../projects/route'
import * as tasksRoute from '../tasks/route'
import { POST as IMPORT_RESULT } from '../tasks/[id]/results/route'
import {
  FOREIGN_ORG_ID,
  PROJECT_ID,
  STALE_UPDATED_AT,
  UPDATED_AT,
  makeApproval,
} from '../../commands/__tests__/baselineTestKit'
import type { DeliveryBaseline } from '../../data/entities'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { emitDeliveryOsEvent } from '../../events'
import { attemptReconcileResponseSchema } from '../schemas'
import { UNKNOWN_ATTEMPT_ID, exportPackage, reserve, reserveAttemptId, seedReadyTask } from './attemptRouteKit'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  TASK_ID,
  apiRequest,
  expectFrozenError,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
  type Row,
} from './routeTestKit'

const EXTERNAL_EVIDENCE = { note: 'Checked the runner host: no process', observedAt: '2026-09-19T09:55:00.000Z' }

function reconcile(
  attemptId: string,
  body: unknown,
  options: { lock?: string | Date | null; taskId?: string } = {},
): Promise<Response> {
  const taskId = options.taskId ?? TASK_ID
  return POST(
    apiRequest('POST', `/tasks/${taskId}/attempts/${attemptId}/reconcile`, {
      body,
      lock: options.lock === undefined ? UPDATED_AT : options.lock,
    }),
    { params: { id: taskId, attemptId } },
  )
}

function seedApprovedTask(): Row {
  const task = seedReadyTask()
  const baseline = routeState.store.baselines[0] as unknown as DeliveryBaseline
  routeState.store.decisions.push(
    makeApproval(baseline, 'requirements') as unknown as Row,
    makeApproval(baseline, 'design') as unknown as Row,
  )
  return task
}

function attemptOf(task: Row): Record<string, unknown> {
  return (task.executionAttempts as Array<Record<string, unknown>>)[0]
}

function emittedIds(): string[] {
  return jest.mocked(emitDeliveryOsEvent).mock.calls.map(([eventId]) => eventId as string)
}

beforeEach(() => {
  resetRouteState()
  jest.mocked(emitDeliveryOsEvent).mockClear()
})

describe('POST /api/delivery_os/tasks/:id/attempts/:attemptId/reconcile — guards', () => {
  it('requires attempts.reconcile: attempts.manage alone is refused', () => {
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.attempts.reconcile'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.*'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.attempts.manage'])).toBe(false)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    expect((await reconcile(UNKNOWN_ATTEMPT_ID, { resolution: 'unknown', externalEvidence: EXTERNAL_EVIDENCE })).status).toBe(401)
  })
})

describe('POST /api/delivery_os/tasks/:id/attempts/:attemptId/reconcile', () => {
  it('stopped after a cancel closes the attempt as cancelled and frees the task for a new reservation', async () => {
    const task = seedApprovedTask()
    const attemptId = await reserveAttemptId()
    const cancelled = await CANCEL(
      apiRequest('POST', `/tasks/${TASK_ID}/attempts/${attemptId}/cancel`, { body: {}, lock: UPDATED_AT }),
      { params: { id: TASK_ID, attemptId } },
    )
    expect(cancelled.status).toBe(200)
    jest.mocked(emitDeliveryOsEvent).mockClear()

    const response = await reconcile(attemptId, { resolution: 'stopped', externalEvidence: EXTERNAL_EVIDENCE })
    const body = await readBody(response)
    expect(response.status).toBe(200)
    expect(attemptReconcileResponseSchema.safeParse(body).success).toBe(true)
    expect(Object.keys(body).sort()).toEqual(['attemptId', 'resolution', 'taskStatus', 'taskUpdatedAt'])
    expect(body).toMatchObject({ attemptId, resolution: 'stopped', taskStatus: 'ready' })
    expect(attemptOf(task)).toMatchObject({ state: 'closed', outcome: 'cancelled', stopConfirmation: 'stopped' })
    expect(emittedIds()).toEqual(['delivery_os.task.updated'])

    expect((await reserve({ key: 'reserve-key-after-reconcile' })).status).toBe(201)
    await expectFrozenError(
      await reconcile(attemptId, { resolution: 'not_started', externalEvidence: EXTERNAL_EVIDENCE }),
      409,
      'attempt_not_reconcilable',
    )
  })

  it('unknown blocks the task, a new reservation and both archives until a later reconcile', async () => {
    const task = seedApprovedTask()
    const attemptId = await reserveAttemptId()
    const response = await reconcile(attemptId, { resolution: 'unknown', externalEvidence: EXTERNAL_EVIDENCE })
    expect(await readBody(response)).toMatchObject({ resolution: 'unknown', taskStatus: 'blocked' })
    expect(task).toMatchObject({ status: 'blocked', statusReason: 'reconciliation_required' })
    expect(task.executionAttempts).toHaveLength(1)
    expect(emittedIds().every((eventId) => eventId === 'delivery_os.task.updated')).toBe(true)

    await expectFrozenError(await reserve({ key: 'reserve-key-after-unknown' }), 409, 'reconciliation_required')
    const taskArchive = await tasksRoute.DELETE(apiRequest('DELETE', `/tasks?id=${TASK_ID}`, { lock: UPDATED_AT }))
    await expectFrozenError(taskArchive, 409, 'reconciliation_required')
    const projectArchive = await DELETE_PROJECT(apiRequest('DELETE', `/projects?id=${PROJECT_ID}`, { lock: UPDATED_AT }))
    expect(projectArchive.status).toBe(409)

    const released = await reconcile(attemptId, { resolution: 'not_started', externalEvidence: EXTERNAL_EVIDENCE })
    expect(await readBody(released)).toMatchObject({ resolution: 'not_started', taskStatus: 'ready' })
    expect(task).toMatchObject({ status: 'ready', statusReason: null })
  })

  it('completed needs the manifest and then behaves like the result import: awaiting_review, never verified', async () => {
    const task = seedApprovedTask()
    const attemptId = await reserveAttemptId()
    const manifest = buildResultManifest(await exportPackage(attemptId))
    await expectFrozenError(
      await reconcile(attemptId, { resolution: 'completed', externalEvidence: EXTERNAL_EVIDENCE }),
      422,
      'manifest_required',
    )
    expect(attemptOf(task).reconciliation).toBeNull()

    const foreign = { ...manifest, taskId: UNKNOWN_ATTEMPT_ID }
    const viaReconcile = await readBody(await reconcile(attemptId, { resolution: 'completed', externalEvidence: EXTERNAL_EVIDENCE, manifest: foreign }))
    const viaImport = await readBody(
      await IMPORT_RESULT(apiRequest('POST', `/tasks/${TASK_ID}/results`, { body: { attemptId, manifest: foreign } }), routeParams(TASK_ID)),
    )
    expect(typeof viaImport.code).toBe('string')
    expect(viaReconcile.code).toBe(viaImport.code)
    expect(attemptOf(task).reconciliation).toBeNull()
    expect(routeState.store.evidence).toHaveLength(0)

    const response = await reconcile(attemptId, { resolution: 'completed', externalEvidence: EXTERNAL_EVIDENCE, manifest })
    const body = await readBody(response)
    expect(response.status).toBe(200)
    expect(attemptReconcileResponseSchema.safeParse(body).success).toBe(true)
    expect(body).toMatchObject({ resolution: 'completed', taskStatus: 'awaiting_review' })
    expect(routeState.store.evidence).toHaveLength(1)
    expect(body.evidenceId).toBe(routeState.store.evidence[0].id)
    expect(task.status).toBe('awaiting_review')
    expect(attemptOf(task)).toMatchObject({ outcome: 'result_accepted', reconciliation: { resolution: 'completed' } })
    expect(emittedIds().every((eventId) => ['delivery_os.task.updated', 'delivery_os.evidence.recorded'].includes(eventId))).toBe(true)
  })

  it('needs the task version: 428 without it, platform 409 when stale', async () => {
    const task = seedApprovedTask()
    const attemptId = await reserveAttemptId()
    const body = { resolution: 'stopped', externalEvidence: EXTERNAL_EVIDENCE }
    await expectFrozenError(await reconcile(attemptId, body, { lock: null }), 428, 'optimistic_lock_required')
    const stale = await reconcile(attemptId, body, { lock: STALE_UPDATED_AT })
    expect(stale.status).toBe(409)
    expect((await readBody(stale)).code).toBe('optimistic_lock_conflict')
    expect(attemptOf(task).state).toBe('reserved')
  })

  it('answers 400 for a bad body and 404 for an unknown attempt, a foreign scope and a malformed id — scope first', async () => {
    const task = seedApprovedTask()
    const attemptId = await reserveAttemptId()
    const body = { resolution: 'stopped', externalEvidence: EXTERNAL_EVIDENCE }
    await expectFrozenError(await reconcile(attemptId, { resolution: 'restarted', externalEvidence: EXTERNAL_EVIDENCE }), 400, 'validation_failed')
    await expectFrozenError(await reconcile(attemptId, { resolution: 'stopped' }), 400, 'validation_failed')
    await expectFrozenError(await reconcile(UNKNOWN_ATTEMPT_ID, body), 404, 'attempt_not_found')
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await reconcile(attemptId, { resolution: 'completed', externalEvidence: EXTERNAL_EVIDENCE }), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await reconcile('nope', body), 404, 'not_found')
    await expectFrozenError(await reconcile(attemptId, body, { taskId: 'nope' }), 404, 'not_found')
    expect(attemptOf(task).state).toBe('reserved')
  })

  it('ignores ids, scope and a trusted option sent in the body', async () => {
    const task = seedApprovedTask()
    const attemptId = await reserveAttemptId()
    const response = await reconcile(attemptId, {
      resolution: 'not_started',
      externalEvidence: EXTERNAL_EVIDENCE,
      attemptId: UNKNOWN_ATTEMPT_ID,
      taskId: FOREIGN_ORG_ID,
      trustedExecution: { source: 'delivery_agents', actorUserId: FOREIGN_ORG_ID },
    })
    expect(response.status).toBe(200)
    expect((attemptOf(task).reconciliation as Record<string, unknown>).actorUserId).toBe(routeState.auth?.sub)
  })
})
