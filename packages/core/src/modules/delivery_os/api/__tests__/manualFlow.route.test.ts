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
import { POST as CREATE_PROJECT, PUT as UPDATE_PROJECT } from '../projects/route'
import { GET as PROJECT_DETAIL } from '../projects/[id]/route'
import { POST as CREATE_BASELINE } from '../projects/[id]/baselines/route'
import { POST as DECIDE } from '../baselines/[id]/decisions/route'
import { POST as CREATE_TASK } from '../projects/[id]/tasks/route'
import { PUT as UPDATE_TASK } from '../tasks/route'
import { POST as IMPORT_RESULT } from '../tasks/[id]/results/route'
import { draftAttachmentRows, makeDraft, type Row } from '../../commands/__tests__/baselineTestKit'
import { emitDeliveryOsEvent } from '../../events'
import { taskPackageV1Schema, type TaskPackageV1 } from '../../lib/contracts'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import { projectDetailSchema } from '../schemas'
import { IDEMPOTENCY_KEY, UNKNOWN_ATTEMPT_ID, getPackage, reserve } from './attemptRouteKit'
import {
  EM_WRITE_METHODS,
  apiRequest,
  detailCodesOf,
  em,
  expectFrozenError,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
} from './routeTestKit'

type Baseline = { baselineId: string; version: number; contentHash: string }
type Task = { id: string; updatedAt: string }

const draft = makeDraft()
const draftAcIds = (draft.acceptanceCriteria as Array<{ id: string }>).map((criterion) => criterion.id)

async function expectStatus(response: Response, status: number): Promise<Record<string, unknown>> {
  const body = await readBody(response)
  expect({ status: response.status, body }).toEqual({ status, body: expect.anything() })
  return body
}

async function createProject(): Promise<{ id: string; updatedAt: string }> {
  const body = { name: 'Customer portal', inputMode: 'from_brief', targetProfileId: TARGET_PROFILES[0].id }
  const created = await expectStatus(await CREATE_PROJECT(apiRequest('POST', '/projects', { body })), 201)
  return { id: created.id as string, updatedAt: created.updatedAt as string }
}

async function saveDraft(project: { id: string; updatedAt: string }): Promise<void> {
  routeState.store.attachments.push(...draftAttachmentRows(draft))
  const request = apiRequest('PUT', '/projects', { body: { id: project.id, draftSpec: draft }, lock: project.updatedAt })
  await expectStatus(await UPDATE_PROJECT(request), 200)
}

async function readProject(projectId: string): Promise<Record<string, unknown>> {
  const body = await expectStatus(await PROJECT_DETAIL(apiRequest('GET', `/projects/${projectId}`), routeParams(projectId)), 200)
  expect(projectDetailSchema.safeParse(body).success).toBe(true)
  return body
}

async function expectProjectState(projectId: string, status: string, active: string | null): Promise<void> {
  const body = await readProject(projectId)
  expect([body.status, body.activeBaselineId]).toEqual([status, active])
}

async function freezeBaseline(projectId: string): Promise<Baseline> {
  const { updatedAt } = await readProject(projectId)
  const request = apiRequest('POST', `/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: updatedAt as string })
  const body = await expectStatus(await CREATE_BASELINE(request, routeParams(projectId)), 201)
  return { baselineId: body.baselineId as string, version: body.version as number, contentHash: body.contentHash as string }
}

async function decide(projectId: string, baseline: Baseline, kind: 'requirements' | 'design'): Promise<Record<string, unknown>> {
  const { updatedAt } = await readProject(projectId)
  const body = { kind, verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version }
  const request = apiRequest('POST', `/baselines/${baseline.baselineId}/decisions`, { body, lock: updatedAt as string })
  return expectStatus(await DECIDE(request, routeParams(baseline.baselineId)), 201)
}

async function createTask(projectId: string, baseline: Baseline): Promise<Task> {
  const body = { source: 'manual', baselineId: baseline.baselineId, title: 'Service list', acIds: [draftAcIds[0]] }
  const request = apiRequest('POST', `/projects/${projectId}/tasks`, { body })
  const created = await expectStatus(await CREATE_TASK(request, routeParams(projectId)), 201)
  return { id: created.id as string, updatedAt: created.updatedAt as string }
}

function setReady(task: Task): Promise<Response> {
  return UPDATE_TASK(apiRequest('PUT', '/tasks', { body: { id: task.id, status: 'ready' }, lock: task.updatedAt }))
}

function importResult(taskId: string, body: unknown): Promise<Response> {
  return IMPORT_RESULT(apiRequest('POST', `/tasks/${taskId}/results`, { body }), routeParams(taskId))
}

function storedTask(taskId: string): Row {
  const task = routeState.store.tasks.find((row) => row.id === taskId)
  if (!task) throw new Error(`[internal] task ${taskId} is not in the route store`)
  return task
}

function approvedEvents(): unknown[] {
  return jest.mocked(emitDeliveryOsEvent).mock.calls.filter(([eventId]) => eventId === 'delivery_os.baseline.approved')
}

function clearWriteSpies(): void {
  for (const method of EM_WRITE_METHODS) em[method].mockClear()
  routeState.writes = 0
}

async function expectReadyRefused(task: Task, missingDecisionCodes: string[]): Promise<void> {
  const refused = await expectFrozenError(await setReady(task), 422, 'baseline_not_approved')
  expect(detailCodesOf(refused)).toEqual(['baseline_not_active', ...missingDecisionCodes])
}

async function expectNoAttemptReserved(task: Task): Promise<void> {
  await expectFrozenError(await reserve({ taskId: task.id, lock: task.updatedAt }), 409, 'task_not_ready')
  await expectFrozenError(await getPackage(UNKNOWN_ATTEMPT_ID, task.id), 404, 'attempt_not_found')
  expect(em.persist).not.toHaveBeenCalled()
  expect(routeState.writes).toBe(0)
  expect(storedTask(task.id)).toMatchObject({ status: 'draft', attemptNumber: 0, executionAttempts: [] })
}

beforeEach(() => {
  resetRouteState()
  jest.mocked(emitDeliveryOsEvent).mockClear()
})

describe('delivery_os manual flow without enterprise (BN-01)', () => {
  it('runs project → baseline → real decisions → ready → reserve → package → result → progress', async () => {
    const project = await createProject()
    await saveDraft(project)
    await expectProjectState(project.id, 'draft', null)

    const baseline = await freezeBaseline(project.id)
    expect(baseline.version).toBe(1)
    await expectProjectState(project.id, 'awaiting_approval', null)

    const requirements = await decide(project.id, baseline, 'requirements')
    expect(requirements.activeBaselineId).toBeNull()
    await expectProjectState(project.id, 'awaiting_approval', null)
    expect(approvedEvents()).toHaveLength(0)

    const design = await decide(project.id, baseline, 'design')
    expect(design.activeBaselineId).toBe(baseline.baselineId)
    expect(approvedEvents()).toHaveLength(1)
    expect(routeState.store.decisions.map((decision) => [decision.kind, decision.subjectHash, decision.subjectVersion])).toEqual([
      ['requirements', baseline.contentHash, baseline.version],
      ['design', baseline.contentHash, baseline.version],
    ])
    await expectProjectState(project.id, 'planning', baseline.baselineId)

    const task = await createTask(project.id, baseline)
    const ready = await expectStatus(await setReady(task), 200)
    expect(ready.status).toBe('ready')

    const reserved = await expectStatus(await reserve({ taskId: task.id, lock: ready.updatedAt as string }), 201)
    const replayed = await expectStatus(await reserve({ taskId: task.id, lock: ready.updatedAt as string }), 200)
    expect(replayed.attemptId).toBe(reserved.attemptId)
    expect(reserved).toMatchObject({ taskId: task.id, baselineId: baseline.baselineId, baselineHash: baseline.contentHash })
    expect(storedTask(task.id)).toMatchObject({ status: 'executing', attemptNumber: 1 })
    expect(storedTask(task.id).executionAttempts).toHaveLength(1)

    const taskBeforeExport = JSON.stringify(storedTask(task.id))
    clearWriteSpies()
    const exported = await getPackage(reserved.attemptId as string, task.id)
    expect(exported.status).toBe(200)
    const taskPackage = (await exported.json()) as TaskPackageV1
    for (const method of EM_WRITE_METHODS) expect(em[method]).not.toHaveBeenCalled()
    expect(routeState.writes).toBe(0)
    expect(JSON.stringify(storedTask(task.id))).toBe(taskBeforeExport)
    expect(taskPackageV1Schema.safeParse(taskPackage).success).toBe(true)
    expect(taskPackage).toMatchObject({
      taskId: task.id,
      attemptId: reserved.attemptId,
      baselineId: baseline.baselineId,
      idempotencyKey: IDEMPOTENCY_KEY,
    })

    const resultBody = { attemptId: reserved.attemptId, manifest: buildResultManifest(taskPackage) }
    const accepted = await expectStatus(await importResult(task.id, resultBody), 201)
    expect(accepted).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
    const duplicate = await expectStatus(await importResult(task.id, resultBody), 200)
    expect(duplicate).toMatchObject({ duplicate: true, evidenceId: accepted.evidenceId })
    expect(routeState.store.evidence).toHaveLength(1)
    expect(routeState.store.evidence[0]).toMatchObject({ source: 'manual', taskId: task.id, attemptId: reserved.attemptId })

    const detail = await readProject(project.id)
    expect(detail.status).toBe('in_progress')
    expect(detail.progress).toEqual({ proven: 0, total: draftAcIds.length, unit: 'ac', percent: 0 })
  })

  it('refuses ready with 422 baseline_not_approved while only the requirements decision exists', async () => {
    const project = await createProject()
    await saveDraft(project)
    const baseline = await freezeBaseline(project.id)
    await decide(project.id, baseline, 'requirements')
    const task = await createTask(project.id, baseline)
    clearWriteSpies()

    await expectReadyRefused(task, ['design_decision_missing'])
    await expectNoAttemptReserved(task)
    await expectProjectState(project.id, 'awaiting_approval', null)
    expect(approvedEvents()).toHaveLength(0)
  })

  it('refuses a reservation with 409 task_not_ready before the task is ready, even after both decisions', async () => {
    const project = await createProject()
    await saveDraft(project)
    const baseline = await freezeBaseline(project.id)
    await decide(project.id, baseline, 'requirements')
    await decide(project.id, baseline, 'design')
    const task = await createTask(project.id, baseline)
    clearWriteSpies()

    await expectNoAttemptReserved(task)
  })

  it('never reaches an attempt or an exportable package when the decisions are skipped', async () => {
    const project = await createProject()
    await saveDraft(project)
    const baseline = await freezeBaseline(project.id)
    const task = await createTask(project.id, baseline)
    clearWriteSpies()

    await expectReadyRefused(task, ['requirements_decision_missing', 'design_decision_missing'])
    await expectNoAttemptReserved(task)
    expect(routeState.store.decisions).toHaveLength(0)
    expect(routeState.store.evidence).toHaveLength(0)
    expect(approvedEvents()).toHaveLength(0)
    await expectProjectState(project.id, 'awaiting_approval', null)
  })
})
