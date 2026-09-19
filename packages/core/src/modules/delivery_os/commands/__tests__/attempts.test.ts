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

const mockEmitDeliveryOsEvent = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('../../events', () => ({
  emitDeliveryOsEvent: (...args: unknown[]) => mockEmitDeliveryOsEvent(...args),
}))

import '@open-mercato/core/modules/delivery_os/commands'
import { LockMode } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DeliveryBaseline, DeliveryEvidence, DeliveryProject, DeliveryTask } from '../../data/entities'
import { closeAttempt, reconcileAttempt, recordAttemptResult, reserveAttempt } from '../../lib/attempts'
import {
  MAX_EXECUTION_ATTEMPTS,
  reserveAttemptResponseSchema,
  type ExecutionAttempt,
  type SourceRevision,
} from '../../lib/contracts'
import { loadNegativeDeliveryFixtures } from '../../lib/fixtures'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import { checkTaskReservable, type AttemptInternalCommandResult, type AttemptReserveResult } from '../attempts'
import {
  ACTOR_ID,
  BASELINE_ID,
  FOREIGN_ORG_ID,
  ORG_ID,
  PROJECT_ID,
  STALE_UPDATED_AT,
  TENANT_ID,
  UPDATED_AT,
  catchHttpError,
  detailCodes,
  expectFrozenBody,
  getHandler,
  makeBaseline,
  makeProject,
  matches,
  type EmMock,
  type Row,
} from './baselineTestKit'

const TASK_A = '66666666-6666-4666-8666-66666666666a'
const TASK_B = '66666666-6666-4666-8666-66666666666b'
const OTHER_BASELINE_ID = '5a5a5a5a-5555-4555-8555-555555555556'
const NOW = '2026-09-19T10:00:00.000Z'
const gitRevision: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
const otherGitRevision: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }
const snapshotRevision: SourceRevision = { kind: 'snapshot', contentHash: 'c'.repeat(64), externalWorkspaceId: 'wp-local-1' }
const FRESH_HEADERS = { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() }
const STALE_HEADERS = { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT }

type Store = {
  projects: DeliveryProject[]
  tasks: DeliveryTask[]
  baselines: DeliveryBaseline[]
  evidence: DeliveryEvidence[]
}

let store: Store

function rowsFor(entity: unknown): Row[] {
  if (entity === DeliveryProject) return store.projects as unknown as Row[]
  if (entity === DeliveryTask) return store.tasks as unknown as Row[]
  if (entity === DeliveryBaseline) return store.baselines as unknown as Row[]
  if (entity === DeliveryEvidence) return store.evidence as unknown as Row[]
  throw new Error('[internal] unexpected entity in test store')
}

function makeTask(overrides: Partial<DeliveryTask> = {}): DeliveryTask {
  return {
    id: TASK_A,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    title: 'Service list',
    description: null,
    acIds: ['AC-001'],
    dependsOnTaskIds: [],
    allowedPaths: ['src/services'],
    targetProfileId: 'react-vite',
    targetProfileVersion: 1,
    status: 'ready',
    statusReason: null,
    attemptNumber: 0,
    executionAttempts: [],
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryTask
}

function makeReview(): DeliveryEvidence {
  return {
    id: `review-${store?.evidence.length ?? 0}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: TASK_A,
    kind: 'review',
    payload: { verdict: 'changes_requested' },
  } as unknown as DeliveryEvidence
}

function seed(tasks: DeliveryTask[], overrides: Partial<Store> = {}): void {
  store = {
    projects: [makeProject({ activeBaselineId: BASELINE_ID })],
    tasks,
    baselines: [makeBaseline()],
    evidence: [],
    ...overrides,
  }
}

function registerWith(count: number, last: 'closed' | 'reserved' | 'unknown'): ExecutionAttempt[] {
  let register: ExecutionAttempt[] = []
  for (let index = 0; index < count; index += 1) {
    const attemptId = `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`
    const reserved = reserveAttempt(register, {
      idempotencyKey: `seed-key-${index}`,
      payload: { mode: 'manual_handoff', baseRevision: gitRevision },
      mode: 'manual_handoff',
      baselineId: BASELINE_ID,
      baselineHash: store.baselines[0].contentHash,
      baseRevision: gitRevision,
      now: NOW,
      newAttemptId: attemptId,
    })
    if (!reserved.ok) throw new Error('[internal] fixture reservation failed')
    register = reserved.register
    const isLast = index === count - 1
    if (isLast && last === 'reserved') continue
    const reconciled = reconcileAttempt(register, {
      attemptId,
      resolution: isLast && last === 'unknown' ? 'unknown' : 'not_started',
      note: 'Checked the runner',
      observedAt: NOW,
      actorUserId: ACTOR_ID,
      now: NOW,
    })
    if (!reconciled.ok) throw new Error('[internal] fixture reconciliation failed')
    register = reconciled.register
  }
  return register
}

function makeHarness(options: { headers?: Record<string, string>; orgId?: string; inProcess?: boolean } = {}) {
  const em: EmMock = {
    fork: jest.fn(),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => work(em))
  const services: Record<string, unknown> = { em, dataEngine: { markOrmEntityChange: jest.fn() } }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name in services) return services[name]
      throw new Error(`[internal] ${name} is not registered`)
    }),
  }
  const ctx: CommandRuntimeContext = {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: ACTOR_ID, tenantId: TENANT_ID, orgId: options.orgId ?? ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    ...(options.inProcess
      ? {}
      : { request: new Request('http://localhost/api/delivery_os/tasks', { method: 'POST', headers: options.headers }) }),
  }
  return { ctx, em }
}

const handler = () => getHandler<AttemptReserveResult>('delivery_os.attempts.reserve')

function body(overrides: Row = {}): Row {
  return { taskId: TASK_A, idempotencyKey: 'key-1', mode: 'manual_handoff', baseRevision: gitRevision, ...overrides }
}

function reserve(options: Parameters<typeof makeHarness>[0], input: Row = body()) {
  const { ctx } = makeHarness(options)
  return handler().execute(input, ctx)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).filter((row) => matches(row, where)),
  )
  mockFindOneWithDecryption.mockImplementation(
    async (_em: unknown, entity: unknown, where: Row) => rowsFor(entity).find((row) => matches(row, where)) ?? null,
  )
})

describe('delivery_os.attempts.reserve', () => {
  it('reserves an attempt for a new key, moves the task to executing and emits one event', async () => {
    seed([makeTask()])
    const result = await reserve({ headers: FRESH_HEADERS })
    const [task] = store.tasks
    expect(result.created).toBe(true)
    const { created: _created, ...response } = result
    expect(reserveAttemptResponseSchema.safeParse(response).success).toBe(true)
    expect(result.baselineHash).toBe(store.baselines[0].contentHash)
    expect(task.status).toBe('executing')
    expect(task.attemptNumber).toBe(1)
    expect(task.executionAttempts).toHaveLength(1)
    expect(task.executionAttempts[0]).toMatchObject({
      attemptId: result.attemptId,
      idempotencyKey: 'key-1',
      mode: 'manual_handoff',
      state: 'reserved',
      baseCommit: gitRevision.commitSha,
    })
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitDeliveryOsEvent.mock.calls[0][0]).toBe('delivery_os.task.updated')
    expect(mockEmitDeliveryOsEvent.mock.calls[0][1]).toMatchObject({ taskId: TASK_A, status: 'executing' })
  })

  it('locks the project and then the task row inside one transaction', async () => {
    seed([makeTask()])
    const { ctx, em } = makeHarness({ headers: FRESH_HEADERS })
    await handler().execute(body(), ctx)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    const lockedReads = mockFindOneWithDecryption.mock.calls
      .filter(([, , , options]) => options?.lockMode === LockMode.PESSIMISTIC_WRITE)
      .map(([, entity]) => entity)
    expect(lockedReads).toEqual([DeliveryProject, DeliveryTask])
  })

  it('locks the task row for write', async () => {
    seed([makeTask()])
    await reserve({ headers: FRESH_HEADERS })
    const lockedTaskRead = mockFindOneWithDecryption.mock.calls.find(
      ([, entity, , options]) => entity === DeliveryTask && options?.lockMode === LockMode.PESSIMISTIC_WRITE,
    )
    expect(lockedTaskRead).toBeDefined()
  })

  it('replays the same key and payload without a lock header and without writes', async () => {
    seed([makeTask()])
    const first = await reserve({ headers: FRESH_HEADERS })
    const before = JSON.stringify(store.tasks)
    mockEmitDeliveryOsEvent.mockClear()
    const { ctx, em } = makeHarness({})
    const replay = await handler().execute(body(), ctx)
    expect(replay).toEqual({ ...first, created: false })
    expect(JSON.stringify(store.tasks)).toBe(before)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
    expect(await handler().buildLog?.({ input: body(), result: replay, ctx, snapshots: {} })).toBeNull()
  })

  it('replays with a stale lock header', async () => {
    seed([makeTask()])
    const first = await reserve({ headers: FRESH_HEADERS })
    const replay = await reserve({ headers: STALE_HEADERS })
    expect(replay.created).toBe(false)
    expect(replay.attemptId).toBe(first.attemptId)
  })

  it('answers 409 idempotency_conflict for the same key with another payload', async () => {
    seed([makeTask()])
    await reserve({ headers: FRESH_HEADERS })
    const error = await catchHttpError(() => reserve({}, body({ baseRevision: otherGitRevision })))
    expectFrozenBody(error, 409, 'idempotency_conflict')
    expect(store.tasks[0].executionAttempts).toHaveLength(1)
  })

  it('matches the published duplicate-key fixture', async () => {
    const fixture = loadNegativeDeliveryFixtures().find((entry) => entry.name === 'reserve.duplicate-key')
    const pair = fixture?.document as { idempotencyKey: string; first: Row; second: Row }
    seed([makeTask()])
    await reserve({ headers: FRESH_HEADERS }, { taskId: TASK_A, idempotencyKey: pair.idempotencyKey, ...pair.first })
    const error = await catchHttpError(() =>
      reserve({ headers: FRESH_HEADERS }, { taskId: TASK_A, idempotencyKey: pair.idempotencyKey, ...pair.second }),
    )
    expectFrozenBody(error, fixture?.expected.status ?? 0, fixture?.expected.code ?? '')
  })

  it('answers 409 attempt_active for a second key while an attempt is active', async () => {
    seed([makeTask()])
    await reserve({ headers: FRESH_HEADERS })
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }, body({ idempotencyKey: 'key-2' })))
    expectFrozenBody(error, 409, 'attempt_active')
  })

  it('answers 409 attempt_limit_reached for the 17th attempt', async () => {
    seed([makeTask()])
    store.tasks[0].executionAttempts = registerWith(MAX_EXECUTION_ATTEMPTS, 'closed')
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }, body({ idempotencyKey: 'key-17' })))
    expectFrozenBody(error, 409, 'attempt_limit_reached')
    expect(store.tasks[0].executionAttempts).toHaveLength(MAX_EXECUTION_ATTEMPTS)
  })

  it('lets reconciliation_required win over the limit and the task status', async () => {
    seed([makeTask({ status: 'blocked', statusReason: 'reconciliation_required' })])
    store.tasks[0].executionAttempts = registerWith(MAX_EXECUTION_ATTEMPTS, 'unknown')
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }, body({ idempotencyKey: 'key-17' })))
    expectFrozenBody(error, 409, 'reconciliation_required')
  })

  it('fails closed on an unreadable register', async () => {
    seed([makeTask({ executionAttempts: [{ attemptId: 'broken' }] as unknown as ExecutionAttempt[] })])
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }))
    expectFrozenBody(error, 409, 'reconciliation_required')
    expect(detailCodes(error)).toEqual(['unreadable_attempt_register'])
  })

  it.each([
    ['draft', 'task_not_ready'],
    ['blocked', 'task_blocked'],
    ['verified', 'task_not_ready'],
  ] as const)('answers 409 task_not_ready for a %s task', async (status, detail) => {
    seed([makeTask({ status })])
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }))
    expectFrozenBody(error, 409, 'task_not_ready')
    expect(detailCodes(error)).toEqual([detail])
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('answers 409 dependency_not_verified until every dependency is verified', async () => {
    seed([makeTask({ dependsOnTaskIds: [TASK_B] }), makeTask({ id: TASK_B, status: 'awaiting_review' })])
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }))
    expectFrozenBody(error, 409, 'dependency_not_verified')
    expect(error.body.details).toEqual([
      { path: `dependsOnTaskIds.${TASK_B}`, code: 'dependency_not_verified', message: 'Dependency is awaiting_review' },
    ])
    store.tasks[1].status = 'verified'
    expect((await reserve({ headers: FRESH_HEADERS })).created).toBe(true)
  })

  it('treats an archived dependency as not verified', async () => {
    seed([makeTask({ dependsOnTaskIds: [TASK_B] }), makeTask({ id: TASK_B, status: 'verified', deletedAt: UPDATED_AT })])
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }))
    expectFrozenBody(error, 409, 'dependency_not_verified')
  })

  it('answers 422 revision_kind_mismatch for a snapshot revision on a git profile', async () => {
    seed([makeTask()])
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }, body({ baseRevision: snapshotRevision })))
    expectFrozenBody(error, 422, 'revision_kind_mismatch')
  })

  it('answers 422 unknown_target_profile for a profile version that does not exist', async () => {
    seed([makeTask({ targetProfileVersion: 99 })])
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }))
    expectFrozenBody(error, 422, 'unknown_target_profile')
  })

  it('answers 422 baseline_not_active when the task baseline was superseded', async () => {
    seed([makeTask()])
    store.projects[0].activeBaselineId = OTHER_BASELINE_ID
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }))
    expectFrozenBody(error, 422, 'baseline_not_active')
  })

  it('answers 422 foreign_reference when the pinned baseline is not in the project', async () => {
    seed([makeTask()], { baselines: [] })
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }))
    expectFrozenBody(error, 422, 'foreign_reference')
  })

  it('starts a correction round from changes_requested within the budget only', async () => {
    seed([makeTask({ status: 'changes_requested' })])
    store.evidence = [makeReview(), makeReview()]
    expect((await reserve({ headers: FRESH_HEADERS })).created).toBe(true)

    seed([makeTask({ status: 'changes_requested' })])
    store.evidence = [makeReview(), makeReview(), makeReview()]
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }))
    expectFrozenBody(error, 409, 'correction_limit_reached')
  })

  describe('optimistic lock on a new key', () => {
    const previous = process.env.OM_OPTIMISTIC_LOCK
    afterEach(() => {
      if (previous === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = previous
    })

    it('answers 428 without the header', async () => {
      seed([makeTask()])
      expectFrozenBody(await catchHttpError(() => reserve({})), 428, 'optimistic_lock_required')
    })

    it('answers 400 for a header that is not a timestamp', async () => {
      seed([makeTask()])
      const error = await catchHttpError(() => reserve({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: 'yesterday' } }))
      expectFrozenBody(error, 400, 'validation_failed')
      expect(detailCodes(error)).toEqual(['optimistic_lock_invalid'])
    })

    it('reports a stale header before an active attempt', async () => {
      seed([makeTask()])
      await reserve({ headers: FRESH_HEADERS })
      const error = await catchHttpError(() => reserve({ headers: STALE_HEADERS }, body({ idempotencyKey: 'key-2' })))
      expect(error.body.code).toBe('optimistic_lock_conflict')
    })

    it('needs no header for an in-process manual hand-off', async () => {
      seed([makeTask()])
      expect((await reserve({ inProcess: true })).created).toBe(true)
    })

    it('answers 409 for a stale header, also with OM_OPTIMISTIC_LOCK=off', async () => {
      process.env.OM_OPTIMISTIC_LOCK = 'off'
      seed([makeTask()])
      const error = await catchHttpError(() => reserve({ headers: STALE_HEADERS }))
      expect(error.status).toBe(409)
      expect(error.body.code).toBe('optimistic_lock_conflict')
      expect(store.tasks[0].executionAttempts).toHaveLength(0)
    })
  })

  describe('execution mode', () => {
    const trustedExecution = issueTrustedExecution(ACTOR_ID)

    it('rejects automatic mode when a request is present, even with the trusted option', async () => {
      seed([makeTask()])
      const error = await catchHttpError(() =>
        reserve({ headers: FRESH_HEADERS }, body({ mode: 'automatic', trustedExecution })),
      )
      expectFrozenBody(error, 403, 'forbidden')
      expect(detailCodes(error)).toEqual(['trusted_execution_required'])
      expect(store.tasks[0].executionAttempts).toHaveLength(0)
    })

    it('rejects automatic mode in-process without the trusted option', async () => {
      seed([makeTask()])
      const error = await catchHttpError(() => reserve({ inProcess: true }, body({ mode: 'automatic' })))
      expectFrozenBody(error, 403, 'forbidden')
    })

    it('rejects the trusted option on a manual hand-off over HTTP', async () => {
      seed([makeTask()])
      const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }, body({ trustedExecution })))
      expectFrozenBody(error, 403, 'forbidden')
    })

    it('rejects the trusted option on a manual hand-off', async () => {
      seed([makeTask()])
      const error = await catchHttpError(() => reserve({ inProcess: true }, body({ trustedExecution })))
      expectFrozenBody(error, 403, 'forbidden')
    })

    it('rejects a trusted option from another source', async () => {
      seed([makeTask()])
      const error = await catchHttpError(() =>
        reserve({ inProcess: true }, body({ mode: 'automatic', trustedExecution: { ...trustedExecution, source: 'route' } })),
      )
      expectFrozenBody(error, 400, 'validation_failed')
    })

    it('rejects a trusted option that was not issued in-process, as a generic command dispatcher would forward it', async () => {
      seed([makeTask()])
      const forged = JSON.parse(JSON.stringify(trustedExecution))
      const error = await catchHttpError(() => reserve({ inProcess: true }, body({ mode: 'automatic', trustedExecution: forged })))
      expectFrozenBody(error, 403, 'forbidden')
      expect(detailCodes(error)).toEqual(['trusted_execution_required'])
      expect(store.tasks[0].executionAttempts).toHaveLength(0)
    })

    it('accepts automatic mode from the trusted in-process executor and stamps the actor', async () => {
      seed([makeTask()])
      const { ctx } = makeHarness({ inProcess: true })
      const input = body({ mode: 'automatic', trustedExecution })
      const result = await handler().execute(input, ctx)
      expect(result.created).toBe(true)
      expect(store.tasks[0].executionAttempts[0].mode).toBe('automatic')
      const log = await handler().buildLog?.({ input, result, ctx, snapshots: {} })
      expect(log).toMatchObject({ actorUserId: ACTOR_ID, resourceId: TASK_A })
    })
  })

  it('answers 400 idempotency_key_required without a key', async () => {
    seed([makeTask()])
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS }, body({ idempotencyKey: undefined })))
    expectFrozenBody(error, 400, 'idempotency_key_required')
  })

  it('answers 404 for a task of another organization', async () => {
    seed([makeTask()])
    const error = await catchHttpError(() => reserve({ headers: FRESH_HEADERS, orgId: FOREIGN_ORG_ID }))
    expectFrozenBody(error, 404, 'not_found')
    expect(store.tasks[0].executionAttempts).toHaveLength(0)
  })

  it('answers 404 for a task of an archived project', async () => {
    seed([makeTask()])
    store.projects[0].deletedAt = UPDATED_AT
    expectFrozenBody(await catchHttpError(() => reserve({ headers: FRESH_HEADERS })), 404, 'not_found')
  })
})

describe('internal attempt commands', () => {
  const trustedExecution = issueTrustedExecution(ACTOR_ID)
  const EVIDENCE_ID = '6b6b6b6b-6666-4666-8666-666666666666'
  const CLAIM = 'delivery_os.attempts.claim'
  const LINK = 'delivery_os.attempts.link_workflow'
  const MARK = 'delivery_os.attempts.mark_delivery'
  const internal = (id: string) => getHandler<AttemptInternalCommandResult>(id)

  function seedReserved(): string {
    seed([makeTask()])
    const register = registerWith(1, 'reserved')
    store.tasks[0] = makeTask({ status: 'executing', attemptNumber: 1, executionAttempts: register })
    return register[0].attemptId
  }

  function acceptedRegister(attemptId: string, workflowRef: string | null): ExecutionAttempt[] {
    const linked = store.tasks[0].executionAttempts.map((attempt) => ({ ...attempt, workflowRef }))
    const recorded = recordAttemptResult(linked, { attemptId, evidenceId: EVIDENCE_ID, externalRunId: 'run-1' })
    if (!recorded.ok) throw new Error('[internal] fixture result failed')
    const closed = closeAttempt(recorded.register, { attemptId, now: NOW })
    if (!closed.ok) throw new Error('[internal] fixture close failed')
    return closed.register
  }

  function run(id: string, input: Row, options: Parameters<typeof makeHarness>[0] = { inProcess: true }) {
    const { ctx } = makeHarness(options)
    return internal(id).execute({ taskId: TASK_A, trustedExecution, ...input }, ctx)
  }

  describe.each([
    [CLAIM, { workerRef: 'worker-1' }],
    [LINK, { workflowRef: 'wf-instance-1' }],
    [MARK, { outcome: 'delivered' }],
  ])('%s trusted context', (id, extra) => {
    it('answers 403 whenever a request is present, before any validation or read', async () => {
      const attemptId = seedReserved()
      const before = JSON.stringify(store.tasks)
      for (const input of [{ attemptId, ...extra }, { attemptId: 'not-a-uuid' }, {}]) {
        const error = await catchHttpError(() => run(id, input, { headers: FRESH_HEADERS }))
        expectFrozenBody(error, 403, 'forbidden')
        expect(detailCodes(error)).toEqual(['trusted_execution_required'])
      }
      expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
      expect(JSON.stringify(store.tasks)).toBe(before)
    })

    it('answers 403 in-process without an issued trusted option, also for a forged copy of a real one', async () => {
      const attemptId = seedReserved()
      const forged = JSON.parse(JSON.stringify(trustedExecution))
      for (const option of [undefined, forged, { ...trustedExecution }, { ...trustedExecution, source: 'route' }, 'delivery_agents']) {
        const error = await catchHttpError(() => run(id, { attemptId, ...extra, trustedExecution: option }))
        expectFrozenBody(error, 403, 'forbidden')
        expect(detailCodes(error)).toEqual(['trusted_execution_required'])
      }
      expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    })

    it('answers 400 for a malformed input from the trusted executor', async () => {
      seedReserved()
      expectFrozenBody(await catchHttpError(() => run(id, { attemptId: 'not-a-uuid', ...extra })), 400, 'validation_failed')
    })

    it('takes the scope from the caller, never from the input', async () => {
      const attemptId = seedReserved()
      const smuggled = { attemptId, ...extra, tenantId: TENANT_ID, organizationId: ORG_ID }
      const error = await catchHttpError(() => run(id, smuggled, { inProcess: true, orgId: FOREIGN_ORG_ID }))
      expectFrozenBody(error, 404, 'not_found')
    })

    it('answers 404 for an attempt that is not on the task and fails closed on an unreadable register', async () => {
      seedReserved()
      const unknown = await catchHttpError(() => run(id, { attemptId: '77777777-7777-4777-8777-999999999999', ...extra }))
      expectFrozenBody(unknown, 404, 'attempt_not_found')
      store.tasks[0].executionAttempts = [{ attemptId: 'broken' }] as unknown as ExecutionAttempt[]
      const unreadable = await catchHttpError(() => run(id, { attemptId: '77777777-7777-4777-8777-999999999999', ...extra }))
      expectFrozenBody(unreadable, 409, 'reconciliation_required')
    })
  })

  describe(CLAIM, () => {
    it('claims once under the task row lock, refreshes the index and emits no domain event', async () => {
      const attemptId = seedReserved()
      const { ctx, em } = makeHarness({ inProcess: true })
      const input = { taskId: TASK_A, attemptId, workerRef: 'worker-1', trustedExecution }
      const result = await internal(CLAIM).execute(input, ctx)

      expect(result).toMatchObject({ taskId: TASK_A, attemptId, changed: true, taskUpdatedAt: UPDATED_AT.toISOString() })
      expect(result.attempt).toMatchObject({ state: 'claimed', workerRef: 'worker-1' })
      expect(store.tasks[0].executionAttempts[0]).toEqual(result.attempt)
      expect(store.tasks[0].status).toBe('executing')
      expect(em.transactional).toHaveBeenCalledTimes(1)
      const lockedReads = mockFindOneWithDecryption.mock.calls
        .filter(([, , , options]) => options?.lockMode === LockMode.PESSIMISTIC_WRITE)
        .map(([, entity]) => entity)
      expect(lockedReads).toEqual([DeliveryTask])
      const dataEngine = ctx.container.resolve('dataEngine') as { markOrmEntityChange: jest.Mock }
      expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(1)
      expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
      const log = await internal(CLAIM).buildLog?.({ input, result, ctx, snapshots: {} })
      expect(log).toMatchObject({ actorUserId: ACTOR_ID, resourceKind: 'delivery_os.task', resourceId: TASK_A, tenantId: TENANT_ID })
    })

    it('lets exactly one of two racing workers win; the winner may repeat its claim', async () => {
      const attemptId = seedReserved()
      const outcomes = await Promise.allSettled([
        run(CLAIM, { attemptId, workerRef: 'worker-1' }),
        run(CLAIM, { attemptId, workerRef: 'worker-2' }),
      ])
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected'])
      const loser = await catchHttpError(() => run(CLAIM, { attemptId, workerRef: 'worker-2' }))
      expectFrozenBody(loser, 409, 'attempt_active')
      expect(store.tasks[0].executionAttempts[0].workerRef).toBe('worker-1')

      const before = JSON.stringify(store.tasks)
      const { ctx } = makeHarness({ inProcess: true })
      const input = { taskId: TASK_A, attemptId, workerRef: 'worker-1', trustedExecution }
      const replay = await internal(CLAIM).execute(input, ctx)
      expect(replay.changed).toBe(false)
      expect(JSON.stringify(store.tasks)).toBe(before)
      expect((ctx.container.resolve('dataEngine') as { markOrmEntityChange: jest.Mock }).markOrmEntityChange).not.toHaveBeenCalled()
      expect(await internal(CLAIM).buildLog?.({ input, result: replay, ctx, snapshots: {} })).toBeNull()
    })

    it('refuses a closed attempt, so a redelivered job never starts the executor again', async () => {
      const attemptId = seedReserved()
      store.tasks[0].executionAttempts = acceptedRegister(attemptId, null)
      const error = await catchHttpError(() => run(CLAIM, { attemptId, workerRef: 'worker-1' }))
      expectFrozenBody(error, 409, 'attempt_closed')
    })
  })

  describe(LINK, () => {
    it('links the workflow, marks the dispatch once and keeps the link immutable', async () => {
      const attemptId = seedReserved()
      const linked = await run(LINK, { attemptId, workflowRef: 'wf-instance-1', workflowStepId: 'wait-for-result' })
      expect(linked.attempt).toMatchObject({ workflowRef: 'wf-instance-1', workflowStepId: 'wait-for-result', dispatchedAt: null })
      const dispatched = await run(LINK, { attemptId, workflowRef: 'wf-instance-1', dispatched: true })
      expect(dispatched.changed).toBe(true)
      expect(dispatched.attempt.dispatchedAt).not.toBeNull()
      const replay = await run(LINK, { attemptId, workflowRef: 'wf-instance-1', workflowStepId: 'wait-for-result', dispatched: true })
      expect(replay.changed).toBe(false)
      expect(replay.attempt).toEqual(dispatched.attempt)

      const other = await catchHttpError(() => run(LINK, { attemptId, workflowRef: 'wf-instance-2' }))
      expectFrozenBody(other, 409, 'attempt_active')
      expect(detailCodes(other)).toEqual(['workflow_link_conflict'])
      expect(store.tasks[0].executionAttempts[0].workflowRef).toBe('wf-instance-1')
    })

    it('refuses a cancelled attempt', async () => {
      const attemptId = seedReserved()
      store.tasks[0].executionAttempts = store.tasks[0].executionAttempts.map((attempt) => ({
        ...attempt,
        state: 'cancel_requested' as const,
        cancellationRequestedAt: NOW,
        stopConfirmation: 'stop_unconfirmed' as const,
      }))
      expectFrozenBody(await catchHttpError(() => run(LINK, { attemptId, workflowRef: 'wf-instance-1' })), 409, 'attempt_cancelled')
    })
  })

  describe(MARK, () => {
    it('records failures and the delivery one after another and is idempotent once delivered', async () => {
      const attemptId = seedReserved()
      store.tasks[0].executionAttempts = acceptedRegister(attemptId, 'wf-instance-1')
      const outcomes = await Promise.all([
        run(MARK, { attemptId, outcome: 'failed', error: 'workflow signal timed out' }),
        run(MARK, { attemptId, outcome: 'failed', error: 'workflow signal timed out again' }),
      ])
      expect(outcomes.map((outcome) => outcome.attempt.deliveryAttempts)).toEqual([1, 2])
      expect(store.tasks[0].executionAttempts[0]).toMatchObject({
        completionDelivery: 'pending',
        lastDeliveryError: 'workflow signal timed out again',
      })

      const delivered = await run(MARK, { attemptId, outcome: 'delivered' })
      expect(delivered.attempt).toMatchObject({ completionDelivery: 'delivered', lastDeliveryError: null, deliveryAttempts: 3 })
      const before = JSON.stringify(store.tasks)
      for (const input of [{ outcome: 'delivered' }, { outcome: 'failed', error: 'late failure' }]) {
        expect((await run(MARK, { attemptId, ...input })).changed).toBe(false)
      }
      expect(JSON.stringify(store.tasks)).toBe(before)
      expect(store.tasks[0].status).toBe('executing')
      expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
    })

    it('answers 409 no_pending_delivery for an OSS-only result and for an attempt without a result', async () => {
      const attemptId = seedReserved()
      const open = await catchHttpError(() => run(MARK, { attemptId, outcome: 'delivered' }))
      expectFrozenBody(open, 409, 'attempt_not_active')
      expect(detailCodes(open)).toEqual(['no_pending_delivery'])
      store.tasks[0].executionAttempts = acceptedRegister(attemptId, null)
      const ossOnly = await catchHttpError(() => run(MARK, { attemptId, outcome: 'delivered' }))
      expect(detailCodes(ossOnly)).toEqual(['no_pending_delivery'])
    })

    it('requires an error text for a failed delivery', async () => {
      const attemptId = seedReserved()
      expectFrozenBody(await catchHttpError(() => run(MARK, { attemptId, outcome: 'failed' })), 400, 'validation_failed')
      expectFrozenBody(await catchHttpError(() => run(MARK, { attemptId, outcome: 'retry' })), 400, 'validation_failed')
    })
  })
})

describe('checkTaskReservable', () => {
  it('accepts a ready task with verified dependencies', () => {
    const result = checkTaskReservable({ status: 'ready', dependsOnTaskIds: [TASK_B] }, [{ id: TASK_B, status: 'verified' }])
    expect(result.ok).toBe(true)
  })

  it('reports a missing dependency', () => {
    const result = checkTaskReservable({ status: 'ready', dependsOnTaskIds: [TASK_B] }, [])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.body.details[0].message).toBe('Dependency is missing')
  })
})
