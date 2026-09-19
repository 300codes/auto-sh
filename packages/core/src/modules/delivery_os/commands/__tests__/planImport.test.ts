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
import { hashBaseline } from '../../lib/baseline'
import { baselineContentV1Schema, type BaselineContentV1, type PlanProposalV1 } from '../../lib/contracts'
import { loadBaselineContentFixture, loadNegativeDeliveryFixtures, loadPlanProposalFixture } from '../../lib/fixtures/index'
import type { DeliveryTask } from '../../data/entities'
import type { PlanImportCommandResult } from '../planImport'
import {
  BASELINE_ID,
  catchHttpError,
  detailCodes,
  emptyStore,
  expectFrozenBody,
  FOREIGN_ORG_ID,
  getHandler,
  makeApproval,
  makeBaseline,
  makeHarness,
  makeProject,
  matches,
  PROJECT_ID,
  rowsFor,
  STALE_UPDATED_AT,
  UPDATED_AT,
  type Row,
  type Store,
} from './baselineTestKit'

let store: Store

const importPlan = getHandler<PlanImportCommandResult>('delivery_os.tasks.import_plan')
const currentHeaders = { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() }

function parentContent(): BaselineContentV1 {
  return { ...loadBaselineContentFixture(), planSummary: null, acTestMap: {}, manualChecks: {}, declaredTests: [] }
}

function makePlan(overrides: Partial<PlanProposalV1> = {}): PlanProposalV1 {
  return {
    ...loadPlanProposalFixture(),
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    baselineHash: hashBaseline(parentContent()),
    ...overrides,
  }
}

function input(manifest: unknown = makePlan()): Row {
  return { projectId: PROJECT_ID, source: 'plan_proposal', manifest }
}

function seedApprovedProject(): void {
  const parent = makeBaseline(parentContent(), { attachmentIds: ['att-1'] })
  store = {
    ...emptyStore(),
    projects: [makeProject({ activeBaselineId: BASELINE_ID })],
    baselines: [parent],
    decisions: [makeApproval(parent, 'requirements'), makeApproval(parent, 'design')],
  }
}

function negativePlan(name: string): PlanProposalV1 {
  const fixture = loadNegativeDeliveryFixtures().find((entry) => entry.name === name)
  if (!fixture) throw new Error(`[internal] negative fixture ${name} is missing`)
  const document = fixture.document as PlanProposalV1
  const pinned = makePlan()
  return name === 'plan-proposal.foreign-baseline'
    ? { ...document, projectId: PROJECT_ID }
    : { ...document, projectId: PROJECT_ID, baselineId: pinned.baselineId, baselineHash: pinned.baselineHash }
}

async function expectRejected(manifest: unknown, status: number, code: string, detailCode?: string): Promise<void> {
  const { ctx, em } = makeHarness(store, { headers: currentHeaders })
  const error = await catchHttpError(() => importPlan.execute(input(manifest), ctx))
  expectFrozenBody(error, status, code)
  if (detailCode) expect(detailCodes(error)).toContain(detailCode)
  expect(em.persist).not.toHaveBeenCalled()
  expect(em.flush).not.toHaveBeenCalled()
  expect(store.baselines).toHaveLength(1)
  expect(store.tasks).toHaveLength(0)
  expect(store.projects[0].updatedAt).toBe(UPDATED_AT)
  expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
}

beforeEach(() => {
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(store, entity).find((row) => matches(row, where)) ?? null,
  )
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(store, entity).filter((row) => matches(row, where)),
  )
  seedApprovedProject()
})

describe('delivery_os.tasks.import_plan', () => {
  it('creates one merged baseline with the parent link and the draft tasks in one transaction', async () => {
    const { ctx, em } = makeHarness(store, { headers: currentHeaders })
    const result = await importPlan.execute(input(), ctx)

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.persist).toHaveBeenCalledTimes(3)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(store.baselines).toHaveLength(2)
    const merged = store.baselines[1]
    expect(merged).toMatchObject({
      id: result.baselineId,
      version: 2,
      source: 'plan_proposal',
      parentBaselineId: BASELINE_ID,
      attachmentIds: ['att-1'],
      projectId: PROJECT_ID,
    })
    const content = baselineContentV1Schema.parse(merged.content)
    expect(hashBaseline(content)).toBe(merged.contentHash)
    expect(content.architectureSummary).toBe(makePlan().architectureSummary)
    expect(Object.keys(content.acTestMap)).toEqual(['AC-001', 'AC-002'])
    expect(content.importedManifests).toEqual([{ manifestId: result.manifestId, manifestHash: result.manifestHash }])

    expect(result).toMatchObject({ duplicate: false, version: 2, parentBaselineId: BASELINE_ID, contentHash: merged.contentHash })
    expect(result.tasks.map((task) => task.proposalTaskKey)).toEqual(['service-list', 'service-filter'])
    const [list, filter] = store.tasks
    expect(list).toMatchObject({ id: result.tasks[0].id, baselineId: merged.id, status: 'draft', dependsOnTaskIds: [], acIds: ['AC-001'] })
    expect(list.allowedPaths).toEqual(['src/**', 'tests/**'])
    expect(filter).toMatchObject({ id: result.tasks[1].id, baselineId: merged.id, dependsOnTaskIds: [list.id], proposalTaskKey: 'service-filter' })
    expect(new Set([merged.id, list.id, filter.id]).size).toBe(3)
  })

  it('does not activate the merged baseline, syncs the plan section into the draft and bumps the project version', async () => {
    const { ctx } = makeHarness(store, { headers: currentHeaders })
    const result = await importPlan.execute(input(), ctx)
    const project = store.projects[0]
    expect(project.activeBaselineId).toBe(BASELINE_ID)
    expect(project.draftSpec).toMatchObject({
      architectureSummary: makePlan().architectureSummary,
      acTestMap: makePlan().acTestMap,
      declaredTests: makePlan().declaredTests,
    })
    expect((project.draftSpec as Row).requirements).toEqual(loadBaselineContentFixture().requirements)
    expect(result.projectUpdatedAt).toBe(project.updatedAt.toISOString())
    expect(project.updatedAt).not.toBe(UPDATED_AT)
  })

  it('emits task.updated once per created task after the commit and writes one audit entry', async () => {
    const { ctx } = makeHarness(store, { headers: currentHeaders })
    const result = await importPlan.execute(input(), ctx)
    const taskEvents = mockEmitDeliveryOsEvent.mock.calls.filter(([eventId]) => eventId === 'delivery_os.task.updated')
    expect(taskEvents.map(([, payload]) => (payload as Row).taskId)).toEqual(result.tasks.map((task) => task.id))
    expect(new Set(mockEmitDeliveryOsEvent.mock.calls.map(([eventId]) => eventId))).toEqual(new Set(['delivery_os.task.updated']))

    const log = await importPlan.buildLog?.({ input: input(), result, ctx, snapshots: {} } as never)
    expect(log).toMatchObject({
      resourceId: result.baselineId,
      parentResourceId: PROJECT_ID,
      snapshotAfter: { source: 'plan_proposal', parentBaselineId: BASELINE_ID, taskIds: result.tasks.map((task) => task.id) },
    })
  })

  it('answers duplicate: true with the same ids for a replay, without writes, events or a current lock header', async () => {
    const first = await importPlan.execute(input(), makeHarness(store, { headers: currentHeaders }).ctx)
    mockEmitDeliveryOsEvent.mockClear()
    const versionAfterFirst = store.projects[0].updatedAt

    for (const headers of [undefined, { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT }]) {
      const { ctx, em } = makeHarness(store, { headers })
      const replay = await importPlan.execute(input(), ctx)
      expect(replay).toMatchObject({ duplicate: true, baselineId: first.baselineId, version: 2, contentHash: first.contentHash })
      expect(replay.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id))
      expect(em.persist).not.toHaveBeenCalled()
      expect(em.flush).not.toHaveBeenCalled()
      expect(await importPlan.buildLog?.({ input: input(), result: replay, ctx, snapshots: {} } as never)).toBeNull()
    }
    expect(store.baselines).toHaveLength(2)
    expect(store.tasks).toHaveLength(2)
    expect(store.projects[0].updatedAt).toBe(versionAfterFirst)
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('still answers the replay after the merged baseline became the active one', async () => {
    const first = await importPlan.execute(input(), makeHarness(store, { headers: currentHeaders }).ctx)
    store.projects[0].activeBaselineId = first.baselineId
    const replay = await importPlan.execute(input(), makeHarness(store).ctx)
    expect(replay).toMatchObject({ duplicate: true, baselineId: first.baselineId })
  })

  it('returns only live tasks on replay and never re-creates an archived one', async () => {
    const first = await importPlan.execute(input(), makeHarness(store, { headers: currentHeaders }).ctx)
    ;(store.tasks[1] as unknown as Row).deletedAt = new Date()
    const { ctx, em } = makeHarness(store)
    const replay = await importPlan.execute(input(), ctx)
    expect(replay.tasks.map((task) => task.id)).toEqual([first.tasks[0].id])
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('imports a second plan on the activated merged baseline as v3 and still replays the first plan to v2', async () => {
    const first = await importPlan.execute(input(), makeHarness(store, { headers: currentHeaders }).ctx)
    const merged = store.baselines[1]
    store.decisions.push(makeApproval(merged, 'requirements'), makeApproval(merged, 'design'))
    store.projects[0].activeBaselineId = merged.id
    for (const task of store.tasks) (task as unknown as Row).updatedAt = UPDATED_AT

    const secondPlan = makePlan({ manifestId: 'plan-from-baseline-2026-09-19-002', baselineId: merged.id, baselineHash: merged.contentHash })
    const headers = { [OPTIMISTIC_LOCK_HEADER_NAME]: store.projects[0].updatedAt.toISOString() }
    const second = await importPlan.execute(input(secondPlan), makeHarness(store, { headers }).ctx)
    expect(second).toMatchObject({ duplicate: false, version: 3, parentBaselineId: merged.id })
    const thirdContent = baselineContentV1Schema.parse(store.baselines[2].content)
    expect(thirdContent.importedManifests?.map((entry) => entry.manifestId)).toEqual([first.manifestId, second.manifestId])
    expect(store.tasks).toHaveLength(4)

    const replay = await importPlan.execute(input(), makeHarness(store).ctx)
    expect(replay).toMatchObject({ duplicate: true, baselineId: first.baselineId, version: 2 })
    expect(replay.tasks).toEqual(first.tasks.map((task) => ({ ...task, updatedAt: UPDATED_AT.toISOString() })))
  })

  it('answers 409 idempotency_conflict when the manifestId was used by a requirements import', async () => {
    const plan = makePlan()
    const content = { ...parentContent(), importedManifests: [{ manifestId: plan.manifestId, manifestHash: 'c'.repeat(64) }] }
    const parent = makeBaseline(content)
    store.baselines = [parent]
    store.decisions = [makeApproval(parent, 'requirements'), makeApproval(parent, 'design')]
    const { ctx, em } = makeHarness(store, { headers: currentHeaders })
    const error = await catchHttpError(() => importPlan.execute(input({ ...plan, baselineHash: parent.contentHash }), ctx))
    expectFrozenBody(error, 409, 'idempotency_conflict')
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('refuses a parent whose stored content no longer matches its hash', async () => {
    store.baselines[0].content = { ...parentContent(), architectureSummary: 'Altered after approval' }
    await expectRejected(makePlan(), 422, 'hash_mismatch')
  })

  it('syncs only the test mappings of acceptance criteria the draft still has', async () => {
    const draft = store.projects[0].draftSpec as Row
    draft.acceptanceCriteria = (draft.acceptanceCriteria as Array<{ id: string }>).filter((criterion) => criterion.id !== 'AC-002')
    await importPlan.execute(input(), makeHarness(store, { headers: currentHeaders }).ctx)
    expect(Object.keys((store.projects[0].draftSpec as Row).acTestMap as Row)).toEqual(['AC-001'])
    expect(Object.keys(baselineContentV1Schema.parse(store.baselines[1].content).acTestMap)).toEqual(['AC-001', 'AC-002'])
  })

  it('answers 409 idempotency_conflict for the same manifestId with other content', async () => {
    await importPlan.execute(input(), makeHarness(store, { headers: currentHeaders }).ctx)
    const { ctx, em } = makeHarness(store, { headers: currentHeaders })
    const error = await catchHttpError(() => importPlan.execute(input(makePlan({ architectureSummary: 'Another architecture' })), ctx))
    expectFrozenBody(error, 409, 'idempotency_conflict')
    expect(em.persist).not.toHaveBeenCalled()
    expect(store.tasks).toHaveLength(2)
  })

  it('recovers a unique violation as the duplicate of the winner', async () => {
    const winnerStore = store
    const first = await importPlan.execute(input(), makeHarness(winnerStore, { headers: currentHeaders }).ctx)
    const { ctx, em } = makeHarness(store, { headers: currentHeaders })
    em.transactional.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    const recovered = await importPlan.execute(input(), ctx)
    expect(recovered).toMatchObject({ duplicate: true, baselineId: first.baselineId })
    expect(recovered.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id))

    seedApprovedProject()
    const lost = makeHarness(store, { headers: currentHeaders })
    lost.em.transactional.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    await expect(importPlan.execute(input(), lost.ctx)).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses hallucinated or escaping plans with 422 and persists nothing', async () => {
    await expectRejected(negativePlan('plan-proposal.foreign-baseline'), 422, 'foreign_reference', 'foreign_baseline')
    await expectRejected(negativePlan('plan-proposal.path-escape'), 422, 'path_not_allowed')
    await expectRejected(negativePlan('plan-proposal.false-test-mapping'), 422, 'unknown_test_id')
    const plan = makePlan()
    await expectRejected({ ...plan, tasks: [{ ...plan.tasks[0], acIds: ['AC-404'] }, plan.tasks[1]] }, 422, 'unknown_ac')
    await expectRejected(
      { ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ['service-filter'] }, plan.tasks[1]] },
      422,
      'cycle',
    )
    await expectRejected(makePlan({ baselineHash: 'a'.repeat(64) }), 422, 'foreign_reference', 'baseline_hash_mismatch')
    await expectRejected(makePlan({ projectId: '99999999-9999-4999-8999-999999999999' }), 422, 'foreign_reference', 'foreign_project')
    await expectRejected({ ...plan, schemaVersion: 'delivery.plan-proposal/v2' }, 422, 'unsupported_schema_version')
  })

  it('refuses a baseline that is not active or lacks one of the two approvals', async () => {
    store.decisions = [store.decisions[0]]
    await expectRejected(makePlan(), 422, 'baseline_not_approved', 'design_decision_missing')

    seedApprovedProject()
    store.decisions[1] = makeApproval(store.baselines[0], 'design', { verdict: 'rejected' })
    await expectRejected(makePlan(), 422, 'baseline_not_approved', 'design_rejected')

    seedApprovedProject()
    store.decisions[0] = makeApproval(store.baselines[0], 'requirements', { subjectHash: 'b'.repeat(64) })
    await expectRejected(makePlan(), 422, 'baseline_not_approved', 'requirements_decision_missing')

    seedApprovedProject()
    store.projects[0].activeBaselineId = null
    await expectRejected(makePlan(), 422, 'baseline_not_approved', 'baseline_not_active')
  })

  it('needs a current project version for a first import: 428 without and 409 with a stale header', async () => {
    const missing = makeHarness(store)
    expectFrozenBody(await catchHttpError(() => importPlan.execute(input(), missing.ctx)), 428, 'optimistic_lock_required')
    expect(missing.em.persist).not.toHaveBeenCalled()

    const stale = makeHarness(store, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } })
    const error = await catchHttpError(() => importPlan.execute(input(), stale.ctx))
    expect(error.status).toBe(409)
    expect(stale.em.persist).not.toHaveBeenCalled()
    expect(store.tasks).toHaveLength(0)
  })

  it('answers 404 for another organization and 400 for another source', async () => {
    const foreign = makeHarness(store, { headers: currentHeaders, orgId: FOREIGN_ORG_ID })
    expectFrozenBody(await catchHttpError(() => importPlan.execute(input(), foreign.ctx)), 404, 'not_found')

    const { ctx } = makeHarness(store, { headers: currentHeaders })
    const manual = { projectId: PROJECT_ID, source: 'manual', baselineId: BASELINE_ID, title: 'Task', acIds: ['AC-001'] }
    const error = await catchHttpError(() => importPlan.execute(manual, ctx))
    expectFrozenBody(error, 400, 'validation_failed')
    expect(detailCodes(error)).toContain('unsupported_source')
  })

  it('keeps existing project tasks untouched and validates the graph together with them', async () => {
    const existing = { id: 'existing-task', projectId: PROJECT_ID, baselineId: BASELINE_ID, dependsOnTaskIds: [], tenantId: store.projects[0].tenantId, organizationId: store.projects[0].organizationId, deletedAt: null, proposalTaskKey: null, status: 'draft' }
    store.tasks.push(existing as unknown as DeliveryTask)
    const { ctx } = makeHarness(store, { headers: currentHeaders })
    const result = await importPlan.execute(input(), ctx)
    expect(store.tasks).toHaveLength(3)
    expect(store.tasks[0]).toBe(existing)
    expect(result.tasks).toHaveLength(2)
  })
})
