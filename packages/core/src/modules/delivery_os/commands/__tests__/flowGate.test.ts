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
import type { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  DeliveryEvidence,
  DeliveryFlowStageArtifact,
  DeliveryFlowStageDecision,
  DeliveryProject,
  DeliveryTask,
} from '../../data/entities'
import { reserveAttempt } from '../../lib/attempts'
import {
  FLOW_APPROVAL_STAGE_ORDER,
  FLOW_GATE_DETAIL_CODES,
  deliveryErrorBodySchema,
  type ExecutionAttempt,
  type FlowStageId,
  type SourceRevision,
} from '../../lib/contracts'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import type { AttemptReconcileResult, AttemptReserveResult } from '../attempts'
import type { DecisionCommandResult } from '../decisions'
import { createDeliveryOsReportQueries } from '../reportQueries'
import type { TaskCommandResult } from '../tasks'
import {
  ACTOR_ID,
  BASELINE_ID,
  catchHttpError,
  emptyStore,
  getHandler,
  makeApproval,
  makeBaseline,
  makeHarness,
  makeProject,
  matches,
  ORG_ID,
  PROJECT_ID,
  rowsFor,
  TENANT_ID,
  UPDATED_AT,
  type Row,
  type Store,
} from './baselineTestKit'

type GateStore = Store & { stageArtifacts: Row[]; stageDecisions: Row[]; evidence: Row[] }

const DRAFT_TASK_ID = '66666666-6666-4666-8666-6666666666a1'
const READY_TASK_ID = '66666666-6666-4666-8666-6666666666b2'
const ATTEMPT_ID = '77777777-7777-4777-8777-777777777771'
const NOW = '2026-09-19T10:00:00.000Z'
const RAW_HASH = 'd'.repeat(64)
const REVISION: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
const profile = TARGET_PROFILES[0]
const trustedExecution = issueTrustedExecution(ACTOR_ID)

const updateTask = getHandler<TaskCommandResult>('delivery_os.tasks.update')
const reserve = getHandler<AttemptReserveResult>('delivery_os.attempts.reserve')
const reconcile = getHandler<AttemptReconcileResult>('delivery_os.attempts.reconcile')
const record = getHandler<DecisionCommandResult>('delivery_os.decisions.record')

let store: GateStore
let queriedEntities: unknown[]
let evidenceSeq = 0
let stageSeq = 0

function rows(entity: unknown): Row[] {
  if (entity === DeliveryFlowStageArtifact) return store.stageArtifacts
  if (entity === DeliveryFlowStageDecision) return store.stageDecisions
  if (entity === DeliveryEvidence) return store.evidence
  return rowsFor(store, entity)
}

function pinnedProject(overrides: Partial<DeliveryProject> = {}): DeliveryProject {
  return makeProject({
    activeBaselineId: BASELINE_ID,
    flowTemplateId: DEFAULT_FLOW_TEMPLATE.templateId,
    flowTemplateVersion: DEFAULT_FLOW_TEMPLATE.version,
    flowTemplateHash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE),
    flowTemplateSnapshot: DEFAULT_FLOW_TEMPLATE,
    flowPinnedAt: UPDATED_AT,
    ...overrides,
  })
}

function makeTask(id: string, status: 'draft' | 'ready' | 'executing', overrides: Partial<DeliveryTask> = {}): DeliveryTask {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    title: 'Service list',
    description: null,
    acIds: ['AC-001'],
    dependsOnTaskIds: [],
    allowedPaths: ['src/services'],
    targetProfileId: profile.id,
    targetProfileVersion: profile.version,
    status,
    statusReason: null,
    attemptNumber: 0,
    executionAttempts: [],
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryTask
}

function reservedRegister(): ExecutionAttempt[] {
  const result = reserveAttempt([], {
    idempotencyKey: 'seed-key',
    payload: { mode: 'manual_handoff', baseRevision: REVISION },
    mode: 'manual_handoff',
    baselineId: BASELINE_ID,
    baselineHash: store.baselines[0].contentHash,
    baseRevision: REVISION,
    now: NOW,
    newAttemptId: ATTEMPT_ID,
  })
  if (!result.ok) throw new Error('[internal] fixture reservation failed')
  return result.register
}

function evidenceRow(kind: string, payload: unknown): Row {
  evidenceSeq += 1
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(evidenceSeq).padStart(12, '0')}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: null,
    kind,
    sourceRevision: REVISION,
    payload,
    rawReportHash: RAW_HASH,
    createdAt: new Date(Date.UTC(2026, 8, 19, 10, 0, evidenceSeq)),
  }
}

function greenEvidence(): Row[] {
  const content = store.baselines[0].content as { acTestMap: Record<string, string[]> }
  const check = (testId: string) => ({ checkId: 'unit-tests', testId, status: 'passed', sourceRevision: REVISION, acIds: [], rawReportHash: RAW_HASH })
  return [
    evidenceRow('test', { rawReportHash: RAW_HASH, checks: [check(content.acTestMap['AC-001'][0]), check(content.acTestMap['AC-002'][0])] }),
    evidenceRow('scan', { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: RAW_HASH }),
  ]
}

type StageRef = { artifactId: string; version: number; contentHash: string }

function artifactRow(stageId: FlowStageId, version: number, upstream: { stageId: FlowStageId; ref: StageRef } | null): StageRef {
  stageSeq += 1
  const artifactId = `${String(stageSeq).padStart(8, '0')}-aaaa-4aaa-8aaa-000000000000`
  const contentHash = `${stageId}-v${version}`.padEnd(64, '0')
  store.stageArtifacts.push({
    id: artifactId,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    stageId,
    version,
    contentHash,
    dependsOn: upstream ? [{ stageId: upstream.stageId, ...upstream.ref }] : [],
    createdAt: UPDATED_AT,
  })
  return { artifactId, version, contentHash }
}

function approvalRow(stageId: FlowStageId, ref: StageRef, clientApproverName: string | null): void {
  stageSeq += 1
  store.stageDecisions.push({
    id: `${String(stageSeq).padStart(8, '0')}-dddd-4ddd-8ddd-000000000000`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    stageId,
    artifactId: ref.artifactId,
    subjectHash: ref.contentHash,
    subjectVersion: ref.version,
    verdict: 'approved',
    decidedAt: new Date(Date.UTC(2026, 8, 19, 9, 30, stageSeq)),
    clientApproverName,
  })
}

/** Seeds the four stages in order and approves every stage up to (excluding) `pendingFrom`. */
function seedStages(pendingFrom: FlowStageId | 'none'): Record<FlowStageId, StageRef> {
  const refs = {} as Record<FlowStageId, StageRef>
  let upstream: { stageId: FlowStageId; ref: StageRef } | null = null
  for (const stageId of FLOW_APPROVAL_STAGE_ORDER) {
    const ref = artifactRow(stageId, 1, upstream)
    refs[stageId] = ref
    if (stageId === pendingFrom) break
    const templateStage = DEFAULT_FLOW_TEMPLATE.stages.find((stage) => stage.kind === stageId)
    approvalRow(stageId, ref, templateStage?.requiresClientApproval ? 'Anna Client' : null)
    upstream = { stageId, ref }
  }
  return refs
}

function projectLock(): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: store.projects[0].updatedAt.toISOString() }
}

function taskLock(): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() }
}

function runReady(): Promise<TaskCommandResult> {
  const { ctx } = makeHarness(store)
  return Promise.resolve(updateTask.execute({ id: DRAFT_TASK_ID, status: 'ready' }, ctx))
}

function runManualReserve(idempotencyKey = 'manual-key'): Promise<AttemptReserveResult> {
  const { ctx } = makeHarness(store, { headers: taskLock() })
  return Promise.resolve(reserve.execute({ taskId: READY_TASK_ID, idempotencyKey, mode: 'manual_handoff', baseRevision: REVISION }, ctx))
}

function runAutomaticReserve(idempotencyKey = 'automatic-key'): Promise<AttemptReserveResult> {
  const { ctx } = makeHarness(store)
  const inProcess = { ...ctx, request: undefined }
  return Promise.resolve(reserve.execute({ taskId: READY_TASK_ID, idempotencyKey, mode: 'automatic', baseRevision: REVISION, trustedExecution }, inProcess))
}

function runDeploy(overrides: Row = {}): Promise<DecisionCommandResult> {
  const reportQueries = createDeliveryOsReportQueries(makeHarness(store).em as never)
  const { ctx } = makeHarness(store, { headers: projectLock(), services: { deliveryOsReportQueries: reportQueries } })
  return Promise.resolve(
    record.execute({ kind: 'deploy', projectId: PROJECT_ID, baselineId: BASELINE_ID, sourceRevision: REVISION, verdict: 'approved', ...overrides }, ctx),
  )
}

function runReconcileNotStarted(): Promise<AttemptReconcileResult> {
  const { ctx } = makeHarness(store)
  const inProcess = { ...ctx, request: undefined }
  return Promise.resolve(
    reconcile.execute(
      { taskId: READY_TASK_ID, attemptId: ATTEMPT_ID, resolution: 'not_started', externalEvidence: { note: 'No process on the host', observedAt: NOW } },
      inProcess,
    ),
  )
}

function stageDetails(error: CrudHttpError): Array<{ path: string; code: string; message?: string }> {
  return error.body.details as Array<{ path: string; code: string; message?: string }>
}

function expectGateRefusal(error: CrudHttpError, expected: Partial<Record<FlowStageId, string>>): void {
  expect(error.status).toBe(422)
  expect(deliveryErrorBodySchema.safeParse(error.body).success).toBe(true)
  expect(error.body.code).toBe('baseline_not_approved')
  const details = stageDetails(error)
  expect(details.length).toBeGreaterThan(0)
  for (const detail of details) {
    expect(detail.path).toMatch(/^stages\.(scope|ux|key_visual|design_system_ui)$/)
    expect(FLOW_GATE_DETAIL_CODES).toContain(detail.code)
    expect(typeof detail.message).toBe('string')
  }
  const byStage = Object.fromEntries(details.map((detail) => [detail.path.replace('stages.', ''), detail.code]))
  expect(byStage).toEqual(expected)
}

async function expectAllFourRefused(expected: Partial<Record<FlowStageId, string>>): Promise<void> {
  expectGateRefusal(await catchHttpError(runReady), expected)
  expectGateRefusal(await catchHttpError(() => runManualReserve()), expected)
  expectGateRefusal(await catchHttpError(() => runAutomaticReserve()), expected)
  expectGateRefusal(await catchHttpError(() => runDeploy()), expected)
  expect(store.tasks[0].status).toBe('draft')
  expect(store.tasks[1].status).toBe('ready')
  expect(store.tasks[1].executionAttempts).toHaveLength(0)
  expect(store.decisions.filter((decision) => decision.kind === 'deploy')).toHaveLength(0)
  expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
}

beforeEach(() => {
  evidenceSeq = 0
  stageSeq = 0
  queriedEntities = []
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).find((row) => matches(row, where)) ?? null)
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => {
    queriedEntities.push(entity)
    return rows(entity).filter((row) => matches(row, where))
  })
  const baseline = makeBaseline()
  store = {
    ...emptyStore(),
    projects: [pinnedProject()],
    baselines: [baseline],
    decisions: [makeApproval(baseline, 'requirements'), makeApproval(baseline, 'design')],
    tasks: [makeTask(DRAFT_TASK_ID, 'draft'), makeTask(READY_TASK_ID, 'ready')],
    stageArtifacts: [],
    stageDecisions: [],
    evidence: [],
  }
  store.evidence = greenEvidence()
})

describe('flow gate on the v1 dispatch and publish paths (C21, UA-48)', () => {
  it('refuses ready, manual reserve, automatic reserve and deploy while UX is pending and later stages are missing', async () => {
    seedStages('ux')
    await expectAllFourRefused({ ux: 'stage_not_approved', key_visual: 'stage_not_approved', design_system_ui: 'stage_not_approved' })
  })

  it('lets the v1 flow proceed once all four stages are approved and current', async () => {
    seedStages('none')
    const ready = await runReady()
    expect(ready.status).toBe('ready')
    expect(store.tasks[0].status).toBe('ready')

    const manual = await runManualReserve()
    expect(manual.created).toBe(true)
    expect(store.tasks[1].status).toBe('executing')
    expect(store.tasks[1].executionAttempts[0]).toMatchObject({ mode: 'manual_handoff' })

    store.tasks[1] = makeTask(READY_TASK_ID, 'ready')
    const automatic = await runAutomaticReserve()
    expect(automatic.created).toBe(true)
    expect(store.tasks[1].executionAttempts[0]).toMatchObject({ mode: 'automatic' })

    const deploy = await runDeploy()
    expect(deploy).toMatchObject({ kind: 'deploy', verdict: 'approved', baselineId: BASELINE_ID })
    expect(store.decisions.filter((decision) => decision.kind === 'deploy')).toHaveLength(1)
  })

  it('refuses again after a new Scope version: scope pending, every dependant stale', async () => {
    seedStages('none')
    artifactRow('scope', 2, null)
    await expectAllFourRefused({
      scope: 'stage_not_approved',
      ux: 'stage_dependency_stale',
      key_visual: 'stage_dependency_stale',
      design_system_ui: 'stage_dependency_stale',
    })
  })

  it('reconciles a not-started attempt on a gated project into blocked instead of ready', async () => {
    seedStages('ux')
    store.tasks[1] = makeTask(READY_TASK_ID, 'executing', { attemptNumber: 1, executionAttempts: reservedRegister() })
    const result = await runReconcileNotStarted()
    expect(result.taskStatus).toBe('blocked')
    expect(store.tasks[1]).toMatchObject({ status: 'blocked', statusReason: null })
    expect(store.tasks[1].executionAttempts[0]).toMatchObject({ state: 'closed', outcome: 'not_started' })
  })

  it('records a rejected deploy verdict without consulting the gate', async () => {
    seedStages('ux')
    const rejected = await runDeploy({ verdict: 'rejected', reason: 'Preview shows a broken layout' })
    expect(rejected).toMatchObject({ kind: 'deploy', verdict: 'rejected' })
    expect(store.decisions.filter((decision) => decision.kind === 'deploy')).toHaveLength(1)
  })

  it('fails closed when the pinned snapshot is unreadable', async () => {
    store.projects[0] = pinnedProject({ flowTemplateSnapshot: null })
    seedStages('none')
    const error = await catchHttpError(runReady)
    expectGateRefusal(error, {
      scope: 'stage_not_approved',
      ux: 'stage_not_approved',
      key_visual: 'stage_not_approved',
      design_system_ui: 'stage_not_approved',
    })
    expect(stageDetails(error).map((detail) => detail.message)).toEqual(FLOW_APPROVAL_STAGE_ORDER.map((stageId) => `Stage ${stageId} is missing (pinned template snapshot is unreadable)`))
  })

  it('skips the gate without any stage query for an unpinned project', async () => {
    store.projects[0] = makeProject({ activeBaselineId: BASELINE_ID, flowTemplateId: null, flowTemplateSnapshot: null })
    const ready = await runReady()
    expect(ready.status).toBe('ready')
    expect((await runManualReserve()).created).toBe(true)
    expect((await runDeploy()).verdict).toBe('approved')
    expect(queriedEntities).not.toContain(DeliveryFlowStageArtifact)
    expect(queriedEntities).not.toContain(DeliveryFlowStageDecision)
  })
})
