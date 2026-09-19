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
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  DeliveryEvidence,
  DeliveryFlowStageArtifact,
  DeliveryFlowStageDecision,
  type DeliveryProject,
  type DeliveryTask,
} from '../../data/entities'
import type { SourceRevision } from '../../lib/contracts'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import type { AttemptReserveResult } from '../attempts'
import type { DecisionCommandResult } from '../decisions'
import { createDeliveryOsReportQueries } from '../reportQueries'
import type { TaskCommandResult } from '../tasks'
import {
  ACTOR_ID,
  BASELINE_ID,
  ORG_ID,
  PROJECT_ID,
  TENANT_ID,
  UPDATED_AT,
  catchHttpError,
  detailCodes,
  emptyStore,
  expectFrozenBody,
  getHandler,
  makeApproval,
  makeBaseline,
  makeHarness,
  makeProject,
  matches,
  rowsFor,
  type Row,
  type Store,
} from './baselineTestKit'

const TASK_ID = 'f1f1f1f1-0808-4808-8808-0808080808aa'
const REVISION: SourceRevision = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const RAW_HASH = 'f'.repeat(64)
const FRESH_HEADERS = { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() }
const STAGE_ENTITIES = [DeliveryFlowStageArtifact, DeliveryFlowStageDecision]
const profile = TARGET_PROFILES[0]

type RegressionStore = Store & { evidence: Row[] }

let store: RegressionStore
let queriedEntities: unknown[]
let evidenceSeq = 0

const updateTask = () => getHandler<TaskCommandResult>('delivery_os.tasks.update')
const reserve = () => getHandler<AttemptReserveResult>('delivery_os.attempts.reserve')
const recordDecision = () => getHandler<DecisionCommandResult>('delivery_os.decisions.record')

function rows(entity: unknown): Row[] {
  if (entity === DeliveryEvidence) return store.evidence
  if (STAGE_ENTITIES.includes(entity as never)) return []
  return rowsFor(store, entity)
}

function makeTask(status: DeliveryTask['status']): DeliveryTask {
  return {
    id: TASK_ID,
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
  } as DeliveryTask
}

function seed(options: { tasks?: DeliveryTask[]; withDesign?: boolean; project?: Partial<DeliveryProject> } = {}): void {
  const baseline = makeBaseline()
  const approvals = [makeApproval(baseline, 'requirements')]
  if (options.withDesign ?? true) approvals.push(makeApproval(baseline, 'design'))
  store = {
    ...emptyStore(),
    projects: [makeProject({ activeBaselineId: BASELINE_ID, ...options.project })],
    baselines: [baseline],
    decisions: approvals,
    tasks: options.tasks ?? [makeTask('draft')],
    evidence: [],
  }
}

function evidenceRow(kind: string, payload: unknown): Row {
  evidenceSeq += 1
  return {
    id: `f1f1f1f1-0808-4808-8808-${String(evidenceSeq).padStart(12, '0')}`,
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

function reserveBody(overrides: Row = {}): Row {
  return { taskId: TASK_ID, idempotencyKey: 'flow-08-key', mode: 'manual_handoff', baseRevision: REVISION, ...overrides }
}

function deploy(overrides: Row = {}): Promise<DecisionCommandResult> {
  const reportQueries = createDeliveryOsReportQueries(makeHarness(store).em as never)
  const { ctx } = makeHarness(store, { headers: FRESH_HEADERS, services: { deliveryOsReportQueries: reportQueries } })
  const input = { kind: 'deploy', projectId: PROJECT_ID, baselineId: BASELINE_ID, sourceRevision: REVISION, verdict: 'approved', ...overrides }
  return Promise.resolve(recordDecision().execute(input, ctx))
}

async function moveToReady(): Promise<TaskCommandResult> {
  const { ctx } = makeHarness(store)
  return updateTask().execute({ id: TASK_ID, status: 'ready' }, ctx)
}

function expectNoStageQueries(): void {
  expect(queriedEntities).not.toContain(DeliveryFlowStageArtifact)
  expect(queriedEntities).not.toContain(DeliveryFlowStageDecision)
}

beforeEach(() => {
  jest.clearAllMocks()
  queriedEntities = []
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => {
    queriedEntities.push(entity)
    return rows(entity).filter((row) => matches(row, where))
  })
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => {
    queriedEntities.push(entity)
    return rows(entity).find((row) => matches(row, where)) ?? null
  })
  seed()
})

describe('FLOW-08 — legacy projects are not gated', () => {
  it('moves a draft task to ready with both baseline approvals', async () => {
    const result = await moveToReady()
    expect(result).toMatchObject({ taskId: TASK_ID, status: 'ready' })
    expect(store.tasks[0].status).toBe('ready')
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
    expectNoStageQueries()
  })

  it('keeps the v1 design_decision_missing refusal without any stage detail', async () => {
    seed({ withDesign: false })
    const error = await catchHttpError(() => moveToReady())
    expectFrozenBody(error, 422, 'baseline_not_approved')
    expect(detailCodes(error)).toEqual(['design_decision_missing'])
    expect(store.tasks[0].status).toBe('draft')
    expectNoStageQueries()
  })

  it('reserves a manual hand-off over HTTP with the fresh lock header', async () => {
    seed({ tasks: [makeTask('ready')] })
    const { ctx } = makeHarness(store, { headers: FRESH_HEADERS })
    const result = await reserve().execute(reserveBody(), ctx)
    expect(result.created).toBe(true)
    expect(store.tasks[0].status).toBe('executing')
    expect(store.tasks[0].executionAttempts).toHaveLength(1)
    expect(store.tasks[0].executionAttempts[0].mode).toBe('manual_handoff')
    expectNoStageQueries()
  })

  it('reserves an automatic attempt in-process from the trusted executor', async () => {
    seed({ tasks: [makeTask('ready')] })
    const { request: _request, ...inProcessCtx } = makeHarness(store).ctx
    const input = reserveBody({ mode: 'automatic', trustedExecution: issueTrustedExecution(ACTOR_ID) })
    const result = await reserve().execute(input, inProcessCtx)
    expect(result.created).toBe(true)
    expect(store.tasks[0].executionAttempts[0].mode).toBe('automatic')
    expectNoStageQueries()
  })

  it('records an approved deploy decision on a green report', async () => {
    seed({ tasks: [] })
    store.evidence.push(...greenEvidence())
    const result = await deploy()
    expect(result).toMatchObject({ kind: 'deploy', verdict: 'approved' })
    expect(store.decisions.at(-1)).toMatchObject({ kind: 'deploy', verdict: 'approved' })
    expectNoStageQueries()
  })

  it('records a rejected deploy decision without evidence', async () => {
    seed({ tasks: [] })
    const result = await deploy({ verdict: 'rejected', reason: 'Preview shows a broken layout' })
    expect(result).toMatchObject({ kind: 'deploy', verdict: 'rejected' })
    expect(store.decisions.at(-1)).toMatchObject({ kind: 'deploy', verdict: 'rejected', reason: 'Preview shows a broken layout' })
    expectNoStageQueries()
  })

  it('treats the kit legacy shape and an explicit null pin the same way', async () => {
    expect(makeProject().flowTemplateId).toBeUndefined()
    seed({ project: { flowTemplateId: null, flowTemplateSnapshot: null } })
    const result = await moveToReady()
    expect(result).toMatchObject({ taskId: TASK_ID, status: 'ready' })
    expect(store.tasks[0].status).toBe('ready')
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
    expectNoStageQueries()
  })
})
