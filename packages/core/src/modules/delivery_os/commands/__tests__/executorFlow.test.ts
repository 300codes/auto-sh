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
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  DeliveryBaseline,
  DeliveryDecision,
  DeliveryEvidence,
  DeliveryProject,
  DeliveryTask,
} from '../../data/entities'
import { proveAcceptanceCriteria, type AcProofEvidence } from '../../lib/acProof'
import type { BaselineContentV1, ResultManifestV1, SourceRevision, TaskPackageV1 } from '../../lib/contracts'
import { buildResultManifest, deriveFakeResultRevision, loadBaselineContentFixture, loadTaskPackageFixture } from '../../lib/fixtures'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import { createDeliveryOsAttemptQueries } from '../attemptQueries'
import type { AttemptInternalCommandResult, AttemptReserveResult } from '../attempts'
import type { ResultAcceptCommandResult } from '../evidence'
import type { AttemptReconcileResult } from '../reconcile'
import {
  ACTOR_ID,
  ORG_ID,
  TENANT_ID,
  UPDATED_AT,
  catchHttpError,
  detailCodes,
  expectFrozenBody,
  getHandler,
  makeApproval,
  makeAttachmentInspector,
  makeBaseline,
  makeProject,
  matches,
  type EmMock,
  type Row,
} from './baselineTestKit'

const EVIDENCE_EVENT = 'delivery_os.evidence.recorded'
const WORKFLOW_REF = 'wf-instance-7'
const WORKFLOW_STEP_ID = 'wait-for-result'
const WORKER_REF = 'delivery-agents-worker-1'
const V2_BASELINE_ID = '5a5a5a5a-5555-4555-8555-5555555555b2'
const V2_TASK_ID = '66666666-6666-4666-8666-6666666666b2'
const INTEGRATION_REVISION: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }
const trustedExecution = issueTrustedExecution(ACTOR_ID)
const WORKER_ACTOR_ID = '88888888-8888-4888-8888-8888888888aa'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }

type Store = {
  projects: DeliveryProject[]
  tasks: DeliveryTask[]
  baselines: DeliveryBaseline[]
  decisions: DeliveryDecision[]
  evidence: DeliveryEvidence[]
}

type JobOutcome = { outcome: 'executed' | 'skipped'; attemptId: string; skipCode?: string }

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

function makeHarness(options: { signedIn?: boolean } = {}): { ctx: CommandRuntimeContext; em: EmMock } {
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
    auth: { sub: options.signedIn === false ? 'delivery-agents-worker' : ACTOR_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
  return { ctx, em }
}

function makeReadyTask(taskPackage: TaskPackageV1, overrides: Partial<DeliveryTask> = {}): DeliveryTask {
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

function seedReadyTask(): TaskPackageV1 {
  const taskPackage = loadTaskPackageFixture('git')
  const baseline = makeBaseline(loadBaselineContentFixture(), { id: taskPackage.baselineId, projectId: taskPackage.projectId })
  store = {
    projects: [makeProject({ id: taskPackage.projectId, activeBaselineId: baseline.id, repositoryRef: taskPackage.repositoryRef })],
    tasks: [makeReadyTask(taskPackage)],
    baselines: [baseline],
    decisions: [makeApproval(baseline, 'requirements'), makeApproval(baseline, 'design')],
    evidence: [],
  }
  return taskPackage
}

function seedScopeChange(): { taskPackage: TaskPackageV1; v1: DeliveryBaseline; v2: DeliveryBaseline } {
  const taskPackage = seedReadyTask()
  const v1 = store.baselines[0]
  const v2Content: BaselineContentV1 = {
    ...loadBaselineContentFixture(),
    architectureSummary: 'Scope change: the service list also shows opening hours.',
  }
  const v2 = makeBaseline(v2Content, { id: V2_BASELINE_ID, projectId: taskPackage.projectId, version: 2 })
  store.baselines.push(v2)
  store.decisions.push(makeApproval(v2, 'requirements'), makeApproval(v2, 'design'))
  store.projects[0].activeBaselineId = v2.id
  store.tasks[0].status = 'verified'
  store.tasks.push(makeReadyTask(taskPackage, { id: V2_TASK_ID, baselineId: v2.id }))
  return { taskPackage, v1, v2 }
}

function queries() {
  return createDeliveryOsAttemptQueries(makeHarness().em as unknown as EntityManager)
}

const reserveCommand = () => getHandler<AttemptReserveResult>('delivery_os.attempts.reserve')
const internal = (id: string) => getHandler<AttemptInternalCommandResult>(`delivery_os.attempts.${id}`)
const acceptCommand = () => getHandler<ResultAcceptCommandResult>('delivery_os.results.accept')
const reconcileCommand = () => getHandler<AttemptReconcileResult>('delivery_os.attempts.reconcile')

type Executor = jest.Mock<ResultManifestV1, [TaskPackageV1]>

function makeExecutor(build: (taskPackage: TaskPackageV1) => ResultManifestV1 = (taskPackage) => buildResultManifest(taskPackage)): Executor {
  return jest.fn(build)
}

function makeBridge(taskId: string, executor: Executor, options: { baseRevision: TaskPackageV1['baseRevision']; workflowRef?: string | null }) {
  const idempotencyKey = `delivery-agents:${taskId}:1`
  return async function handleJob(): Promise<JobOutcome> {
    const { ctx } = makeHarness()
    const reservation = await reserveCommand().execute(
      { taskId, idempotencyKey, mode: 'automatic', baseRevision: options.baseRevision, trustedExecution },
      ctx,
    )
    const ids = { taskId, attemptId: reservation.attemptId }
    const claimed = await Promise.resolve(internal('claim').execute({ ...ids, workerRef: WORKER_REF, trustedExecution }, ctx)).catch(
      (error: unknown) => error,
    )
    if (claimed instanceof CrudHttpError) return { outcome: 'skipped', attemptId: ids.attemptId, skipCode: String(claimed.body.code) }
    if (claimed instanceof Error) throw claimed
    if (!(claimed as AttemptInternalCommandResult).changed) return { outcome: 'skipped', attemptId: ids.attemptId, skipCode: 'already_claimed' }
    if (options.workflowRef !== null) {
      await internal('link_workflow').execute(
        { ...ids, workflowRef: options.workflowRef ?? WORKFLOW_REF, workflowStepId: WORKFLOW_STEP_ID, dispatched: true, trustedExecution },
        ctx,
      )
    }
    const taskPackage = await queries().buildTaskPackage(SCOPE, taskId, ids.attemptId)
    const manifest = executor(taskPackage)
    await acceptCommand().execute({ ...ids, manifest, source: 'adapter', trustedExecution }, ctx)
    return { outcome: 'executed', attemptId: ids.attemptId }
  }
}

function acceptAgain(taskId: string, attemptId: string, manifest: ResultManifestV1) {
  return acceptCommand().execute({ taskId, attemptId, manifest, source: 'adapter', trustedExecution }, makeHarness().ctx)
}

function markDelivery(taskId: string, attemptId: string, outcome: 'delivered' | 'failed', error?: string) {
  return internal('mark_delivery').execute(
    { taskId, attemptId, outcome, ...(error ? { error } : {}), trustedExecution },
    makeHarness().ctx,
  )
}

function evidenceEvents(): Row[] {
  return mockEmitDeliveryOsEvent.mock.calls.filter(([id]) => id === EVIDENCE_EVENT).map(([, payload]) => payload as Row)
}

function toProofEvidence(rows: readonly DeliveryEvidence[]): AcProofEvidence[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    baselineId: row.baselineId,
    sourceRevision: (row.sourceRevision ?? null) as SourceRevision | null,
    payload: row.payload,
  }))
}

function proofOn(baseline: DeliveryBaseline, revision: SourceRevision, evidence: readonly AcProofEvidence[]) {
  const content = baseline.content as BaselineContentV1
  return proveAcceptanceCriteria({
    acIds: ['AC-001', 'AC-002'],
    acTestMap: content.acTestMap,
    manualChecks: {},
    baselineId: baseline.id,
    revision,
    evidence,
  })
}

function storedAttempt(taskIndex: number = 0) {
  return store.tasks[taskIndex].executionAttempts[0]
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

describe('execution bridge with a fake executor, from a ready task', () => {
  it('runs the executor once across reserve, claim, link, accept, a failed delivery, a replay and the final delivery', async () => {
    const taskPackage = seedReadyTask()
    const executor = makeExecutor()
    const handleJob = makeBridge(taskPackage.taskId, executor, { baseRevision: taskPackage.baseRevision })

    const first = await handleJob()
    expect(first.outcome).toBe('executed')
    expect(executor).toHaveBeenCalledTimes(1)
    const [builtPackage] = executor.mock.calls[0]
    expect(builtPackage).toMatchObject({ taskId: taskPackage.taskId, attemptId: first.attemptId, baselineId: taskPackage.baselineId })
    expect(store.evidence).toHaveLength(1)
    const [evidence] = store.evidence
    expect(evidence).toMatchObject({ kind: 'result_manifest', source: 'adapter', attemptId: first.attemptId, baselineId: taskPackage.baselineId })
    expect(store.tasks[0]).toMatchObject({ status: 'awaiting_review', attemptNumber: 1 })
    expect(storedAttempt()).toMatchObject({
      mode: 'automatic',
      state: 'result_received',
      workerRef: WORKER_REF,
      workflowRef: WORKFLOW_REF,
      workflowStepId: WORKFLOW_STEP_ID,
      resultEvidenceId: evidence.id,
      completionDelivery: 'pending',
      outcome: 'result_accepted',
    })
    const pending = {
      taskId: taskPackage.taskId,
      attemptId: first.attemptId,
      evidenceId: evidence.id,
      workflowRef: WORKFLOW_REF,
      workflowStepId: WORKFLOW_STEP_ID,
    }
    expect(await queries().listPendingDeliveries(SCOPE)).toEqual([pending])

    const failed = await markDelivery(taskPackage.taskId, first.attemptId, 'failed', 'workflow step is not waiting yet')
    expect(failed.changed).toBe(true)
    expect(storedAttempt()).toMatchObject({ completionDelivery: 'pending', lastDeliveryError: 'workflow step is not waiting yet', deliveryAttempts: 1 })
    expect(await queries().listPendingDeliveries(SCOPE)).toEqual([pending])

    mockEmitDeliveryOsEvent.mockClear()
    const beforeReplay = JSON.stringify(store)
    const replay = await acceptAgain(taskPackage.taskId, first.attemptId, executor.mock.results[0].value as ResultManifestV1)
    expect(replay).toMatchObject({ evidenceId: evidence.id, duplicate: true, taskStatus: 'awaiting_review' })
    expect(JSON.stringify(store)).toBe(beforeReplay)
    expect(evidenceEvents()).toEqual([
      expect.objectContaining({ attemptId: first.attemptId, evidenceId: evidence.id, duplicate: true, completionDelivery: 'pending' }),
    ])

    expect(await handleJob()).toMatchObject({ outcome: 'skipped', attemptId: first.attemptId, skipCode: 'attempt_closed' })
    expect(executor).toHaveBeenCalledTimes(1)

    await markDelivery(taskPackage.taskId, first.attemptId, 'delivered')
    expect(storedAttempt()).toMatchObject({ completionDelivery: 'delivered', lastDeliveryError: null, deliveryAttempts: 2 })
    expect(await queries().listPendingDeliveries(SCOPE)).toEqual([])
    expect((await markDelivery(taskPackage.taskId, first.attemptId, 'delivered')).changed).toBe(false)

    mockEmitDeliveryOsEvent.mockClear()
    await acceptAgain(taskPackage.taskId, first.attemptId, executor.mock.results[0].value as ResultManifestV1)
    expect(evidenceEvents()).toEqual([expect.objectContaining({ duplicate: true, completionDelivery: 'delivered' })])

    expect(store.evidence).toHaveLength(1)
    expect(store.tasks[0].executionAttempts).toHaveLength(1)
    expect(executor.mock.calls.length).toBe(1)
  })

  it('refuses the automatic mode without the issued trusted option, so an HTTP caller cannot start the executor', async () => {
    const taskPackage = seedReadyTask()
    const error = await catchHttpError(() =>
      reserveCommand().execute(
        { taskId: taskPackage.taskId, idempotencyKey: 'forged', mode: 'automatic', baseRevision: taskPackage.baseRevision, trustedExecution: { ...trustedExecution } },
        makeHarness().ctx,
      ),
    )
    expectFrozenBody(error, 403, 'forbidden')
    expect(detailCodes(error)).toEqual(['trusted_execution_required'])
    expect(store.tasks[0]).toMatchObject({ status: 'ready', executionAttempts: [] })
  })
})

describe('QA scenario (a): replay of the same manifest', () => {
  it('answers duplicate with the same evidence id, writes nothing and never calls the executor again', async () => {
    const taskPackage = seedReadyTask()
    const executor = makeExecutor()
    const first = await makeBridge(taskPackage.taskId, executor, { baseRevision: taskPackage.baseRevision, workflowRef: null })()
    const manifest = executor.mock.results[0].value as ResultManifestV1
    const before = JSON.stringify(store)

    for (let round = 0; round < 3; round += 1) {
      const replay = await acceptAgain(taskPackage.taskId, first.attemptId, manifest)
      expect(replay).toMatchObject({ evidenceId: store.evidence[0].id, duplicate: true, taskStatus: 'awaiting_review' })
    }
    expect(JSON.stringify(store)).toBe(before)
    expect(executor).toHaveBeenCalledTimes(1)

    const conflict = await catchHttpError(() =>
      acceptAgain(taskPackage.taskId, first.attemptId, { ...manifest, externalRunId: 'another-run' }),
    )
    expectFrozenBody(conflict, 409, 'result_conflict')
    expect(store.evidence).toHaveLength(1)
  })
})

describe('QA scenario (b): a result built for an older baseline after a scope change', () => {
  it('is rejected on the new attempt, writes nothing and gives the new baseline no credit', async () => {
    const { taskPackage, v1, v2 } = seedScopeChange()
    const staleExecutor = makeExecutor((current) => buildResultManifest({ ...current, baselineId: v1.id, baselineHash: v1.contentHash }))
    const error = await catchHttpError(() =>
      makeBridge(V2_TASK_ID, staleExecutor, { baseRevision: taskPackage.baseRevision })(),
    )

    expectFrozenBody(error, 422, 'baseline_mismatch')
    expect(detailCodes(error)).toEqual(['baseline_mismatch', 'baseline_mismatch'])
    expect(staleExecutor).toHaveBeenCalledTimes(1)
    expect(staleExecutor.mock.calls[0][0]).toMatchObject({ baselineId: v2.id, baselineHash: v2.contentHash })
    expect(store.evidence).toEqual([])
    expect(store.tasks[1]).toMatchObject({ status: 'executing', baselineId: v2.id })
    expect(store.tasks[1].executionAttempts[0]).toMatchObject({ state: 'claimed', resultEvidenceId: null, baselineId: v2.id })

    const staleManifest = staleExecutor.mock.results[0].value as ResultManifestV1
    expect(proofOn(v2, staleManifest.resultRevision, toProofEvidence(store.evidence)).map((proof) => proof.status)).toEqual([
      'missing',
      'missing',
    ])
    const staleRow: AcProofEvidence = {
      id: 'evidence-of-v1',
      kind: 'result_manifest',
      baselineId: v1.id,
      sourceRevision: staleManifest.resultRevision,
      payload: staleManifest,
    }
    expect(proofOn(v2, staleManifest.resultRevision, [staleRow]).map((proof) => proof.status)).toEqual(['missing', 'missing'])
    expect(proofOn(v1, staleManifest.resultRevision, [staleRow]).map((proof) => proof.status)).toEqual(['passed', 'passed'])
  })
})

describe('QA scenario (c): unknown after a restart', () => {
  it('lists nothing to run again, reconcile unknown blocks the task, and the executor is never called a second time', async () => {
    const taskPackage = seedReadyTask()
    const crashingExecutor = makeExecutor(() => {
      throw new Error('[internal] worker process killed')
    })
    await expect(makeBridge(taskPackage.taskId, crashingExecutor, { baseRevision: taskPackage.baseRevision })()).rejects.toThrow(
      'worker process killed',
    )
    expect(crashingExecutor).toHaveBeenCalledTimes(1)
    const attemptId = storedAttempt().attemptId
    expect(storedAttempt()).toMatchObject({ state: 'claimed', workerRef: WORKER_REF, workflowRef: WORKFLOW_REF, resultEvidenceId: null })

    const afterRestart = queries()
    expect(await afterRestart.listPendingDeliveries(SCOPE)).toEqual([])
    expect(await afterRestart.getAttempt(SCOPE, taskPackage.taskId, attemptId)).toMatchObject({ state: 'claimed', resultEvidenceId: null })

    const redelivered = makeBridge(taskPackage.taskId, crashingExecutor, { baseRevision: taskPackage.baseRevision })
    expect(await redelivered()).toEqual({ outcome: 'skipped', attemptId, skipCode: 'already_claimed' })
    expect(crashingExecutor).toHaveBeenCalledTimes(1)

    const reconciled = await reconcileCommand().execute(
      {
        taskId: taskPackage.taskId,
        attemptId,
        resolution: 'unknown',
        externalEvidence: { note: 'Worker restarted; no live process for the attempt', observedAt: '2026-09-19T10:05:00.000Z' },
        trustedExecution: issueTrustedExecution(WORKER_ACTOR_ID),
      },
      makeHarness({ signedIn: false }).ctx,
    )
    expect(reconciled).toMatchObject({ resolution: 'unknown', taskStatus: 'blocked', taskStatusReason: 'reconciliation_required' })
    expect(store.tasks[0]).toMatchObject({ status: 'blocked', statusReason: 'reconciliation_required' })
    expect(storedAttempt()).toMatchObject({
      state: 'reconciliation_required',
      closedAt: null,
      reconciliation: expect.objectContaining({ resolution: 'unknown', actorUserId: WORKER_ACTOR_ID }),
    })
    expect(store.tasks[0].executionAttempts).toHaveLength(1)

    expect(await redelivered()).toEqual({ outcome: 'skipped', attemptId, skipCode: 'reconciliation_required' })
    const freshKey = await catchHttpError(() =>
      reserveCommand().execute(
        { taskId: taskPackage.taskId, idempotencyKey: 'after-restart-new-key', mode: 'automatic', baseRevision: taskPackage.baseRevision, trustedExecution },
        makeHarness().ctx,
      ),
    )
    expectFrozenBody(freshKey, 409, 'reconciliation_required')
    expect(await queries().listPendingDeliveries(SCOPE)).toEqual([])
    expect(store.evidence).toEqual([])
    expect(crashingExecutor).toHaveBeenCalledTimes(1)
  })
})

describe('evidence of a task commit is not inherited by another integration revision', () => {
  it('proves the AC on the task result revision and reports missing on integration revision B', async () => {
    const taskPackage = seedReadyTask()
    const executor = makeExecutor()
    const job = await makeBridge(taskPackage.taskId, executor, { baseRevision: taskPackage.baseRevision })()
    const taskRevision = deriveFakeResultRevision({ attemptId: job.attemptId, baseRevision: taskPackage.baseRevision })
    const evidence = toProofEvidence(store.evidence)
    const baseline = store.baselines[0]

    expect(store.evidence[0].sourceRevision).toEqual(taskRevision)
    const onTaskRevision = proofOn(baseline, taskRevision, evidence)
    expect(onTaskRevision.map((proof) => [proof.acId, proof.status, proof.proven])).toEqual([
      ['AC-001', 'passed', true],
      ['AC-002', 'passed', true],
    ])
    expect(onTaskRevision[0].tests[0].evidenceId).toBe(store.evidence[0].id)

    const onIntegration = proofOn(baseline, INTEGRATION_REVISION, evidence)
    expect(onIntegration.map((proof) => [proof.acId, proof.status, proof.proven])).toEqual([
      ['AC-001', 'missing', false],
      ['AC-002', 'missing', false],
    ])
    expect(onIntegration.flatMap((proof) => proof.tests.map((test) => test.evidenceId))).toEqual([null, null])
  })
})
