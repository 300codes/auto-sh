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
import '@open-mercato/core/modules/delivery_os/commands'
import { GET as LIST, POST, metadata as projectTasksMetadata, openApi as projectTasksOpenApi } from '../projects/[id]/tasks/route'
import { GET as DETAIL, metadata as detailMetadata } from '../tasks/[id]/route'
import * as tasksRoute from '../tasks/route'
import {
  BASELINE_ID,
  FOREIGN_ORG_ID,
  PROJECT_ID,
  STALE_UPDATED_AT,
  UPDATED_AT,
  makeApproval,
  makeBaseline,
  makeProject,
  type Row,
} from '../../commands/__tests__/baselineTestKit'
import { hashBaseline } from '../../lib/baseline'
import { loadBaselineContentFixture, loadPlanProposalFixture } from '../../lib/fixtures/index'
import { planImportResponseSchema, taskDtoSchema, taskListResponseSchema } from '../schemas'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  TASK_ID,
  VIEW_ONLY,
  apiRequest,
  detailCodesOf,
  expectFrozenError,
  isAllowedBy,
  makeTaskRow,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

const { PUT, DELETE, metadata, openApi } = tasksRoute
const SECOND_TASK_ID = '7c7c7c7c-7777-4777-8777-777777777778'
const listPath = `/projects/${PROJECT_ID}/tasks`

function manualTask(overrides: Row = {}): Row {
  return { source: 'manual', baselineId: BASELINE_ID, title: 'Service list', acIds: ['AC-001'], ...overrides }
}

function create(body: Row): Promise<Response> {
  return POST(apiRequest('POST', listPath, { body }), routeParams(PROJECT_ID))
}

function update(body: Row, lock: string | Date | null = UPDATED_AT): Promise<Response> {
  return PUT(apiRequest('PUT', '/tasks', { body: { id: TASK_ID, ...body }, lock }))
}

beforeEach(() => {
  resetRouteState()
  routeState.store.projects.push(makeProject({ activeBaselineId: BASELINE_ID }) as unknown as Row)
  routeState.store.baselines.push(makeBaseline() as unknown as Row)
})

describe('delivery_os task routes — guards', () => {
  it('exports PUT and DELETE only on the collection route and declares feature guards', () => {
    expect(Object.keys(tasksRoute).sort()).toEqual(['DELETE', 'PUT', 'metadata', 'openApi'])
    expect(Object.keys(openApi.methods).sort()).toEqual(['DELETE', 'PUT'])
    expect(Object.keys(projectTasksOpenApi.methods)).toEqual(['GET', 'POST'])
    for (const method of ['PUT', 'DELETE']) {
      expect(isAllowedBy(metadata, method, VIEW_ONLY)).toBe(false)
      expect(isAllowedBy(metadata, method, EMPLOYEE_FEATURES)).toBe(true)
    }
    expect(isAllowedBy(projectTasksMetadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(detailMetadata, 'GET', ['sales.*'])).toBe(false)
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    const responses = await Promise.all([
      LIST(apiRequest('GET', listPath), routeParams(PROJECT_ID)),
      create(manualTask()),
      DETAIL(apiRequest('GET', `/tasks/${TASK_ID}`), routeParams(TASK_ID)),
      update({ title: 'Renamed' }),
      DELETE(apiRequest('DELETE', `/tasks?id=${TASK_ID}`)),
    ])
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401])
  })
})

describe('POST /api/delivery_os/projects/:id/tasks', () => {
  it('creates a manual task: 201 { id, updatedAt }', async () => {
    const response = await create(manualTask())
    const body = await readBody(response)
    expect(response.status).toBe(201)
    expect(Object.keys(body).sort()).toEqual(['id', 'updatedAt'])
    expect(routeState.store.tasks).toHaveLength(1)
    expect(routeState.store.tasks[0]).toMatchObject({ projectId: PROJECT_ID, status: 'draft' })
  })

  it('answers 403 for a view-only caller and checks results.import for a plan proposal', async () => {
    signInAs({ features: VIEW_ONLY })
    await expectFrozenError(await create(manualTask()), 403, 'forbidden')

    const proposal = { source: 'plan_proposal', manifest: { schemaVersion: 'delivery.plan-proposal/v1' } }
    signInAs({ features: ['delivery_os.projects.view', 'delivery_os.projects.manage'] })
    await expectFrozenError(await create(proposal), 403, 'forbidden')

    signInAs({ features: EMPLOYEE_FEATURES })
    await expectFrozenError(await create(proposal), 400, 'validation_failed')
    expect(routeState.store.tasks).toHaveLength(0)
  })

  it('answers 422 unknown_ac, 422 foreign_dependency and 400 for a malformed body', async () => {
    await expectFrozenError(await create(manualTask({ acIds: ['AC-404'] })), 422, 'unknown_ac')
    await expectFrozenError(await create(manualTask({ dependsOnTaskIds: [SECOND_TASK_ID] })), 422, 'foreign_dependency')
    await expectFrozenError(await create(manualTask({ acIds: [] })), 400, 'validation_failed')
    expect(routeState.store.tasks).toHaveLength(0)
  })

  it('answers 404 for a second tenant and a second organization', async () => {
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await create(manualTask()), 404, 'not_found')
      await expectFrozenError(await LIST(apiRequest('GET', listPath), routeParams(PROJECT_ID)), 404, 'not_found')
    }
  })
})

describe('GET task routes', () => {
  it('lists live tasks and reads one by id with updatedAt and the attempt register, without writing', async () => {
    routeState.store.tasks.push(makeTaskRow(), makeTaskRow({ id: SECOND_TASK_ID, deletedAt: new Date() }))
    const list = await LIST(apiRequest('GET', listPath), routeParams(PROJECT_ID))
    const listBody = await readBody(list)
    expect(list.status).toBe(200)
    expect(taskListResponseSchema.safeParse(listBody).success).toBe(true)
    expect(listBody.total).toBe(1)

    const detail = await DETAIL(apiRequest('GET', `/tasks/${TASK_ID}`), routeParams(TASK_ID))
    const body = await readBody(detail)
    expect(detail.status).toBe(200)
    expect(taskDtoSchema.safeParse(body).success).toBe(true)
    expect(body).toMatchObject({ updatedAt: UPDATED_AT.toISOString(), executionAttempts: [], attemptRegisterReadable: true })

    const archived = await DETAIL(apiRequest('GET', `/tasks/${SECOND_TASK_ID}`), routeParams(SECOND_TASK_ID))
    expect((await readBody(archived)).archivedAt).toEqual(expect.any(String))
    expect(routeState.writes).toBe(0)
  })

  it('keeps history readable when the attempt register is unreadable', async () => {
    routeState.store.tasks.push(makeTaskRow({ executionAttempts: [{ attemptId: 'broken' }] }))
    const body = await readBody(await DETAIL(apiRequest('GET', `/tasks/${TASK_ID}`), routeParams(TASK_ID)))
    expect(body).toMatchObject({ executionAttempts: [], attemptRegisterReadable: false })
  })

  it('answers 404 for a second tenant, a second organization and a malformed id', async () => {
    routeState.store.tasks.push(makeTaskRow())
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await DETAIL(apiRequest('GET', '/tasks/x'), routeParams(TASK_ID)), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await DETAIL(apiRequest('GET', '/tasks/x'), routeParams('nope')), 404, 'not_found')
  })
})

describe('PUT and DELETE /api/delivery_os/tasks', () => {
  it('updates with a matching version: 200 { ok, updatedAt, status }', async () => {
    const task = makeTaskRow()
    routeState.store.tasks.push(task)
    const response = await update({ title: 'Renamed' })
    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ ok: true, updatedAt: expect.any(String), status: 'draft' })
    expect(task.title).toBe('Renamed')
  })

  it('answers the platform 409 for a stale PUT and a stale DELETE', async () => {
    const task = makeTaskRow()
    routeState.store.tasks.push(task)
    const stalePut = await update({ title: 'Renamed' }, STALE_UPDATED_AT)
    const staleDelete = await DELETE(apiRequest('DELETE', `/tasks?id=${TASK_ID}`, { lock: STALE_UPDATED_AT }))
    for (const response of [stalePut, staleDelete]) {
      expect(response.status).toBe(409)
      expect((await readBody(response)).code).toBe('optimistic_lock_conflict')
    }
    expect(task).toMatchObject({ title: 'Service list', deletedAt: null })
  })

  it('answers 409 invalid_transition for a status only the system may set, 422 cycle for a self dependency and 400 for an unknown status', async () => {
    routeState.store.tasks.push(makeTaskRow())
    await expectFrozenError(await update({ status: 'verified' }), 409, 'invalid_transition')
    await expectFrozenError(await update({ dependsOnTaskIds: [TASK_ID] }), 422, 'cycle')
    await expectFrozenError(await update({ status: 'teleported' }), 400, 'validation_failed')
  })

  it('archives a task and answers 404 for a foreign scope', async () => {
    const task = makeTaskRow()
    routeState.store.tasks.push(task)
    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFrozenError(await DELETE(apiRequest('DELETE', `/tasks?id=${TASK_ID}`)), 404, 'not_found')
    await expectFrozenError(await update({ title: 'Hijacked' }, null), 404, 'not_found')

    signInAs({})
    const response = await DELETE(apiRequest('DELETE', `/tasks?id=${TASK_ID}`, { lock: UPDATED_AT }))
    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ ok: true })
    expect(task.deletedAt).toBeInstanceOf(Date)
  })
})

describe('R10 POST /projects/:id/tasks — plan proposal import', () => {
  const parentContent = { ...loadBaselineContentFixture(), planSummary: null, acTestMap: {}, manualChecks: {}, declaredTests: [] }

  function plan(overrides: Row = {}): Row {
    return {
      ...loadPlanProposalFixture(),
      projectId: PROJECT_ID,
      baselineId: BASELINE_ID,
      baselineHash: hashBaseline(parentContent),
      ...overrides,
    }
  }

  function importPlan(manifest: Row, lock: string | Date | null = UPDATED_AT, headers?: Record<string, string>): Promise<Response> {
    const request = apiRequest('POST', listPath, { body: { source: 'plan_proposal', manifest }, lock, headers })
    return POST(request, routeParams(PROJECT_ID))
  }

  function approve(baseline: Row): void {
    routeState.store.decisions.push(
      makeApproval(baseline as never, 'requirements') as unknown as Row,
      makeApproval(baseline as never, 'design') as unknown as Row,
    )
  }

  beforeEach(() => {
    const parent = makeBaseline(parentContent)
    routeState.store.baselines = [parent as unknown as Row]
    approve(parent as unknown as Row)
    routeState.writes = 0
  })

  it('answers 403 for a manage-only caller before anything is read or written', async () => {
    signInAs({ features: ['delivery_os.projects.view', 'delivery_os.projects.manage'] })
    await expectFrozenError(await importPlan(plan()), 403, 'forbidden')
    expect(routeState.writes).toBe(0)
    expect(routeState.store.baselines).toHaveLength(1)
  })

  it('imports the plan: 201 with the merged baseline and task ids, then 200 duplicate with the same ids and no new rows', async () => {
    signInAs({ features: EMPLOYEE_FEATURES })
    const created = await importPlan(plan())
    expect(created.status).toBe(201)
    const body = planImportResponseSchema.parse(await readBody(created))
    expect(body).toMatchObject({ duplicate: false, version: 2 })
    expect(body.tasks.map((task) => task.proposalTaskKey)).toEqual(['service-list', 'service-filter'])
    expect(routeState.store.baselines[1]).toMatchObject({ id: body.baselineId, parentBaselineId: BASELINE_ID, source: 'plan_proposal' })
    expect(routeState.store.projects[0].activeBaselineId).toBe(BASELINE_ID)
    const writesAfterImport = routeState.writes

    const replay = await importPlan(plan(), null)
    expect(replay.status).toBe(200)
    const replayBody = planImportResponseSchema.parse(await readBody(replay))
    expect(replayBody).toMatchObject({ duplicate: true, baselineId: body.baselineId })
    expect(replayBody.tasks.map((task) => task.id)).toEqual(body.tasks.map((task) => task.id))
    expect(routeState.store.tasks).toHaveLength(2)
    expect(routeState.store.baselines).toHaveLength(2)
    expect(routeState.writes).toBe(writesAfterImport)

    await expectFrozenError(await importPlan(plan({ architectureSummary: 'Changed' }), null), 409, 'idempotency_conflict')
  })

  it('keeps imported tasks out of ready until the merged baseline has both decisions and is active', async () => {
    const body = planImportResponseSchema.parse(await readBody(await importPlan(plan())))
    const [first] = body.tasks
    const ready = () => PUT(apiRequest('PUT', '/tasks', { body: { id: first.id, status: 'ready' }, lock: first.updatedAt }))

    const refused = await expectFrozenError(await ready(), 422, 'baseline_not_approved')
    expect(detailCodesOf(refused)).toEqual(expect.arrayContaining(['baseline_not_active', 'requirements_decision_missing', 'design_decision_missing']))

    approve(routeState.store.baselines[1])
    const stillInactive = await expectFrozenError(await ready(), 422, 'baseline_not_approved')
    expect(detailCodesOf(stillInactive)).toEqual(['baseline_not_active'])

    routeState.store.projects[0].activeBaselineId = body.baselineId
    expect((await ready()).status).toBe(200)
  })

  it('rejects an invalid or unapproved plan with 422 and writes nothing', async () => {
    const valid = plan() as { tasks: Row[] }
    const cases: Array<[Row, string]> = [
      [plan({ baselineId: '99999999-9999-4999-8999-999999999999' }), 'foreign_reference'],
      [plan({ tasks: [{ ...valid.tasks[0], allowedPaths: ['**'] }, valid.tasks[1]] }), 'path_not_allowed'],
      [plan({ acTestMap: { 'AC-001': ['a test nobody declared'], 'AC-002': ['another'] } }), 'unknown_test_id'],
      [plan({ tasks: [{ ...valid.tasks[0], acIds: ['AC-404'] }, valid.tasks[1]] }), 'unknown_ac'],
      [plan({ tasks: [{ ...valid.tasks[0], dependsOn: ['service-filter'] }, valid.tasks[1]] }), 'cycle'],
    ]
    for (const [manifest, code] of cases) {
      await expectFrozenError(await importPlan(manifest), 422, code)
    }
    routeState.store.decisions = []
    await expectFrozenError(await importPlan(plan()), 422, 'baseline_not_approved')
    expect(routeState.writes).toBe(0)
    expect(routeState.store.baselines).toHaveLength(1)
    expect(routeState.store.tasks).toHaveLength(0)
  })

  it('answers 428 without the project version, the platform 409 for a stale one and 413 for an oversized body', async () => {
    await expectFrozenError(await importPlan(plan(), null), 428, 'optimistic_lock_required')
    expect((await importPlan(plan(), STALE_UPDATED_AT)).status).toBe(409)
    await expectFrozenError(await importPlan(plan(), UPDATED_AT, { 'content-length': '1000001' }), 413, 'payload_too_large')
    expect(routeState.writes).toBe(0)
  })
})
