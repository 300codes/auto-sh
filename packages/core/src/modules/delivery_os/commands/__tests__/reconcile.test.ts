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
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  DeliveryBaseline,
  DeliveryDecision,
  DeliveryEvidence,
  DeliveryProject,
  DeliveryTask,
} from '../../data/entities'
import { closeAttempt, recordAttemptResult, requestCancellation, reserveAttempt } from '../../lib/attempts'
import type { ExecutionAttempt, TaskPackageV1 } from '../../lib/contracts'
import {
  loadBaselineContentFixture,
  loadNegativeDeliveryFixtures,
  loadResultManifestFixture,
  loadTaskPackageFixture,
} from '../../lib/fixtures'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import type { AttemptReserveResult } from '../attempts'
import type { ResultAcceptCommandResult } from '../evidence'
import type { AttemptReconcileResult } from '../reconcile'
import {
  ACTOR_ID,
  FOREIGN_ORG_ID,
  ORG_ID,
  STALE_UPDATED_AT,
  TENANT_ID,
  UPDATED_AT,
  catchHttpError,
  detailCodes,
  getHandler,
  makeApproval,
  makeAttachmentInspector,
  makeBaseline,
  makeProject,
  matches,
  type EmMock,
  type Row,
} from './baselineTestKit'

const NOW = '2026-09-19T10:00:00.000Z'
const OBSERVED_AT = '2026-09-19T09:55:00.000Z'
const EVIDENCE_EVENT = 'delivery_os.evidence.recorded'
const TASK_EVENT = 'delivery_os.task.updated'
const RECONCILE = 'delivery_os.attempts.reconcile'
const DEPENDENT_TASK_ID = '66666666-6666-4666-8666-6666666666dd'
const PREVIOUS_ATTEMPT_ID = '77777777-7777-4777-8777-777777777701'
const UNKNOWN_ATTEMPT_ID = '77777777-7777-4777-8777-999999999999'
const TRUSTED_ACTOR_ID = '88888888-8888-4888-8888-888888888899'
const FRESH_HEADERS = { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() }
const STALE_HEADERS = { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT }

type Store = {
  projects: DeliveryProject[]
  tasks: DeliveryTask[]
  baselines: DeliveryBaseline[]
  decisions: DeliveryDecision[]
  evidence: DeliveryEvidence[]
}

let store: Store

function rowsFor(entity: unknown): Row[] {
  if (entity === DeliveryProject) return store.projects as unknown as Row[]
  if (entity === DeliveryTask) return store.tasks as unknown as Row[]
  if (entity === DeliveryBaseline) return store.baselines as unknown as Row[]
  if (entity === DeliveryDecision) return store.decisions as unknown as Row[]
  if (entity === DeliveryEvidence) return store.evidence as unknown as Row[]
  if (entity === Attachment) return []
  throw new Error('[internal] unexpected entity in test store')
}

function reserved(taskPackage: TaskPackageV1): ExecutionAttempt {
  const result = reserveAttempt([], {
    idempotencyKey: taskPackage.idempotencyKey,
    payload: { mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
    mode: 'manual_handoff',
    baselineId: taskPackage.baselineId,
    baselineHash: taskPackage.baselineHash,
    baseRevision: taskPackage.baseRevision,
    now: NOW,
    newAttemptId: taskPackage.attemptId,
  })
  if (!result.ok) throw new Error('[internal] fixture reservation failed')
  return result.attempt
}

function cancelRequested(attempt: ExecutionAttempt): ExecutionAttempt {
  const result = requestCancellation([attempt], { attemptId: attempt.attemptId, now: NOW })
  if (!result.ok) throw new Error('[internal] fixture cancellation failed')
  return result.attempt
}

function accepted(attempt: ExecutionAttempt): ExecutionAttempt {
  const recorded = recordAttemptResult([attempt], {
    attemptId: attempt.attemptId,
    evidenceId: '99999999-9999-4999-8999-9999999999e1',
    externalRunId: 'run-previous',
  })
  if (!recorded.ok) throw new Error('[internal] fixture result failed')
  const closed = closeAttempt(recorded.register, { attemptId: attempt.attemptId, now: NOW })
  if (!closed.ok) throw new Error('[internal] fixture close failed')
  return closed.attempt
}

function makeTask(taskPackage: TaskPackageV1, overrides: Partial<DeliveryTask> = {}): DeliveryTask {
  return {
    id: taskPackage.taskId,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: taskPackage.projectId,
    baselineId: taskPackage.baselineId,
    title: taskPackage.title,
    description: taskPackage.description ?? null,
    acIds: taskPackage.acceptanceCriteria.map((criterion) => criterion.id),
    dependsOnTaskIds: [],
    allowedPaths: taskPackage.allowedPaths,
    targetProfileId: taskPackage.targetProfileId,
    targetProfileVersion: taskPackage.targetProfileVersion,
    status: 'executing',
    statusReason: null,
    attemptNumber: 1,
    executionAttempts: [reserved(taskPackage)],
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryTask
}

function seed(options: { task?: Partial<DeliveryTask>; approved?: boolean; withDependent?: boolean } = {}): TaskPackageV1 {
  const taskPackage = loadTaskPackageFixture('git')
  const baseline = makeBaseline(loadBaselineContentFixture(), { id: taskPackage.baselineId, projectId: taskPackage.projectId })
  const tasks = [makeTask(taskPackage, options.task)]
  if (options.withDependent) {
    tasks.push(
      makeTask(taskPackage, {
        id: DEPENDENT_TASK_ID,
        status: 'ready',
        attemptNumber: 0,
        executionAttempts: [],
        dependsOnTaskIds: [taskPackage.taskId],
      }),
    )
  }
  store = {
    projects: [makeProject({ id: taskPackage.projectId, activeBaselineId: taskPackage.baselineId, repositoryRef: taskPackage.repositoryRef })],
    tasks,
    baselines: [baseline],
    decisions: options.approved === false ? [] : [makeApproval(baseline, 'requirements'), makeApproval(baseline, 'design')],
    evidence: [],
  }
  return taskPackage
}

function makeHarness(options: { headers?: Record<string, string>; orgId?: string; inProcess?: boolean; sub?: string } = {}) {
  const em: EmMock = {
    fork: jest.fn(),
    create: jest.fn((_entity: unknown, data: Row) => ({ createdAt: UPDATED_AT, ...data })),
    persist: jest.fn((row: Row) => {
      store.evidence.push(row as unknown as DeliveryEvidence)
    }),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => work(em))
  const services: Record<string, unknown> = {
    em,
    dataEngine: { markOrmEntityChange: jest.fn() },
    deliveryOsAttachmentInspector: makeAttachmentInspector(() => []),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name in services) return services[name]
      throw new Error(`[internal] ${name} is not registered`)
    }),
  }
  const ctx: CommandRuntimeContext = {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: options.sub ?? ACTOR_ID, tenantId: TENANT_ID, orgId: options.orgId ?? ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    ...(options.inProcess
      ? {}
      : { request: new Request('http://localhost/api/delivery_os/tasks', { method: 'POST', headers: options.headers ?? FRESH_HEADERS }) }),
  }
  return { ctx, em, container }
}

const handler = () => getHandler<AttemptReconcileResult>(RECONCILE)

function input(taskPackage: TaskPackageV1, resolution: string, overrides: Row = {}): Row {
  return {
    taskId: taskPackage.taskId,
    attemptId: taskPackage.attemptId,
    resolution,
    externalEvidence: { note: 'Checked the runner host', observedAt: OBSERVED_AT },
    ...overrides,
  }
}

function reconcile(payload: Row, options: Parameters<typeof makeHarness>[0] = {}) {
  const { ctx } = makeHarness(options)
  return handler().execute(payload, ctx)
}

function emittedIds(): string[] {
  return mockEmitDeliveryOsEvent.mock.calls.map(([id]) => id as string)
}

function negative(name: string): unknown {
  const fixture = loadNegativeDeliveryFixtures().find((entry) => entry.name === name)
  if (!fixture) throw new Error(`[internal] missing negative fixture ${name}`)
  return fixture.document
}

function storedAttempt(index: number = 0): ExecutionAttempt {
  return store.tasks[0].executionAttempts[index] as ExecutionAttempt
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

describe('delivery_os.attempts.reconcile', () => {
  it.each([
    ['not_started', 'not_started', null],
    ['stopped', 'stopped', 'stopped'],
  ] as const)('%s closes the attempt and returns the task to ready', async (resolution, outcome, stopConfirmation) => {
    const taskPackage = seed()
    const result = await reconcile(input(taskPackage, resolution, { externalEvidence: { note: ' No process on the host ', observedAt: OBSERVED_AT, externalRunId: 'run-42' } }))

    expect(result).toMatchObject({
      taskId: taskPackage.taskId,
      attemptId: taskPackage.attemptId,
      resolution,
      taskStatus: 'ready',
      taskStatusReason: null,
      propagatedTaskIds: [],
    })
    expect(result.evidenceId).toBeUndefined()
    expect(store.tasks[0]).toMatchObject({ status: 'ready', statusReason: null })
    expect(storedAttempt()).toMatchObject({
      state: 'closed',
      outcome,
      stopConfirmation,
      externalRunId: 'run-42',
      reconciliation: { resolution, note: 'No process on the host', observedAt: OBSERVED_AT, actorUserId: ACTOR_ID },
    })
    expect(Date.parse(storedAttempt().closedAt ?? '')).not.toBeNaN()
    expect(store.evidence).toHaveLength(0)
    expect(emittedIds()).toEqual([TASK_EVENT])
  })

  it('closes a cancel_requested attempt as cancelled', async () => {
    const taskPackage = seed()
    store.tasks[0].executionAttempts = [cancelRequested(reserved(taskPackage))]
    await reconcile(input(taskPackage, 'stopped'))
    expect(storedAttempt()).toMatchObject({ state: 'closed', outcome: 'cancelled', stopConfirmation: 'stopped' })
    expect(store.tasks[0].status).toBe('ready')
  })

  it('returns a correction round to changes_requested, without the ready gate', async () => {
    const taskPackage = seed({ approved: false })
    const previous = accepted({ ...reserved(taskPackage), attemptId: PREVIOUS_ATTEMPT_ID, idempotencyKey: 'previous-key' })
    store.tasks[0].executionAttempts = [previous, reserved(taskPackage)]
    const result = await reconcile(input(taskPackage, 'not_started'))
    expect(result.taskStatus).toBe('changes_requested')
    expect(store.tasks[0]).toMatchObject({ status: 'changes_requested', statusReason: null })
    expect(storedAttempt(0)).toEqual(previous)
    expect(storedAttempt(1)).toMatchObject({ state: 'closed', outcome: 'not_started' })
  })

  it('still closes the attempt when the ready gate fails: the task lands in blocked and blocks its dependants', async () => {
    const taskPackage = seed({ approved: false, withDependent: true })
    const result = await reconcile(input(taskPackage, 'stopped'))
    expect(result).toMatchObject({ taskStatus: 'blocked', taskStatusReason: null, propagatedTaskIds: [DEPENDENT_TASK_ID] })
    expect(storedAttempt()).toMatchObject({ state: 'closed', outcome: 'stopped' })
    expect(store.tasks[1]).toMatchObject({ status: 'blocked', statusReason: 'dependency_blocked' })
    expect(emittedIds()).toEqual([TASK_EVENT, TASK_EVENT])
  })

  it('marks the release as dependency_blocked when an ancestor is blocked, so a later unblock revives the task', async () => {
    const taskPackage = seed()
    store.tasks[0].dependsOnTaskIds = [DEPENDENT_TASK_ID]
    store.tasks.push(makeTask(taskPackage, { id: DEPENDENT_TASK_ID, status: 'blocked', attemptNumber: 0, executionAttempts: [] }))
    const result = await reconcile(input(taskPackage, 'not_started'))
    expect(result).toMatchObject({ taskStatus: 'blocked', taskStatusReason: 'dependency_blocked' })
    expect(storedAttempt()).toMatchObject({ state: 'closed', outcome: 'not_started' })
  })

  it('completed after unknown frees the dependants that the unknown attempt had blocked', async () => {
    const taskPackage = seed({ withDependent: true })
    await reconcile(input(taskPackage, 'unknown'))
    expect(store.tasks[1]).toMatchObject({ status: 'blocked', statusReason: 'dependency_blocked' })
    mockEmitDeliveryOsEvent.mockClear()
    const result = await reconcile(input(taskPackage, 'completed', { manifest: loadResultManifestFixture('git') }))
    expect(result).toMatchObject({ taskStatus: 'awaiting_review', propagatedTaskIds: [DEPENDENT_TASK_ID] })
    expect(store.tasks[1]).toMatchObject({ status: 'draft', statusReason: null })
    expect(emittedIds().sort()).toEqual([EVIDENCE_EVENT, TASK_EVENT, TASK_EVENT])
  })

  it('unknown blocks the task with reconciliation_required, blocks dependants and restarts nothing', async () => {
    const taskPackage = seed({ withDependent: true })
    const { ctx, container, em } = makeHarness()
    const result = await handler().execute(input(taskPackage, 'unknown'), ctx)

    expect(result).toMatchObject({
      resolution: 'unknown',
      taskStatus: 'blocked',
      taskStatusReason: 'reconciliation_required',
      propagatedTaskIds: [DEPENDENT_TASK_ID],
    })
    expect(store.tasks[0]).toMatchObject({ status: 'blocked', statusReason: 'reconciliation_required' })
    expect(store.tasks[0].executionAttempts).toHaveLength(1)
    expect(storedAttempt()).toMatchObject({ state: 'reconciliation_required', closedAt: null, outcome: null })
    expect(em.create).not.toHaveBeenCalled()
    expect(emittedIds().every((id) => id === TASK_EVENT)).toBe(true)
    const resolvedKeys = container.resolve.mock.calls.map(([name]) => name)
    expect(resolvedKeys.filter((name) => /commandBus|queue|workflow|executor|dispatch/i.test(name))).toEqual([])
  })

  it('an unknown attempt blocks a new reservation and archiving until it is reconciled again', async () => {
    const taskPackage = seed()
    await reconcile(input(taskPackage, 'unknown'))

    const reserveError = await catchHttpError(() =>
      getHandler<AttemptReserveResult>('delivery_os.attempts.reserve').execute(
        { taskId: taskPackage.taskId, idempotencyKey: 'another-key', mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
        makeHarness().ctx,
      ),
    )
    expect(reserveError.status).toBe(409)
    expect(reserveError.body.code).toBe('reconciliation_required')

    const archiveError = await catchHttpError(() =>
      getHandler<unknown>('delivery_os.tasks.delete').execute({ id: taskPackage.taskId }, makeHarness().ctx),
    )
    expect(archiveError.status).toBe(409)
    expect(archiveError.body.code).toBe('reconciliation_required')

    const released = await reconcile(input(taskPackage, 'stopped'))
    expect(released.taskStatus).toBe('ready')
    expect(store.tasks[0]).toMatchObject({ status: 'ready', statusReason: null })
    expect(storedAttempt()).toMatchObject({ state: 'closed', outcome: 'stopped' })
  })

  it('releasing an unknown attempt moves dependency-blocked dependants back to draft', async () => {
    const taskPackage = seed({ withDependent: true })
    await reconcile(input(taskPackage, 'unknown'))
    const result = await reconcile(input(taskPackage, 'not_started'))
    expect(result.propagatedTaskIds).toEqual([DEPENDENT_TASK_ID])
    expect(store.tasks[1]).toMatchObject({ status: 'draft', statusReason: null })
  })

  it('completed needs the manifest', async () => {
    const taskPackage = seed()
    const before = JSON.stringify(store)
    const error = await catchHttpError(() => reconcile(input(taskPackage, 'completed')))
    expect(error.status).toBe(422)
    expect(error.body.code).toBe('manifest_required')
    expect(JSON.stringify(store)).toBe(before)
  })

  it.each([
    ['reserved', (attempt: ExecutionAttempt) => attempt],
    ['cancel_requested', cancelRequested],
  ] as const)('completed on a %s attempt accepts the manifest like the result import and awaits review', async (_state, prepare) => {
    const taskPackage = seed()
    store.tasks[0].executionAttempts = [prepare(reserved(taskPackage))]
    const result = await reconcile(input(taskPackage, 'completed', { manifest: loadResultManifestFixture('git') }))

    const [evidence] = store.evidence
    expect(store.evidence).toHaveLength(1)
    expect(result).toMatchObject({ resolution: 'completed', taskStatus: 'awaiting_review', evidenceId: evidence.id })
    expect(result.taskStatus).not.toBe('verified')
    expect(evidence).toMatchObject({ kind: 'result_manifest', source: 'manual', attemptId: taskPackage.attemptId, recordedBy: ACTOR_ID })
    expect(store.tasks[0]).toMatchObject({ status: 'awaiting_review', statusReason: null })
    expect(storedAttempt()).toMatchObject({
      state: 'result_received',
      outcome: 'result_accepted',
      resultEvidenceId: evidence.id,
      reconciliation: { resolution: 'completed', actorUserId: ACTOR_ID },
    })
    expect(emittedIds().sort()).toEqual([EVIDENCE_EVENT, TASK_EVENT])
  })

  it('completed after unknown accepts the manifest and leaves blocked for awaiting_review', async () => {
    const taskPackage = seed()
    await reconcile(input(taskPackage, 'unknown'))
    const result = await reconcile(input(taskPackage, 'completed', { manifest: loadResultManifestFixture('git') }))
    expect(result.taskStatus).toBe('awaiting_review')
    expect(store.tasks[0]).toMatchObject({ status: 'awaiting_review', statusReason: null })
  })

  it('completed with a foreign manifest answers the same code as the result import and writes nothing', async () => {
    const taskPackage = seed()
    const manifest = negative('result-manifest.foreign-task')
    const before = JSON.stringify(store)
    const viaReconcile = await catchHttpError(() => reconcile(input(taskPackage, 'completed', { manifest })))
    expect(JSON.stringify(store)).toBe(before)
    expect(emittedIds()).toEqual([])

    const viaImport = await catchHttpError(() =>
      getHandler<ResultAcceptCommandResult>('delivery_os.results.accept').execute(
        { taskId: taskPackage.taskId, attemptId: taskPackage.attemptId, manifest, source: 'manual' },
        makeHarness().ctx,
      ),
    )
    expect(viaReconcile.status).toBe(viaImport.status)
    expect(viaReconcile.body.code).toBe(viaImport.body.code)
    expect(detailCodes(viaReconcile)).toEqual(detailCodes(viaImport))
  })

  it('refuses an attempt that already has a result or is closed', async () => {
    const taskPackage = seed()
    store.tasks[0].executionAttempts = [accepted(reserved(taskPackage))]
    store.tasks[0].status = 'awaiting_review'
    const before = JSON.stringify(store)
    const error = await catchHttpError(() => reconcile(input(taskPackage, 'stopped')))
    expect(error.status).toBe(409)
    expect(error.body.code).toBe('attempt_not_reconcilable')
    expect(JSON.stringify(store)).toBe(before)

    await reconcile(input(seed(), 'not_started'))
    const again = await catchHttpError(() => reconcile(input(taskPackage, 'not_started')))
    expect(again.body.code).toBe('attempt_not_reconcilable')
  })

  it('answers 404 for an unknown attempt and for a foreign scope', async () => {
    const taskPackage = seed()
    const unknownAttempt = await catchHttpError(() => reconcile(input(taskPackage, 'stopped', { attemptId: UNKNOWN_ATTEMPT_ID })))
    expect(unknownAttempt.status).toBe(404)
    expect(unknownAttempt.body.code).toBe('attempt_not_found')

    const before = JSON.stringify(store)
    const foreign = await catchHttpError(() => reconcile(input(taskPackage, 'stopped'), { orgId: FOREIGN_ORG_ID }))
    expect(foreign.status).toBe(404)
    expect(foreign.body.code).toBe('not_found')
    expect(JSON.stringify(store)).toBe(before)
  })

  it('requires the task version and refuses a stale one before any domain answer', async () => {
    const taskPackage = seed()
    const before = JSON.stringify(store)
    const missing = await catchHttpError(() => reconcile(input(taskPackage, 'stopped'), { headers: {} }))
    expect(missing.status).toBe(428)

    const stale = await catchHttpError(() =>
      reconcile(input(taskPackage, 'stopped', { attemptId: UNKNOWN_ATTEMPT_ID }), { headers: STALE_HEADERS }),
    )
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('optimistic_lock_conflict')
    expect(JSON.stringify(store)).toBe(before)
  })

  it('locks the project and then the project tasks inside one transaction', async () => {
    const taskPackage = seed()
    const { ctx, em } = makeHarness()
    await handler().execute(input(taskPackage, 'not_started'), ctx)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    const lockedOne = mockFindOneWithDecryption.mock.calls
      .filter(([, , , options]) => options?.lockMode === LockMode.PESSIMISTIC_WRITE)
      .map(([, entity]) => entity)
    const lockedMany = mockFindWithDecryption.mock.calls
      .filter(([, , , options]) => options?.lockMode === LockMode.PESSIMISTIC_WRITE)
      .map(([, entity]) => entity)
    expect(lockedOne).toEqual([DeliveryProject])
    expect(lockedMany).toEqual([DeliveryTask])
  })

  it('lets the trusted in-process executor mark an attempt unknown after a restart, without a version header', async () => {
    const taskPackage = seed()
    const result = await reconcile(
      input(taskPackage, 'unknown', { trustedExecution: issueTrustedExecution(TRUSTED_ACTOR_ID) }),
      { inProcess: true, sub: 'system:delivery-agents' },
    )
    expect(result.taskStatusReason).toBe('reconciliation_required')
    expect(storedAttempt().reconciliation).toMatchObject({ resolution: 'unknown', actorUserId: TRUSTED_ACTOR_ID })
  })

  it('refuses a caller without a user id, also with a forged trusted option over HTTP', async () => {
    const taskPackage = seed()
    const forged = { source: 'delivery_agents', actorUserId: TRUSTED_ACTOR_ID }
    for (const options of [{ sub: 'api-key' }, { sub: 'api-key', inProcess: true }]) {
      const error = await catchHttpError(() => reconcile(input(taskPackage, 'unknown', { trustedExecution: forged }), options))
      expect(error.status).toBe(403)
      expect(detailCodes(error)).toEqual(['actor_required'])
    }
    const overHttp = await catchHttpError(() =>
      reconcile(input(taskPackage, 'unknown', { trustedExecution: issueTrustedExecution(TRUSTED_ACTOR_ID) }), { sub: 'api-key' }),
    )
    expect(overHttp.status).toBe(403)
  })

  it('writes one audit entry on the task with the external evidence', async () => {
    const taskPackage = seed()
    const { ctx } = makeHarness()
    const payload = input(taskPackage, 'unknown')
    const result = await handler().execute(payload, ctx)
    const log = await handler().buildLog?.({ input: payload, result, ctx, snapshots: {} } as never)
    expect(log).toMatchObject({
      actionLabel: 'Reconcile execution attempt',
      resourceKind: 'delivery_os.task',
      resourceId: taskPackage.taskId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      snapshotAfter: { resolution: 'unknown', taskStatus: 'blocked', externalEvidence: { note: 'Checked the runner host', observedAt: OBSERVED_AT } },
    })
  })
})
