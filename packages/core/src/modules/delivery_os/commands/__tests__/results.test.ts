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
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DeliveryBaseline, DeliveryEvidence, DeliveryProject, DeliveryTask } from '../../data/entities'
import { reconcileAttempt, requestCancellation, reserveAttempt } from '../../lib/attempts'
import { hashBaseline } from '../../lib/baseline'
import {
  DELIVERY_SCHEMA_VERSIONS,
  type BaselineContentV1,
  type ExecutionAttempt,
  type TaskPackageV1,
} from '../../lib/contracts'
import {
  loadBaselineContentFixture,
  loadNegativeDeliveryFixtures,
  loadResultManifestFixture,
  loadTaskPackageFixture,
} from '../../lib/fixtures'
import { hashCanonical } from '../../lib/hash'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import { createDeliveryOsAttemptQueries } from '../attemptQueries'
import type { AttemptInternalCommandResult, AttemptReserveResult } from '../attempts'
import type { ResultAcceptCommandResult } from '../evidence'
import {
  ACTOR_ID,
  FOREIGN_ORG_ID,
  ORG_ID,
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

const NOW = '2026-09-19T10:00:00.000Z'
const EVIDENCE_EVENT = 'delivery_os.evidence.recorded'
const TASK_EVENT = 'delivery_os.task.updated'
const trustedExecution = issueTrustedExecution(ACTOR_ID)

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

function reserved(taskPackage: TaskPackageV1, overrides: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
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
  return { ...result.attempt, ...overrides }
}

function cancelled(attempt: ExecutionAttempt): ExecutionAttempt {
  const result = requestCancellation([attempt], { attemptId: attempt.attemptId, now: NOW })
  if (!result.ok) throw new Error('[internal] fixture cancellation failed')
  return result.attempt
}

function reconciled(attempt: ExecutionAttempt, resolution: 'completed' | 'unknown'): ExecutionAttempt {
  const result = reconcileAttempt([attempt], {
    attemptId: attempt.attemptId,
    resolution,
    note: 'Checked the runner',
    observedAt: NOW,
    actorUserId: ACTOR_ID,
    now: NOW,
  })
  if (!result.ok) throw new Error('[internal] fixture reconciliation failed')
  return result.attempt
}

function makeTask(taskPackage: TaskPackageV1, attempt: ExecutionAttempt, overrides: Partial<DeliveryTask> = {}): DeliveryTask {
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
    executionAttempts: [attempt],
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryTask
}

function seedGit(options: { attempt?: Partial<ExecutionAttempt> | ExecutionAttempt; task?: Partial<DeliveryTask> } = {}): TaskPackageV1 {
  const taskPackage = loadTaskPackageFixture('git')
  const attempt = { ...reserved(taskPackage), ...options.attempt }
  store = {
    projects: [makeProject({ id: taskPackage.projectId, activeBaselineId: taskPackage.baselineId, repositoryRef: taskPackage.repositoryRef })],
    tasks: [makeTask(taskPackage, attempt, options.task)],
    baselines: [makeBaseline(loadBaselineContentFixture(), { id: taskPackage.baselineId, projectId: taskPackage.projectId })],
    evidence: [],
  }
  return taskPackage
}

function seedSnapshot(): { taskPackage: TaskPackageV1; manifest: Row } {
  const published = loadTaskPackageFixture('snapshot')
  const content: BaselineContentV1 = {
    ...loadBaselineContentFixture(),
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
    requirements: published.requirements,
    acceptanceCriteria: published.acceptanceCriteria,
    screens: published.designArtifactRefs,
    acTestMap: published.validationProfile.requiredTests,
    manualChecks: {},
  }
  const taskPackage = { ...published, baselineHash: hashBaseline(content) }
  store = {
    projects: [makeProject({ id: taskPackage.projectId, activeBaselineId: taskPackage.baselineId })],
    tasks: [makeTask(taskPackage, reserved(taskPackage))],
    baselines: [makeBaseline(content, { id: taskPackage.baselineId, projectId: taskPackage.projectId })],
    evidence: [],
  }
  return { taskPackage, manifest: { ...loadResultManifestFixture('snapshot'), baselineHash: taskPackage.baselineHash } }
}

function makeHarness(options: { orgId?: string; inProcess?: boolean; sub?: string } = {}) {
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
  const services: Record<string, unknown> = { em, dataEngine: { markOrmEntityChange: jest.fn() } }
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
      : { request: new Request('http://localhost/api/delivery_os/tasks/results', { method: 'POST' }) }),
  }
  return { ctx, em }
}

const handler = () => getHandler<ResultAcceptCommandResult>('delivery_os.results.accept')

function input(taskPackage: TaskPackageV1, overrides: Row = {}): Row {
  return {
    taskId: taskPackage.taskId,
    attemptId: taskPackage.attemptId,
    manifest: loadResultManifestFixture('git'),
    source: 'manual',
    ...overrides,
  }
}

function accept(payload: Row, options: Parameters<typeof makeHarness>[0] = {}) {
  const { ctx } = makeHarness(options)
  return handler().execute(payload, ctx)
}

function emitted(eventId: string): Row[] {
  return mockEmitDeliveryOsEvent.mock.calls.filter(([id]) => id === eventId).map(([, payload]) => payload as Row)
}

function negative(name: string): unknown {
  const fixture = loadNegativeDeliveryFixtures().find((entry) => entry.name === name)
  if (!fixture) throw new Error(`[internal] missing negative fixture ${name}`)
  return fixture.document
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

describe('delivery_os.results.accept', () => {
  it('accepts the published manifest: one evidence row, awaiting_review, no pending delivery without a workflow', async () => {
    const taskPackage = seedGit()
    const result = await accept(input(taskPackage))
    const [task] = store.tasks
    const [evidence] = store.evidence

    expect(store.evidence).toHaveLength(1)
    expect(result).toEqual({
      evidenceId: evidence.id,
      duplicate: false,
      taskStatus: 'awaiting_review',
      taskUpdatedAt: UPDATED_AT.toISOString(),
    })
    expect(evidence).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: taskPackage.projectId,
      baselineId: taskPackage.baselineId,
      taskId: taskPackage.taskId,
      attemptId: taskPackage.attemptId,
      kind: 'result_manifest',
      source: 'manual',
      payloadHash: hashCanonical(loadResultManifestFixture('git')),
      sourceRevision: loadResultManifestFixture('git').resultRevision,
      recordedBy: ACTOR_ID,
    })
    expect(task.status).toBe('awaiting_review')
    expect(task.executionAttempts[0]).toMatchObject({
      state: 'result_received',
      resultEvidenceId: evidence.id,
      completionDelivery: null,
      externalRunId: loadResultManifestFixture('git').externalRunId,
      outcome: 'result_accepted',
    })
    expect(Date.parse(task.executionAttempts[0].closedAt ?? '')).not.toBeNaN()
    expect(emitted(EVIDENCE_EVENT)).toEqual([
      expect.objectContaining({ evidenceId: evidence.id, duplicate: false, completionDelivery: null, tenantId: TENANT_ID, organizationId: ORG_ID }),
    ])
    expect(emitted(TASK_EVENT)).toEqual([expect.objectContaining({ taskId: taskPackage.taskId, status: 'awaiting_review' })])
    expect(mockEmitDeliveryOsEvent.mock.calls[0][2]).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('locks only the task row, inside one transaction, and reads before it writes', async () => {
    const taskPackage = seedGit()
    const { ctx, em } = makeHarness()
    await handler().execute(input(taskPackage), ctx)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    const lockedReads = mockFindOneWithDecryption.mock.calls
      .filter(([, , , options]) => options?.lockMode === LockMode.PESSIMISTIC_WRITE)
      .map(([, entity]) => entity)
    expect(lockedReads).toEqual([DeliveryTask])
    const lastRead = Math.max(...mockFindOneWithDecryption.mock.invocationCallOrder)
    expect(em.create.mock.invocationCallOrder[0]).toBeGreaterThan(lastRead)
  })

  it('sets the pending delivery only when the attempt is linked to a workflow', async () => {
    const taskPackage = seedGit({ attempt: { workflowRef: 'wf-instance-1', workflowStepId: 'wait-for-result' } })
    await accept(input(taskPackage, { source: 'adapter', trustedExecution }), { inProcess: true })
    expect(store.tasks[0].executionAttempts[0]).toMatchObject({ completionDelivery: 'pending', outcome: 'result_accepted' })
    expect(store.tasks[0].executionAttempts[0].closedAt).not.toBeNull()
    expect(store.evidence[0].source).toBe('adapter')
    expect(emitted(EVIDENCE_EVENT)[0]).toMatchObject({ duplicate: false, completionDelivery: 'pending' })
  })

  it('replays the identical manifest as a duplicate: no new row, no status change, event re-emitted', async () => {
    const taskPackage = seedGit({ attempt: { workflowRef: 'wf-instance-1', workflowStepId: 'wait-for-result' } })
    const first = await accept(input(taskPackage))
    const before = JSON.stringify(store)
    mockEmitDeliveryOsEvent.mockClear()
    const { ctx, em } = makeHarness()
    const replay = await handler().execute(input(taskPackage), ctx)

    expect(replay).toEqual({ ...first, duplicate: true })
    expect(JSON.stringify(store)).toBe(before)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(emitted(EVIDENCE_EVENT)).toEqual([
      expect.objectContaining({ evidenceId: first.evidenceId, duplicate: true, completionDelivery: 'pending' }),
    ])
    expect(emitted(TASK_EVENT)).toEqual([])
    const log = await handler().buildLog?.({ input: input(taskPackage), result: replay, ctx, snapshots: {} } as never)
    expect(log).toBeNull()
  })

  describe('execution bridge flow with a fake executor', () => {
    const WORKFLOW_REF = 'wf-instance-1'
    const internal = (id: string) => getHandler<AttemptInternalCommandResult>(`delivery_os.attempts.${id}`)

    function makeBridge(taskPackage: TaskPackageV1, executor: jest.Mock, options: { workflowRef: string | null }) {
      const ids = { taskId: taskPackage.taskId, attemptId: taskPackage.attemptId }
      return async function handleJob(): Promise<'executed' | 'skipped'> {
        const { ctx } = makeHarness({ inProcess: true })
        const reservation = await getHandler<AttemptReserveResult>('delivery_os.attempts.reserve').execute(
          { taskId: ids.taskId, idempotencyKey: taskPackage.idempotencyKey, mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
          ctx,
        )
        expect(reservation).toMatchObject({ created: false, attemptId: ids.attemptId })
        const claim = await Promise.resolve(internal('claim').execute({ ...ids, workerRef: 'worker-1', trustedExecution }, ctx)).catch(
          (error: unknown) => error,
        )
        if (claim instanceof CrudHttpError) {
          expectFrozenBody(claim, 409, 'attempt_closed')
          return 'skipped'
        }
        if (claim instanceof Error) throw claim
        if (options.workflowRef) {
          await internal('link_workflow').execute(
            { ...ids, workflowRef: options.workflowRef, workflowStepId: 'wait-for-result', dispatched: true, trustedExecution },
            ctx,
          )
        }
        const manifest = executor()
        await handler().execute({ ...ids, manifest, source: 'adapter', trustedExecution }, ctx)
        return 'executed'
      }
    }

    function pendingDeliveries() {
      const { em } = makeHarness({ inProcess: true })
      return createDeliveryOsAttemptQueries(em as unknown as EntityManager).listPendingDeliveries({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })
    }

    it('runs the executor once across reserve, claim, a redelivered job and a duplicate accept, then delivers', async () => {
      const taskPackage = seedGit()
      const executor = jest.fn(() => loadResultManifestFixture('git'))
      const handleJob = makeBridge(taskPackage, executor, { workflowRef: WORKFLOW_REF })

      expect(await handleJob()).toBe('executed')
      expect(await handleJob()).toBe('skipped')
      expect(executor).toHaveBeenCalledTimes(1)
      expect(store.evidence).toHaveLength(1)
      expect(store.tasks[0].executionAttempts[0]).toMatchObject({
        state: 'result_received',
        workerRef: 'worker-1',
        workflowRef: WORKFLOW_REF,
        completionDelivery: 'pending',
        outcome: 'result_accepted',
      })
      const expectedPending = {
        taskId: taskPackage.taskId,
        attemptId: taskPackage.attemptId,
        evidenceId: store.evidence[0].id,
        workflowRef: WORKFLOW_REF,
        workflowStepId: 'wait-for-result',
      }
      expect(await pendingDeliveries()).toEqual([expectedPending])

      mockEmitDeliveryOsEvent.mockClear()
      const beforeReplay = JSON.stringify(store)
      const replay = await accept(input(taskPackage, { source: 'adapter', trustedExecution }), { inProcess: true })
      expect(replay.duplicate).toBe(true)
      expect(JSON.stringify(store)).toBe(beforeReplay)
      expect(emitted(EVIDENCE_EVENT)).toEqual([
        expect.objectContaining({ attemptId: taskPackage.attemptId, evidenceId: store.evidence[0].id, duplicate: true, completionDelivery: 'pending' }),
      ])
      expect(executor).toHaveBeenCalledTimes(1)

      const { ctx } = makeHarness({ inProcess: true })
      const ids = { taskId: taskPackage.taskId, attemptId: taskPackage.attemptId, trustedExecution }
      await internal('mark_delivery').execute({ ...ids, outcome: 'failed', error: 'step not waiting yet' }, ctx)
      expect(await pendingDeliveries()).toEqual([expectedPending])
      await internal('mark_delivery').execute({ ...ids, outcome: 'delivered' }, ctx)
      expect(await pendingDeliveries()).toEqual([])

      mockEmitDeliveryOsEvent.mockClear()
      await accept(input(taskPackage, { source: 'adapter', trustedExecution }), { inProcess: true })
      expect(emitted(EVIDENCE_EVENT)).toEqual([expect.objectContaining({ duplicate: true, completionDelivery: 'delivered' })])
      expect(store.evidence).toHaveLength(1)
      expect(executor).toHaveBeenCalledTimes(1)
    })

    it('needs no delivery for an OSS-only attempt', async () => {
      const taskPackage = seedGit()
      const executor = jest.fn(() => loadResultManifestFixture('git'))
      expect(await makeBridge(taskPackage, executor, { workflowRef: null })()).toBe('executed')
      expect(store.tasks[0].executionAttempts[0]).toMatchObject({ completionDelivery: null, outcome: 'result_accepted' })
      expect(await pendingDeliveries()).toEqual([])
      const { ctx } = makeHarness({ inProcess: true })
      const error = await catchHttpError(() =>
        internal('mark_delivery').execute(
          { taskId: taskPackage.taskId, attemptId: taskPackage.attemptId, outcome: 'delivered', trustedExecution },
          ctx,
        ),
      )
      expectFrozenBody(error, 409, 'attempt_not_active')
      expect(detailCodes(error)).toEqual(['no_pending_delivery'])
    })
  })

  it('writes an audit entry for an accepted result', async () => {
    const taskPackage = seedGit()
    const { ctx } = makeHarness()
    const result = await handler().execute(input(taskPackage), ctx)
    const log = await handler().buildLog?.({ input: input(taskPackage), result, ctx, snapshots: {} } as never)
    expect(log).toMatchObject({
      resourceKind: 'delivery_os.evidence',
      resourceId: result.evidenceId,
      parentResourceKind: 'delivery_os.task',
      parentResourceId: taskPackage.taskId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('answers 409 result_conflict for different content on the same attempt', async () => {
    const taskPackage = seedGit()
    await accept(input(taskPackage))
    const manifest = { ...loadResultManifestFixture('git'), externalRunId: 'another-run' }
    const error = await catchHttpError(() => accept(input(taskPackage, { manifest })))
    expectFrozenBody(error, 409, 'result_conflict')
    expect(store.evidence).toHaveLength(1)
    expect(emitted(EVIDENCE_EVENT)).toHaveLength(1)
  })

  it('still answers duplicate after the attempt was closed', async () => {
    const taskPackage = seedGit()
    const first = await accept(input(taskPackage))
    const [received] = store.tasks[0].executionAttempts
    store.tasks[0].executionAttempts = [{ ...received, state: 'closed', closedAt: NOW, outcome: 'result_accepted' }]
    store.tasks[0].status = 'verified'
    const replay = await accept(input(taskPackage))
    expect(replay).toMatchObject({ evidenceId: first.evidenceId, duplicate: true, taskStatus: 'verified' })
    expect(store.evidence).toHaveLength(1)
  })

  it.each([
    ['a wrong baseline hash', { baselineHash: 'f'.repeat(64) }, 'baseline_mismatch'],
    ['a wrong base commit', { baseRevision: { kind: 'git', commitSha: 'b'.repeat(40) }, baseCommit: 'b'.repeat(40) }, 'base_revision_mismatch'],
    ['another project', { projectId: '0a0a0a0a-0000-4000-8000-00000000000a' }, 'correlation_mismatch'],
  ])('rejects %s with its own code and writes nothing', async (_label, patch, code) => {
    const taskPackage = seedGit()
    const manifest = { ...loadResultManifestFixture('git'), ...patch }
    const error = await catchHttpError(() => accept(input(taskPackage, { manifest })))
    expectFrozenBody(error, 422, code)
    expect(store.evidence).toHaveLength(0)
    expect(store.tasks[0].status).toBe('executing')
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('rejects the published foreign-attempt manifest with correlation_mismatch', async () => {
    const taskPackage = seedGit()
    const error = await catchHttpError(() => accept(input(taskPackage, { manifest: negative('result-manifest.foreign-attempt') })))
    expectFrozenBody(error, 422, 'correlation_mismatch')
    expect(error.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'attemptId' })]))
  })

  it('answers 404 attempt_not_found for an attempt id that is not on the task', async () => {
    const taskPackage = seedGit()
    const error = await catchHttpError(() => accept(input(taskPackage, { attemptId: '0a0a0a0a-0000-4000-8000-00000000000a' })))
    expectFrozenBody(error, 404, 'attempt_not_found')
  })

  it('rejects an unknown schemaVersion', async () => {
    const taskPackage = seedGit()
    const manifest = { ...loadResultManifestFixture('git'), schemaVersion: 'delivery.result-manifest/v2' }
    expectFrozenBody(await catchHttpError(() => accept(input(taskPackage, { manifest }))), 422, 'unsupported_schema_version')
  })

  it('rejects a late result for a cancelled attempt and one with an unknown run', async () => {
    const taskPackage = seedGit()
    store.tasks[0].executionAttempts = [cancelled(reserved(taskPackage))]
    expectFrozenBody(await catchHttpError(() => accept(input(taskPackage))), 409, 'attempt_cancelled')
    store.tasks[0].executionAttempts = [reconciled(reserved(taskPackage), 'unknown')]
    expectFrozenBody(await catchHttpError(() => accept(input(taskPackage))), 409, 'reconciliation_required')
    expect(store.evidence).toHaveLength(0)
  })

  it('accepts a result after a completed reconciliation and moves the blocked task to awaiting_review, never verified', async () => {
    const taskPackage = seedGit({ task: { status: 'blocked', statusReason: 'reconciliation_required' } })
    store.tasks[0].executionAttempts = [reconciled(reconciled(reserved(taskPackage), 'unknown'), 'completed')]
    const result = await accept(input(taskPackage))
    expect(result.taskStatus).toBe('awaiting_review')
    expect(store.tasks[0].statusReason).toBeNull()
  })

  it('refuses to move a cancelled task', async () => {
    const taskPackage = seedGit({ task: { status: 'cancelled' } })
    expectFrozenBody(await catchHttpError(() => accept(input(taskPackage))), 409, 'invalid_transition')
    expect(store.evidence).toHaveLength(0)
  })

  it('rejects a snapshot revision for react-vite', async () => {
    const taskPackage = seedGit()
    const error = await catchHttpError(() => accept(input(taskPackage, { manifest: negative('result-manifest.snapshot-for-react') })))
    expectFrozenBody(error, 422, 'revision_kind_mismatch')
  })

  it('accepts a snapshot revision for wordpress-theme', async () => {
    const { taskPackage, manifest } = seedSnapshot()
    const result = await accept(input(taskPackage, { manifest }))
    expect(result).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
    expect(store.evidence[0].sourceRevision).toMatchObject({ kind: 'snapshot' })
    expect(store.tasks[0].executionAttempts[0].baseCommit).toBeNull()
  })

  it('ignores tenant and organization values inside the manifest', async () => {
    const taskPackage = seedGit()
    const manifest = { ...loadResultManifestFixture('git'), tenantId: FOREIGN_ORG_ID, organizationId: FOREIGN_ORG_ID }
    const first = await accept(input(taskPackage, { manifest }))
    expect(store.evidence[0]).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
    expect('tenantId' in store.evidence[0].payload).toBe(false)
    const replay = await accept(input(taskPackage))
    expect(replay).toMatchObject({ evidenceId: first.evidenceId, duplicate: true })
  })

  it('answers 404 for a task in another organization', async () => {
    const taskPackage = seedGit()
    const error = await catchHttpError(() => accept(input(taskPackage), { orgId: FOREIGN_ORG_ID }))
    expectFrozenBody(error, 404, 'not_found')
    expect(store.evidence).toHaveLength(0)
  })

  it('rejects source adapter over HTTP and an unknown source', async () => {
    const taskPackage = seedGit()
    const forbidden = await catchHttpError(() => accept(input(taskPackage, { source: 'adapter' })))
    expectFrozenBody(forbidden, 403, 'forbidden')
    expect(detailCodes(forbidden)).toEqual(['trusted_execution_required'])
    expectFrozenBody(await catchHttpError(() => accept(input(taskPackage, { source: 'agent' }))), 400, 'validation_failed')
    const overHttp = await catchHttpError(() => accept(input(taskPackage, { source: 'adapter', trustedExecution })))
    expectFrozenBody(overHttp, 403, 'forbidden')
  })

  it('rejects source adapter in-process without an issued trusted option, as a generic command dispatcher would call it', async () => {
    const taskPackage = seedGit()
    const forged = JSON.parse(JSON.stringify(trustedExecution))
    for (const option of [undefined, forged]) {
      const error = await catchHttpError(() =>
        accept(input(taskPackage, { source: 'adapter', trustedExecution: option }), { inProcess: true }),
      )
      expectFrozenBody(error, 403, 'forbidden')
      expect(detailCodes(error)).toEqual(['trusted_execution_required'])
    }
    expect(store.evidence).toHaveLength(0)
  })

  it('stores no recordedBy for a caller without a user id', async () => {
    const taskPackage = seedGit()
    await accept(input(taskPackage), { sub: 'api-key:exec-bridge' })
    expect(store.evidence[0].recordedBy).toBeNull()
  })

  it('fails closed on an unreadable attempt register', async () => {
    const taskPackage = seedGit()
    store.tasks[0].executionAttempts = [{ attemptId: 'broken' }] as unknown as ExecutionAttempt[]
    const error = await catchHttpError(() => accept(input(taskPackage)))
    expectFrozenBody(error, 409, 'reconciliation_required')
    expect(detailCodes(error)).toEqual(['unreadable_attempt_register'])
  })

  describe('unique-violation race', () => {
    function loseRaceTo(taskPackage: TaskPackageV1, winnerManifest: unknown) {
      const { ctx, em } = makeHarness()
      em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => {
        const snapshot = JSON.stringify(store.tasks)
        await work(em)
        store.tasks = JSON.parse(snapshot, (key, value) => (key === 'updatedAt' || key === 'createdAt' ? new Date(value) : value))
        store.tasks[0].status = 'awaiting_review'
        store.tasks[0].executionAttempts = [
          { ...reserved(taskPackage), state: 'result_received', resultEvidenceId: WINNER_ID, workflowRef: 'wf-instance-1', completionDelivery: 'pending' },
        ]
        store.evidence = [
          {
            id: WINNER_ID,
            tenantId: TENANT_ID,
            organizationId: ORG_ID,
            taskId: taskPackage.taskId,
            attemptId: taskPackage.attemptId,
            kind: 'result_manifest',
            payloadHash: hashCanonical(winnerManifest),
          } as unknown as DeliveryEvidence,
        ]
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: 'delivery_evidence_result_manifest_uq',
        })
      })
      return ctx
    }
    const WINNER_ID = '7c7c7c7c-7777-4777-8777-777777777777'

    it('recovers the loser as a duplicate of the committed result', async () => {
      const taskPackage = seedGit()
      const ctx = loseRaceTo(taskPackage, loadResultManifestFixture('git'))
      const result = await handler().execute(input(taskPackage), ctx)
      expect(result).toMatchObject({ evidenceId: WINNER_ID, duplicate: true, taskStatus: 'awaiting_review' })
      expect(store.evidence).toHaveLength(1)
      expect(emitted(EVIDENCE_EVENT)).toEqual([expect.objectContaining({ evidenceId: WINNER_ID, duplicate: true, completionDelivery: 'pending' })])
      expect(emitted(TASK_EVENT)).toEqual([])
    })

    it('rethrows a unique violation of another constraint and one without a committed result', async () => {
      const taskPackage = seedGit()
      const { ctx, em } = makeHarness()
      const otherConstraint = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'delivery_evidence_pkey' })
      em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => {
        await work(em)
        throw otherConstraint
      })
      await expect(handler().execute(input(taskPackage), ctx)).rejects.toBe(otherConstraint)

      const noWinner = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'delivery_evidence_result_manifest_uq' })
      em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => {
        await work(em)
        store.evidence = []
        throw noWinner
      })
      await expect(handler().execute(input(taskPackage), ctx)).rejects.toBe(noWinner)
      expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
    })

    it('answers result_conflict when the committed result has other content', async () => {
      const taskPackage = seedGit()
      const ctx = loseRaceTo(taskPackage, { ...loadResultManifestFixture('git'), externalRunId: 'winner-run' })
      expectFrozenBody(await catchHttpError(() => handler().execute(input(taskPackage), ctx)), 409, 'result_conflict')
      expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
    })
  })
})
