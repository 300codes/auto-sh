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
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  DeliveryBaseline,
  DeliveryDecision,
  DeliveryEvidence,
  DeliveryProject,
  DeliveryTask,
} from '../../data/entities'
import { draftSpecV1Schema } from '../../data/validators'
import { reconcileAttempt, reserveAttempt } from '../../lib/attempts'
import { hashBaseline } from '../../lib/baseline'
import {
  DEFAULT_DELIVERY_LIMITS,
  deliveryErrorBodySchema,
  type BaselineContentV1,
  type ExecutionAttempt,
  type SourceRevision,
} from '../../lib/contracts'
import { loadBaselineContentFixture } from '../../lib/fixtures'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import { countCorrectionRounds, type TaskCommandResult } from '../tasks'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const FOREIGN_ORG_ID = '99999999-9999-4999-8999-999999999992'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-444444444445'
const BASELINE_ID = '55555555-5555-4555-8555-555555555555'
const OLD_BASELINE_ID = '55555555-5555-4555-8555-555555555556'
const OTHER_PROJECT_BASELINE_ID = '55555555-5555-4555-8555-555555555557'
const TASK_A = '66666666-6666-4666-8666-66666666666a'
const TASK_B = '66666666-6666-4666-8666-66666666666b'
const TASK_C = '66666666-6666-4666-8666-66666666666c'
const TASK_UNRELATED = '66666666-6666-4666-8666-66666666666d'
const TASK_OTHER_PROJECT = '66666666-6666-4666-8666-66666666666e'
const TASK_FOREIGN_ORG = '66666666-6666-4666-8666-66666666666f'
const ATTEMPT_ID = '77777777-7777-4777-8777-777777777777'
const ACTOR_ID = '88888888-8888-4888-8888-888888888888'
const NOW = '2026-09-19T10:00:00.000Z'
const UPDATED_AT = new Date('2026-09-19T09:00:00.000Z')
const STALE_UPDATED_AT = '2026-09-19T08:00:00.000Z'
const gitRevision: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
const reactProfile = TARGET_PROFILES[0]

type Row = Record<string, unknown>

type Store = {
  projects: DeliveryProject[]
  tasks: DeliveryTask[]
  baselines: DeliveryBaseline[]
  decisions: DeliveryDecision[]
  evidence: DeliveryEvidence[]
}

type EmMock = {
  fork: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
  transactional: jest.Mock
}

let store: Store

function rowsFor(entity: unknown): Row[] {
  if (entity === DeliveryProject) return store.projects as unknown as Row[]
  if (entity === DeliveryTask) return store.tasks as unknown as Row[]
  if (entity === DeliveryBaseline) return store.baselines as unknown as Row[]
  if (entity === DeliveryDecision) return store.decisions as unknown as Row[]
  if (entity === DeliveryEvidence) return store.evidence as unknown as Row[]
  throw new Error('[internal] unexpected entity in test store')
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (typeof expected === 'object' && expected !== null && '$in' in expected) {
      return (expected as { $in: unknown[] }).$in.includes(actual)
    }
    return actual === (expected ?? null)
  })
}

function getHandler<TInput, TResult>(id: string): CommandHandler<TInput, TResult> {
  const handler = commandRegistry.get(id)
  if (!handler) throw new Error(`[internal] command ${id} is not registered`)
  return handler as CommandHandler<TInput, TResult>
}

function makeHarness(options: { headers?: Record<string, string>; orgId?: string } = {}) {
  const em: EmMock = {
    fork: jest.fn(),
    create: jest.fn((_entity: unknown, data: Row) => ({ updatedAt: UPDATED_AT, executionAttempts: [], ...data })),
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
    request: new Request('http://localhost/api/delivery_os/tasks', { method: 'PUT', headers: options.headers }),
  }
  return { ctx, em }
}

function makeProject(overrides: Partial<DeliveryProject> = {}): DeliveryProject {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Customer portal',
    inputMode: 'from_brief',
    brief: null,
    targetProfileId: reactProfile.id,
    targetProfileVersion: reactProfile.version,
    repositoryRef: null,
    draftSpec: draftSpecV1Schema.parse({}),
    activeBaselineId: BASELINE_ID,
    limits: { ...DEFAULT_DELIVERY_LIMITS },
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryProject
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
    targetProfileId: reactProfile.id,
    targetProfileVersion: reactProfile.version,
    status: 'draft',
    statusReason: null,
    attemptNumber: 0,
    executionAttempts: [],
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryTask
}

function makeBaseline(content: BaselineContentV1, overrides: Partial<DeliveryBaseline> = {}): DeliveryBaseline {
  return {
    id: BASELINE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    version: 1,
    contentHash: hashBaseline(content),
    source: 'manual',
    content,
    attachmentIds: [],
    createdAt: UPDATED_AT,
    ...overrides,
  } as DeliveryBaseline
}

function makeDecision(kind: 'requirements' | 'design', baseline: DeliveryBaseline): DeliveryDecision {
  return {
    id: `dec-${kind}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: baseline.projectId,
    kind,
    subjectType: 'baseline',
    subjectId: baseline.id,
    subjectHash: baseline.contentHash,
    subjectVersion: baseline.version,
    verdict: 'approved',
    actorUserId: ACTOR_ID,
    decidedAt: new Date(NOW),
    createdAt: new Date(NOW),
  } as DeliveryDecision
}

function reservedRegister(): ExecutionAttempt[] {
  const result = reserveAttempt([], {
    idempotencyKey: 'key-1',
    payload: { mode: 'manual_handoff', baseRevision: gitRevision },
    mode: 'manual_handoff',
    baselineId: BASELINE_ID,
    baselineHash: 'b'.repeat(64),
    baseRevision: gitRevision,
    now: NOW,
    newAttemptId: ATTEMPT_ID,
  })
  if (!result.ok) throw new Error('[internal] fixture reservation failed')
  return result.register
}

function unknownRegister(): ExecutionAttempt[] {
  const result = reconcileAttempt(reservedRegister(), {
    attemptId: ATTEMPT_ID,
    resolution: 'unknown',
    note: 'Runner state is unknown after restart',
    observedAt: NOW,
    actorUserId: ACTOR_ID,
    now: NOW,
  })
  if (!result.ok) throw new Error('[internal] fixture reconciliation failed')
  return result.register
}

function seedApprovedProject(tasks: DeliveryTask[], content: BaselineContentV1 = loadBaselineContentFixture()): void {
  const baseline = makeBaseline(content)
  store = {
    projects: [makeProject()],
    tasks,
    baselines: [baseline],
    decisions: [makeDecision('requirements', baseline), makeDecision('design', baseline)],
    evidence: [],
  }
}

async function catchHttpError(run: () => unknown): Promise<CrudHttpError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof CrudHttpError) return error
    throw error
  }
  throw new Error('[internal] expected a CrudHttpError')
}

function expectFrozenBody(error: CrudHttpError, status: number, code: string): void {
  expect(error.status).toBe(status)
  expect(deliveryErrorBodySchema.safeParse(error.body).success).toBe(true)
  expect(error.body.code).toBe(code)
}

function detailCodes(error: CrudHttpError): string[] {
  return (error.body.details as Array<{ code: string }>).map((detail) => detail.code)
}

const create = getHandler<unknown, TaskCommandResult>('delivery_os.tasks.create')
const update = getHandler<unknown, TaskCommandResult>('delivery_os.tasks.update')
const remove = getHandler<unknown, TaskCommandResult>('delivery_os.tasks.delete')

const validCreateInput = {
  projectId: PROJECT_ID,
  source: 'manual',
  baselineId: BASELINE_ID,
  title: 'Category filter',
  acIds: ['AC-002'],
  allowedPaths: ['src/filters'],
}

beforeEach(() => {
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).find((row) => matches(row, where)) ?? null,
  )
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).filter((row) => matches(row, where)),
  )
  seedApprovedProject([makeTask()])
})

describe('delivery_os.tasks.create', () => {
  it('creates a draft task pinned to the project profile and emits task.updated', async () => {
    const { ctx, em } = makeHarness()
    const result = await create.execute(
      { ...validCreateInput, dependsOnTaskIds: [TASK_A], tenantId: 'ignored', status: 'verified' },
      ctx,
    )
    const created = em.create.mock.calls[0][1]
    expect(em.create.mock.calls[0][0]).toBe(DeliveryTask)
    expect(created).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      baselineId: BASELINE_ID,
      status: 'draft',
      dependsOnTaskIds: [TASK_A],
      targetProfileId: reactProfile.id,
      targetProfileVersion: reactProfile.version,
    })
    expect(result).toMatchObject({ projectId: PROJECT_ID, status: 'draft', taskId: created.id })
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledWith(
      'delivery_os.task.updated',
      expect.objectContaining({ projectId: PROJECT_ID, taskId: created.id, status: 'draft', statusReason: null }),
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }),
    )
  })

  it('locks the project row before the task rows', async () => {
    const { ctx } = makeHarness()
    await create.execute(validCreateInput, ctx)
    const lockedEntities = [...mockFindOneWithDecryption.mock.calls, ...mockFindWithDecryption.mock.calls]
      .filter((call) => call[3]?.lockMode === LockMode.PESSIMISTIC_WRITE)
      .map((call) => call[1])
    expect(lockedEntities).toEqual([DeliveryProject, DeliveryTask])
  })

  it('rejects a baseline of another project with 422 foreign_reference and writes nothing', async () => {
    store.baselines.push(
      makeBaseline(loadBaselineContentFixture(), { id: OTHER_PROJECT_BASELINE_ID, projectId: OTHER_PROJECT_ID }),
    )
    const { ctx, em } = makeHarness()
    const error = await catchHttpError(() =>
      create.execute({ ...validCreateInput, baselineId: OTHER_PROJECT_BASELINE_ID }, ctx),
    )
    expectFrozenBody(error, 422, 'foreign_reference')
    expect(detailCodes(error)).toEqual(['foreign_baseline'])
    expect(em.create).not.toHaveBeenCalled()
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('rejects an acceptance criterion the baseline does not contain', async () => {
    const { ctx, em } = makeHarness()
    const error = await catchHttpError(() => create.execute({ ...validCreateInput, acIds: ['AC-001', 'AC-999'] }, ctx))
    expectFrozenBody(error, 422, 'unknown_ac')
    expect(error.body.details).toEqual([expect.objectContaining({ path: 'acIds.AC-999', code: 'unknown_ac' })])
    expect(em.create).not.toHaveBeenCalled()
  })

  it('rejects a dependency from another project and hides tasks of another organization', async () => {
    store.tasks.push(
      makeTask({ id: TASK_OTHER_PROJECT, projectId: OTHER_PROJECT_ID }),
      makeTask({ id: TASK_FOREIGN_ORG, organizationId: FOREIGN_ORG_ID }),
    )
    const { ctx } = makeHarness()
    const otherProject = await catchHttpError(() =>
      create.execute({ ...validCreateInput, dependsOnTaskIds: [TASK_OTHER_PROJECT] }, ctx),
    )
    expectFrozenBody(otherProject, 422, 'foreign_dependency')
    expect(detailCodes(otherProject)).toEqual(['other_project'])
    const foreignOrg = await catchHttpError(() =>
      create.execute({ ...validCreateInput, dependsOnTaskIds: [TASK_FOREIGN_ORG] }, ctx),
    )
    expectFrozenBody(foreignOrg, 422, 'foreign_dependency')
    expect(detailCodes(foreignOrg)).toEqual(['unknown_dependency'])
  })

  it('rejects paths outside the profile roots and the plan_proposal source', async () => {
    const { ctx } = makeHarness()
    const path = await catchHttpError(() => create.execute({ ...validCreateInput, allowedPaths: ['server/secret'] }, ctx))
    expectFrozenBody(path, 422, 'path_not_allowed')
    const source = await catchHttpError(() =>
      create.execute({ projectId: PROJECT_ID, source: 'plan_proposal', manifest: {} }, ctx),
    )
    expectFrozenBody(source, 400, 'validation_failed')
  })

  it('answers 404 for a project of another organization', async () => {
    const { ctx } = makeHarness({ orgId: FOREIGN_ORG_ID })
    const error = await catchHttpError(() => create.execute(validCreateInput, ctx))
    expectFrozenBody(error, 404, 'not_found')
  })
})

describe('delivery_os.tasks.update — graph and scope', () => {
  it('rejects a dependency cycle with 422 cycle and keeps the task unchanged', async () => {
    store.tasks.push(makeTask({ id: TASK_B, dependsOnTaskIds: [TASK_A] }), makeTask({ id: TASK_C, dependsOnTaskIds: [TASK_B] }))
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, dependsOnTaskIds: [TASK_C] }, ctx))
    expectFrozenBody(error, 422, 'cycle')
    expect(store.tasks[0].dependsOnTaskIds).toEqual([])
    const self = await catchHttpError(() => update.execute({ id: TASK_A, dependsOnTaskIds: [TASK_A] }, ctx))
    expectFrozenBody(self, 422, 'cycle')
  })

  it('rejects a dependency pinned to another baseline', async () => {
    store.tasks.push(makeTask({ id: TASK_B, baselineId: OLD_BASELINE_ID }))
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, dependsOnTaskIds: [TASK_B] }, ctx))
    expectFrozenBody(error, 422, 'foreign_dependency')
    expect(detailCodes(error)).toEqual(['other_baseline'])
  })

  it('rejects an unknown acceptance criterion on edit', async () => {
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, acIds: ['AC-404'] }, ctx))
    expectFrozenBody(error, 422, 'unknown_ac')
  })

  it('refuses scope edits once the task is ready or has had an attempt, but still allows a title edit', async () => {
    store.tasks[0].status = 'ready'
    const { ctx } = makeHarness()
    const ready = await catchHttpError(() => update.execute({ id: TASK_A, acIds: ['AC-002'] }, ctx))
    expectFrozenBody(ready, 409, 'invalid_transition')
    expect(detailCodes(ready)).toEqual(['task_not_editable'])

    store.tasks[0].status = 'blocked'
    store.tasks[0].executionAttempts = reservedRegister().map((attempt) => ({ ...attempt, state: 'closed' as const }))
    const attempted = await catchHttpError(() => update.execute({ id: TASK_A, allowedPaths: ['src/other'] }, ctx))
    expectFrozenBody(attempted, 409, 'invalid_transition')

    const result = await update.execute({ id: TASK_A, title: 'Service list v2' }, ctx)
    expect(store.tasks[0].title).toBe('Service list v2')
    expect(result.status).toBe('blocked')
  })
})

describe('delivery_os.tasks.update — status gate', () => {
  it('moves draft to ready when both decisions, a render and required tests exist on the active baseline', async () => {
    const { ctx } = makeHarness()
    const result = await update.execute({ id: TASK_A, status: 'ready' }, ctx)
    expect(result).toMatchObject({ taskId: TASK_A, status: 'ready', propagatedTaskIds: [] })
    expect(store.tasks[0].status).toBe('ready')
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitDeliveryOsEvent.mock.calls[0][1]).toMatchObject({ taskId: TASK_A, status: 'ready' })
  })

  it('refuses ready without both baseline decisions', async () => {
    store.decisions = store.decisions.filter((decision) => decision.kind !== 'design')
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, status: 'ready' }, ctx))
    expectFrozenBody(error, 422, 'baseline_not_approved')
    expect(detailCodes(error)).toEqual(['design_decision_missing'])
    expect(store.tasks[0].status).toBe('draft')
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('refuses ready without a render', async () => {
    seedApprovedProject([makeTask()], { ...loadBaselineContentFixture(), screens: [] })
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, status: 'ready' }, ctx))
    expectFrozenBody(error, 422, 'missing_render')
  })

  it('refuses ready when an acceptance criterion has no required tests', async () => {
    const content = loadBaselineContentFixture()
    seedApprovedProject([makeTask()], { ...content, acTestMap: { 'AC-002': content.acTestMap['AC-002'] } })
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, status: 'ready' }, ctx))
    expectFrozenBody(error, 422, 'missing_required_tests')
  })

  it('refuses ready on a baseline that is not the active one', async () => {
    store.projects[0].activeBaselineId = OLD_BASELINE_ID
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, status: 'ready' }, ctx))
    expectFrozenBody(error, 422, 'baseline_not_approved')
    expect(detailCodes(error)).toContain('baseline_not_active')
  })

  it('checks readiness against the acceptance criteria sent in the same request', async () => {
    const content = loadBaselineContentFixture()
    seedApprovedProject([makeTask()], { ...content, acTestMap: { 'AC-001': content.acTestMap['AC-001'] } })
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, acIds: ['AC-002'], status: 'ready' }, ctx))
    expectFrozenBody(error, 422, 'missing_required_tests')
    expect(store.tasks[0].acIds).toEqual(['AC-001'])
  })

  it.each(['verified', 'executing', 'changes_requested'])(
    'rejects %s from input with 409 invalid_transition',
    async (status) => {
      store.tasks[0].status = 'awaiting_review'
      const { ctx } = makeHarness()
      const error = await catchHttpError(() => update.execute({ id: TASK_A, status }, ctx))
      expectFrozenBody(error, 409, 'invalid_transition')
      expect(detailCodes(error)).toEqual(['not_user_settable'])
      expect(store.tasks[0].status).toBe('awaiting_review')
    },
  )

  it('refuses ready while an ancestor is blocked', async () => {
    store.tasks.push(makeTask({ id: TASK_B, status: 'blocked' }))
    store.tasks[0].dependsOnTaskIds = [TASK_B]
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, status: 'ready' }, ctx))
    expectFrozenBody(error, 409, 'invalid_transition')
    expect(detailCodes(error)).toEqual(['dependency_blocked'])
  })

  it('never lets a status update release a live or unknown run, and keeps the reconciliation reason', async () => {
    store.tasks[0].status = 'executing'
    store.tasks[0].executionAttempts = reservedRegister()
    const { ctx } = makeHarness()
    const live = await catchHttpError(() => update.execute({ id: TASK_A, status: 'ready' }, ctx))
    expectFrozenBody(live, 409, 'attempt_active')

    store.tasks[0].status = 'blocked'
    store.tasks[0].statusReason = 'reconciliation_required'
    store.tasks[0].executionAttempts = unknownRegister()
    const unknown = await catchHttpError(() => update.execute({ id: TASK_A, status: 'draft' }, ctx))
    expectFrozenBody(unknown, 409, 'reconciliation_required')
    expect(store.tasks[0]).toMatchObject({ status: 'blocked', statusReason: 'reconciliation_required' })
  })
  it('keeps a task with an accepted result inside the review flow', async () => {
    store.tasks[0].status = 'blocked'
    store.tasks[0].executionAttempts = reservedRegister().map((attempt) => ({
      ...attempt,
      state: 'closed' as const,
      outcome: 'result_accepted' as const,
      resultEvidenceId: ATTEMPT_ID,
      closedAt: NOW,
    }))
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_A, status: 'ready' }, ctx))
    expectFrozenBody(error, 409, 'invalid_transition')
    expect(detailCodes(error)).toEqual(['result_awaits_review'])
    expect(store.tasks[0].status).toBe('blocked')
    const cancelled = await update.execute({ id: TASK_A, status: 'cancelled' }, ctx)
    expect(cancelled.status).toBe('cancelled')
  })

  it('keeps correction_limit_reached when the blocked task is cancelled and leaves descendants blocked', async () => {
    store.tasks[0].status = 'blocked'
    store.tasks[0].statusReason = 'correction_limit_reached'
    store.tasks.push(makeTask({ id: TASK_B, status: 'blocked', statusReason: 'dependency_blocked', dependsOnTaskIds: [TASK_A] }))
    const { ctx } = makeHarness()
    const result = await update.execute({ id: TASK_A, status: 'cancelled' }, ctx)
    expect(result.propagatedTaskIds).toEqual([])
    expect(store.tasks[0]).toMatchObject({ status: 'cancelled', statusReason: 'correction_limit_reached' })
    expect(store.tasks[1]).toMatchObject({ status: 'blocked', statusReason: 'dependency_blocked' })
  })

  it('refuses to return a dependency-blocked task to draft while its ancestor is still blocked', async () => {
    store.tasks[0].status = 'blocked'
    store.tasks.push(makeTask({ id: TASK_B, status: 'blocked', statusReason: 'dependency_blocked', dependsOnTaskIds: [TASK_A] }))
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: TASK_B, status: 'draft' }, ctx))
    expectFrozenBody(error, 409, 'invalid_transition')
    expect(detailCodes(error)).toEqual(['dependency_blocked'])
    expect(store.tasks[1]).toMatchObject({ status: 'blocked', statusReason: 'dependency_blocked' })
  })
})

describe('delivery_os.tasks.update — propagation', () => {
  function seedChain(): void {
    seedApprovedProject([
      makeTask({ id: TASK_A, status: 'ready' }),
      makeTask({ id: TASK_B, status: 'ready', dependsOnTaskIds: [TASK_A] }),
      makeTask({ id: TASK_C, status: 'draft', dependsOnTaskIds: [TASK_B] }),
      makeTask({ id: TASK_UNRELATED, status: 'ready' }),
    ])
  }

  it('blocks descendants only, in the same transaction, and emits one event per changed task', async () => {
    seedChain()
    const { ctx, em } = makeHarness()
    const result = await update.execute({ id: TASK_B, status: 'blocked' }, ctx)
    expect(result.propagatedTaskIds).toEqual([TASK_C])
    const byId = new Map(store.tasks.map((task) => [task.id, task]))
    expect(byId.get(TASK_A)).toMatchObject({ status: 'ready', statusReason: null })
    expect(byId.get(TASK_B)).toMatchObject({ status: 'blocked', statusReason: null })
    expect(byId.get(TASK_C)).toMatchObject({ status: 'blocked', statusReason: 'dependency_blocked' })
    expect(byId.get(TASK_UNRELATED)).toMatchObject({ status: 'ready' })
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(mockEmitDeliveryOsEvent.mock.calls.map((call) => (call[1] as { taskId: string }).taskId)).toEqual([TASK_B, TASK_C])
  })

  it('returns dependency-blocked descendants to draft when the root block is lifted', async () => {
    seedChain()
    const { ctx } = makeHarness()
    await update.execute({ id: TASK_A, status: 'blocked' }, ctx)
    mockEmitDeliveryOsEvent.mockClear()
    const result = await update.execute({ id: TASK_A, status: 'draft' }, ctx)
    expect(result.propagatedTaskIds.sort()).toEqual([TASK_B, TASK_C].sort())
    const byId = new Map(store.tasks.map((task) => [task.id, task]))
    expect(byId.get(TASK_B)).toMatchObject({ status: 'draft', statusReason: null })
    expect(byId.get(TASK_C)).toMatchObject({ status: 'draft', statusReason: null })
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(3)
  })
})

describe('delivery_os.tasks.update — lock and scope', () => {
  it('answers the platform 409 for a stale version and accepts the current one', async () => {
    const stale = makeHarness({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } })
    const error = await catchHttpError(() => update.execute({ id: TASK_A, title: 'Stale edit' }, stale.ctx))
    expect(error.status).toBe(409)
    expect(error.body.code).toBe('optimistic_lock_conflict')
    expect(store.tasks[0].title).toBe('Service list')

    const current = makeHarness({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() } })
    await update.execute({ id: TASK_A, title: 'Fresh edit' }, current.ctx)
    expect(store.tasks[0].title).toBe('Fresh edit')
  })

  it('answers 404 for a task of another organization and for a task of an archived project', async () => {
    const foreign = makeHarness({ orgId: FOREIGN_ORG_ID })
    const foreignError = await catchHttpError(() => update.execute({ id: TASK_A, title: 'Nope' }, foreign.ctx))
    expectFrozenBody(foreignError, 404, 'not_found')

    store.projects[0].deletedAt = new Date(NOW)
    const { ctx } = makeHarness()
    const archived = await catchHttpError(() => update.execute({ id: TASK_A, title: 'Nope' }, ctx))
    expectFrozenBody(archived, 404, 'not_found')
  })

  it('rejects a malformed id with the frozen validation body', async () => {
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => update.execute({ id: 'not-a-uuid', title: 'x' }, ctx))
    expectFrozenBody(error, 400, 'validation_failed')
  })
})

describe('delivery_os.tasks.delete', () => {
  it('soft-deletes a task without attempts or dependents', async () => {
    const { ctx } = makeHarness()
    const result = await remove.execute({ query: { id: TASK_A } }, ctx)
    expect(result.taskId).toBe(TASK_A)
    expect(store.tasks[0].deletedAt).toBeInstanceOf(Date)
  })

  it('emits task.updated for the archived task so live subscribers refresh the card', async () => {
    const { ctx } = makeHarness()
    await remove.execute({ id: TASK_A }, ctx)
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledWith(
      'delivery_os.task.updated',
      expect.objectContaining({ projectId: PROJECT_ID, taskId: TASK_A }),
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }),
    )
  })

  it('blocks the archive on an active attempt and on an unknown attempt', async () => {
    store.tasks[0].executionAttempts = reservedRegister()
    const { ctx } = makeHarness()
    const active = await catchHttpError(() => remove.execute({ id: TASK_A }, ctx))
    expectFrozenBody(active, 409, 'attempt_active')
    expect(detailCodes(active)).toEqual(['attempt_reserved'])

    store.tasks[0].executionAttempts = unknownRegister()
    const unknown = await catchHttpError(() => remove.execute({ id: TASK_A }, ctx))
    expectFrozenBody(unknown, 409, 'reconciliation_required')
    expect(store.tasks[0].deletedAt).toBeNull()
  })

  it('refuses while a live task depends on it and allows it once the dependent is archived', async () => {
    store.tasks.push(makeTask({ id: TASK_B, title: 'Filter', dependsOnTaskIds: [TASK_A] }))
    const { ctx } = makeHarness()
    const error = await catchHttpError(() => remove.execute({ id: TASK_A }, ctx))
    expectFrozenBody(error, 422, 'foreign_dependency')
    expect(error.body.details).toEqual([
      expect.objectContaining({ path: `tasks.${TASK_B}.dependsOnTaskIds`, code: 'has_dependents' }),
    ])

    store.tasks[1].deletedAt = new Date(NOW)
    await remove.execute({ id: TASK_A }, ctx)
    expect(store.tasks[0].deletedAt).toBeInstanceOf(Date)
  })

  it('answers the platform 409 for a stale version and 404 for a foreign organization', async () => {
    const stale = makeHarness({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } })
    const conflict = await catchHttpError(() => remove.execute({ id: TASK_A }, stale.ctx))
    expect(conflict.status).toBe(409)
    expect(conflict.body.code).toBe('optimistic_lock_conflict')

    const foreign = makeHarness({ orgId: FOREIGN_ORG_ID })
    const notFound = await catchHttpError(() => remove.execute({ id: TASK_A }, foreign.ctx))
    expectFrozenBody(notFound, 404, 'not_found')
  })
})

describe('countCorrectionRounds', () => {
  it('counts only changes_requested reviews that are not manual checks', () => {
    expect(
      countCorrectionRounds([
        { kind: 'review', payload: { verdict: 'changes_requested' } },
        { kind: 'review', payload: { verdict: 'approved' } },
        { kind: 'review', payload: { verdict: 'changes_requested', manualCheckId: 'MC-1' } },
        { kind: 'test', payload: { verdict: 'changes_requested' } },
      ]),
    ).toBe(1)
  })

  it('treats a null manualCheckId like an absent one, so both count as correction rounds', () => {
    expect(
      countCorrectionRounds([
        { kind: 'review', payload: { verdict: 'changes_requested', manualCheckId: null } },
        { kind: 'review', payload: { verdict: 'changes_requested', manualCheckId: undefined } },
        { kind: 'review', payload: { verdict: 'changes_requested', manualCheckId: 'MC-1' } },
      ]),
    ).toBe(2)
  })
})
