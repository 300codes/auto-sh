/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => require('../../api/__tests__/routeTestKit').findMock)

import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { register } from '../../di'
import { reserveAttempt } from '../../lib/attempts'
import { taskPackageV1Schema, type ExecutionAttempt } from '../../lib/contracts'
import {
  EM_WRITE_METHODS,
  FOREIGN_TENANT_ID,
  TASK_ID,
  em,
  findMock,
  makeTaskRow,
  resetRouteState,
  routeState,
} from '../../api/__tests__/routeTestKit'
import { createDeliveryOsAttemptQueries, type DeliveryOsAttemptQueries } from '../attemptQueries'
import type { DeliveryFlowTemplateProvider } from '../flowTemplateProvider'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { BASELINE_ID, FOREIGN_ORG_ID, ORG_ID, TENANT_ID, makeBaseline, makeProject, type Row } from './baselineTestKit'

const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const SECOND_TASK_ID = '7c7c7c7c-7777-4777-8777-777777777778'
const THIRD_TASK_ID = '7c7c7c7c-7777-4777-8777-777777777779'
const EVIDENCE_ID = '2e2e2e2e-2222-4222-8222-222222222222'
const UNKNOWN_ATTEMPT_ID = '3d3d3d3d-3333-4333-8333-333333333333'
const BASE_REVISION = { kind: 'git' as const, commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }

let queries: DeliveryOsAttemptQueries

function makeAttempt(attemptId: string, overrides: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
  const baseline = makeBaseline()
  const result = reserveAttempt([], {
    idempotencyKey: `key-${attemptId}`,
    payload: { mode: 'manual_handoff', baseRevision: BASE_REVISION },
    mode: 'manual_handoff',
    baselineId: BASELINE_ID,
    baselineHash: baseline.contentHash,
    baseRevision: BASE_REVISION,
    now: '2026-09-19T10:00:00.000Z',
    newAttemptId: attemptId,
  })
  if (!result.ok) throw new Error('[internal] fixture reservation failed')
  return { ...result.attempt, ...overrides }
}

function pendingAttempt(attemptId: string): ExecutionAttempt {
  return makeAttempt(attemptId, {
    state: 'result_received',
    workflowRef: `workflow-${attemptId}`,
    workflowStepId: 'await-result',
    resultEvidenceId: EVIDENCE_ID,
    completionDelivery: 'pending',
  })
}

function seedTask(overrides: Row): Row {
  const task = makeTaskRow({ baselineId: BASELINE_ID, status: 'executing', attemptNumber: 1, ...overrides })
  routeState.store.tasks.push(task)
  return task
}

function expectNoWrites(): void {
  for (const method of EM_WRITE_METHODS) expect(em[method]).not.toHaveBeenCalled()
  expect(routeState.writes).toBe(0)
}

beforeEach(() => {
  resetRouteState()
  routeState.store.projects.push(makeProject({ activeBaselineId: BASELINE_ID }) as unknown as Row)
  routeState.store.baselines.push(makeBaseline() as unknown as Row)
  queries = createDeliveryOsAttemptQueries(em as unknown as EntityManager)
})

describe('deliveryOsAttemptQueries', () => {
  it('is registered in the container under the frozen DI key', () => {
    const registrations: Record<string, { resolve: (container: { resolve: (name: string) => unknown }) => unknown }> = {}
    register({ register: (entries: typeof registrations) => Object.assign(registrations, entries) } as never)
    expect(Object.keys(registrations)).toEqual([
      'deliveryOsAttemptQueries',
      'deliveryOsReportQueries',
      'deliveryOsFlowQueries',
      'deliveryOsAttachmentInspector',
      'deliveryFlowTemplateProvider',
      'deliveryStaffKanbanAdapter',
    ])
    const lazyResolve = jest.fn()
    expect(typeof registrations.deliveryOsAttachmentInspector.resolve({ resolve: lazyResolve })).toBe('function')
    expect(lazyResolve).not.toHaveBeenCalled()
    const service = registrations.deliveryOsAttemptQueries.resolve({ resolve: () => em }) as DeliveryOsAttemptQueries
    expect(Object.keys(service).sort()).toEqual(['buildTaskPackage', 'getAttempt', 'listPendingDeliveries'])
    const reports = registrations.deliveryOsReportQueries.resolve({ resolve: () => em }) as Record<string, unknown>
    expect(Object.keys(reports)).toEqual(['buildReport'])
    const flows = registrations.deliveryOsFlowQueries.resolve({ resolve: () => em }) as Record<string, unknown>
    expect(Object.keys(flows)).toEqual(['flowStatus'])
    expect(typeof flows.flowStatus).toBe('function')
  })

  it('registers the built-in flow template provider under deliveryFlowTemplateProvider (replaceable by the workflows owner)', async () => {
    const registrations: Record<string, { resolve: (container: { resolve: (name: string) => unknown }) => unknown }> = {}
    register({ register: (entries: typeof registrations) => Object.assign(registrations, entries) } as never)
    const provider = registrations.deliveryFlowTemplateProvider.resolve({ resolve: () => em }) as DeliveryFlowTemplateProvider
    expect(await provider.getTemplate(DEFAULT_FLOW_TEMPLATE.templateId, DEFAULT_FLOW_TEMPLATE.version)).toBe(DEFAULT_FLOW_TEMPLATE)
    expect(await provider.getTemplate(DEFAULT_FLOW_TEMPLATE.templateId, 2)).toBeNull()
  })

  it('throws an internal error when the scope is missing', async () => {
    const broken = [{ tenantId: TENANT_ID }, { organizationId: ORG_ID }, { tenantId: '', organizationId: ORG_ID }, null]
    for (const scope of broken) {
      await expect(queries.getAttempt(scope as never, TASK_ID, UNKNOWN_ATTEMPT_ID)).rejects.toThrow('[internal]')
      await expect(queries.buildTaskPackage(scope as never, TASK_ID, UNKNOWN_ATTEMPT_ID)).rejects.toThrow('[internal]')
      await expect(queries.listPendingDeliveries(scope as never)).rejects.toThrow('[internal]')
    }
  })

  it('getAttempt returns the attempt, and null for an unknown attempt, task or a foreign scope', async () => {
    const attempt = makeAttempt(UNKNOWN_ATTEMPT_ID)
    seedTask({ executionAttempts: [attempt] })
    expect(await queries.getAttempt(SCOPE, TASK_ID, attempt.attemptId)).toEqual(attempt)
    expect(await queries.getAttempt(SCOPE, TASK_ID, EVIDENCE_ID)).toBeNull()
    expect(await queries.getAttempt(SCOPE, SECOND_TASK_ID, attempt.attemptId)).toBeNull()
    expect(await queries.getAttempt({ ...SCOPE, organizationId: FOREIGN_ORG_ID }, TASK_ID, attempt.attemptId)).toBeNull()
    expect(await queries.getAttempt({ ...SCOPE, tenantId: FOREIGN_TENANT_ID }, TASK_ID, attempt.attemptId)).toBeNull()
    expectNoWrites()
  })

  it('buildTaskPackage returns TaskPackage v1 without writing and throws the frozen errors', async () => {
    const attempt = makeAttempt(UNKNOWN_ATTEMPT_ID)
    seedTask({ executionAttempts: [attempt] })
    const taskPackage = await queries.buildTaskPackage(SCOPE, TASK_ID, attempt.attemptId)
    expect(taskPackageV1Schema.safeParse(taskPackage).success).toBe(true)
    expect(taskPackage).toMatchObject({ taskId: TASK_ID, attemptId: attempt.attemptId })

    const unknown = await queries.buildTaskPackage(SCOPE, TASK_ID, EVIDENCE_ID).catch((error: unknown) => error)
    expect(isCrudHttpError(unknown) && unknown.status).toBe(404)
    const foreign = await queries
      .buildTaskPackage({ ...SCOPE, organizationId: FOREIGN_ORG_ID }, TASK_ID, attempt.attemptId)
      .catch((error: unknown) => error)
    expect(isCrudHttpError(foreign) && foreign.status).toBe(404)
    expectNoWrites()
  })

  it('listPendingDeliveries returns only pending rows of the given scope and honours the limit', async () => {
    const pending = pendingAttempt(UNKNOWN_ATTEMPT_ID)
    const delivered = { ...pendingAttempt('3d3d3d3d-3333-4333-8333-333333333334'), completionDelivery: 'delivered' as const }
    const manual = makeAttempt('3d3d3d3d-3333-4333-8333-333333333335', { state: 'result_received', resultEvidenceId: EVIDENCE_ID })
    seedTask({ executionAttempts: [delivered, pending] })
    seedTask({ id: SECOND_TASK_ID, executionAttempts: [manual] })
    seedTask({ id: THIRD_TASK_ID, organizationId: FOREIGN_ORG_ID, executionAttempts: [pendingAttempt('3d3d3d3d-3333-4333-8333-333333333336')] })
    seedTask({ id: '7c7c7c7c-7777-4777-8777-77777777777a', executionAttempts: [{ attemptId: 'broken' }] })
    seedTask({ id: '7c7c7c7c-7777-4777-8777-77777777777b', attemptNumber: 0, executionAttempts: [] })

    expect(await queries.listPendingDeliveries(SCOPE, { limit: 10 })).toEqual([
      {
        taskId: TASK_ID,
        attemptId: pending.attemptId,
        evidenceId: EVIDENCE_ID,
        workflowRef: pending.workflowRef,
        workflowStepId: 'await-result',
      },
    ])
    expect(await queries.listPendingDeliveries({ ...SCOPE, organizationId: FOREIGN_ORG_ID })).toHaveLength(1)
    expect(await queries.listPendingDeliveries({ ...SCOPE, tenantId: FOREIGN_TENANT_ID })).toEqual([])

    seedTask({ id: '7c7c7c7c-7777-4777-8777-77777777777c', executionAttempts: [pendingAttempt('3d3d3d3d-3333-4333-8333-333333333337')] })
    expect(await queries.listPendingDeliveries(SCOPE, { limit: 1 })).toHaveLength(1)
    expect(await queries.listPendingDeliveries(SCOPE)).toHaveLength(2)
    for (const limit of [0, -1, 1.5, Number.NaN]) expect(await queries.listPendingDeliveries(SCOPE, { limit })).toHaveLength(2)
    expectNoWrites()
  })

  it('listPendingDeliveries pages through every attempted task and caps the limit at 100', async () => {
    for (let index = 0; index < 320; index += 1) {
      const suffix = index.toString(16).padStart(4, '0')
      seedTask({
        id: `7c7c7c7c-7777-4777-8777-77777777${suffix}`,
        executionAttempts: index < 150 ? [] : [pendingAttempt(`3d3d3d3d-3333-4333-8333-33333333${suffix}`)],
      })
    }
    expect(await queries.listPendingDeliveries(SCOPE, { limit: 500 })).toHaveLength(100)
    expect(await queries.listPendingDeliveries(SCOPE, { limit: 3 })).toHaveLength(3)
    const calls = findMock.findWithDecryption.mock.calls
    expect(calls[0][3]).toEqual({ orderBy: { id: 'asc' }, limit: 200 })
    expect(calls[0][2]).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID, attemptNumber: { $gt: 0 } })
    expect(calls[1][3]).toEqual({ orderBy: { id: 'asc' }, limit: 200 })
    expect(calls[1][2]).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      attemptNumber: { $gt: 0 },
      id: { $gt: '7c7c7c7c-7777-4777-8777-7777777700c7' },
    })
  })

  it('listPendingDeliveries neither skips nor duplicates a task whose updatedAt changes mid-scan', async () => {
    const pendingIndexes = [5, 200, 319]
    const expectedAttemptIds: string[] = []
    for (let index = 0; index < 320; index += 1) {
      const suffix = index.toString(16).padStart(4, '0')
      const attemptId = `3d3d3d3d-3333-4333-8333-33333333${suffix}`
      if (pendingIndexes.includes(index)) expectedAttemptIds.push(attemptId)
      seedTask({
        id: `7c7c7c7c-7777-4777-8777-77777777${suffix}`,
        executionAttempts: pendingIndexes.includes(index) ? [pendingAttempt(attemptId)] : [],
      })
    }
    const original = findMock.findWithDecryption.getMockImplementation()
    if (!original) throw new Error('[internal] findWithDecryption mock has no implementation')
    const movedTask = routeState.store.tasks[5]
    findMock.findWithDecryption.mockImplementation(async (emArg, entity, where, options) => {
      const orderBy = Object.entries((options as unknown as { orderBy?: Record<string, 'asc' | 'desc'> } | undefined)?.orderBy ?? {})
      const rankOf = (value: unknown): number | string =>
        value instanceof Date ? value.getTime() : typeof value === 'number' ? value : String(value)
      const compareRows = (left: Row, right: Row): number => {
        for (const [key, direction] of orderBy) {
          const leftRank = rankOf(left[key])
          const rightRank = rankOf(right[key])
          if (leftRank === rightRank) continue
          const ordered =
            typeof leftRank === 'number' && typeof rightRank === 'number'
              ? Math.sign(leftRank - rightRank)
              : String(leftRank) < String(rightRank)
                ? -1
                : 1
          return direction === 'desc' ? -ordered : ordered
        }
        return 0
      }
      routeState.store.tasks.sort(compareRows)
      const page = await original(emArg, entity, where, options)
      movedTask.updatedAt = new Date('2026-09-19T12:00:00.000Z')
      return page
    })
    try {
      const pending = await queries.listPendingDeliveries(SCOPE)
      expect(pending.map((entry) => entry.attemptId)).toEqual(expectedAttemptIds)
      expect(new Set(pending.map((entry) => entry.attemptId)).size).toBe(pendingIndexes.length)
      expect(findMock.findWithDecryption).toHaveBeenCalledTimes(2)
    } finally {
      findMock.findWithDecryption.mockImplementation(original)
    }
  })
})
