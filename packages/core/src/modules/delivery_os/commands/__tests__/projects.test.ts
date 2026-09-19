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
import { DeliveryProject, DeliveryTask } from '../../data/entities'
import { draftSpecV1Schema } from '../../data/validators'
import { isArchiveBlocked, reconcileAttempt, requestCancellation, reserveAttempt } from '../../lib/attempts'
import {
  DEFAULT_DELIVERY_LIMITS,
  deliveryErrorBodySchema,
  type ExecutionAttempt,
  type SourceRevision,
  type TaskStatus,
} from '../../lib/contracts'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import { checkProjectArchivable } from '../projects'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const FOREIGN_TENANT_ID = '99999999-9999-4999-8999-999999999991'
const FOREIGN_ORG_ID = '99999999-9999-4999-8999-999999999992'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const BASELINE_ID = '55555555-5555-4555-8555-555555555555'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const ATTEMPT_ID = '77777777-7777-4777-8777-777777777777'
const ACTOR_ID = '88888888-8888-4888-8888-888888888888'
const NOW = '2026-09-19T10:00:00.000Z'
const UPDATED_AT = new Date('2026-09-19T09:00:00.000Z')
const STALE_UPDATED_AT = '2026-09-19T08:00:00.000Z'
const gitRevision: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
const knownProfile = TARGET_PROFILES[0]

type EmMock = {
  fork: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
  remove: jest.Mock
  nativeDelete: jest.Mock
  transactional: jest.Mock
}

type Harness = {
  ctx: CommandRuntimeContext
  em: EmMock
  markOrmEntityChange: jest.Mock
}

function getHandler<TInput, TResult>(id: string): CommandHandler<TInput, TResult> {
  const handler = commandRegistry.get(id)
  if (!handler) throw new Error(`[internal] command ${id} is not registered`)
  return handler as CommandHandler<TInput, TResult>
}

function makeHarness(options: { headers?: Record<string, string>; auth?: CommandRuntimeContext['auth'] } = {}): Harness {
  const em: EmMock = {
    fork: jest.fn(),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: PROJECT_ID, ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    remove: jest.fn(),
    nativeDelete: jest.fn(),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => work(em))
  const markOrmEntityChange = jest.fn()
  const services: Record<string, unknown> = { em, dataEngine: { markOrmEntityChange } }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name in services) return services[name]
      throw new Error(`[internal] ${name} is not registered`)
    }),
  }
  const ctx: CommandRuntimeContext = {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: options.auth === undefined ? { sub: ACTOR_ID, tenantId: TENANT_ID, orgId: ORG_ID } : options.auth,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: new Request('http://localhost/api/delivery_os/projects', { method: 'PUT', headers: options.headers }),
  }
  return { ctx, em, markOrmEntityChange }
}

function makeProject(overrides: Partial<DeliveryProject> = {}): DeliveryProject {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Customer portal',
    inputMode: 'from_brief',
    brief: 'Build a list and a form',
    targetProfileId: knownProfile.id,
    targetProfileVersion: knownProfile.version,
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
    id: TASK_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    status: 'ready' as TaskStatus,
    statusReason: null,
    executionAttempts: [],
    deletedAt: null,
    ...overrides,
  } as DeliveryTask
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

function cancelRequestedRegister(): ExecutionAttempt[] {
  const result = requestCancellation(reservedRegister(), { attemptId: ATTEMPT_ID, now: NOW })
  if (!result.ok) throw new Error('[internal] fixture cancellation failed')
  return result.register
}

function reconciledRegister(resolution: 'unknown' | 'not_started'): ExecutionAttempt[] {
  const result = reconcileAttempt(reservedRegister(), {
    attemptId: ATTEMPT_ID,
    resolution,
    note: 'Checked the runner after restart',
    observedAt: NOW,
    actorUserId: ACTOR_ID,
    now: NOW,
  })
  if (!result.ok) throw new Error('[internal] fixture reconciliation failed')
  return result.register
}

async function catchHttpError(run: () => Promise<unknown>): Promise<CrudHttpError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof CrudHttpError) return error
    throw error
  }
  throw new Error('[internal] expected a CrudHttpError')
}

const validCreateInput = {
  name: 'Customer portal',
  inputMode: 'from_brief',
  brief: 'Build a list and a form',
  targetProfileId: knownProfile.id,
}

const validDraft = {
  requirements: [{ id: 'REQ-1', title: 'List customers', description: 'Shows customers' }],
  acceptanceCriteria: [
    { id: 'AC-1', requirementId: 'REQ-1', description: 'The list shows ten rows' },
    { id: 'AC-2', requirementId: 'REQ-1', description: 'The list can be filtered' },
  ],
}

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockReset()
  mockEmitDeliveryOsEvent.mockClear()
})

describe('delivery_os.projects.create', () => {
  const create = getHandler<unknown, { projectId: string }>('delivery_os.projects.create')

  it('stores the project under the session scope and ignores tenant and organization from the body', async () => {
    const { ctx, em } = makeHarness()
    const result = await create.execute(
      { ...validCreateInput, tenantId: FOREIGN_TENANT_ID, organizationId: FOREIGN_ORG_ID },
      ctx,
    )
    expect(result).toEqual({ projectId: PROJECT_ID })
    const created = em.create.mock.calls[0][1]
    expect(em.create.mock.calls[0][0]).toBe(DeliveryProject)
    expect(created.tenantId).toBe(TENANT_ID)
    expect(created.organizationId).toBe(ORG_ID)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('fills default limits, the newest profile version, an empty v1 draft and no active baseline', async () => {
    const { ctx, em } = makeHarness()
    await create.execute(validCreateInput, ctx)
    const created = em.create.mock.calls[0][1]
    const newestVersion = Math.max(
      ...TARGET_PROFILES.filter((profile) => profile.id === knownProfile.id).map((profile) => profile.version),
    )
    expect(created.limits).toEqual(DEFAULT_DELIVERY_LIMITS)
    expect(created.targetProfileVersion).toBe(newestVersion)
    expect(created.draftSpec).toEqual(draftSpecV1Schema.parse({}))
    expect(created.activeBaselineId).toBeNull()
  })

  it('keeps an explicit known version and merges partial limits over the defaults', async () => {
    const { ctx, em } = makeHarness()
    await create.execute(
      { ...validCreateInput, targetProfileVersion: knownProfile.version, limits: { maxCorrectionRounds: 1 } },
      ctx,
    )
    const created = em.create.mock.calls[0][1]
    expect(created.targetProfileVersion).toBe(knownProfile.version)
    expect(created.limits).toEqual({ ...DEFAULT_DELIVERY_LIMITS, maxCorrectionRounds: 1 })
  })

  it('rejects an unknown profile id and an unknown version with 422 and writes nothing', async () => {
    const { ctx, em } = makeHarness()
    const unknownId = await catchHttpError(() => create.execute({ ...validCreateInput, targetProfileId: 'angular' }, ctx))
    expect(unknownId.status).toBe(422)
    expect(unknownId.body.code).toBe('unknown_target_profile')
    expect(unknownId.body.details).toEqual([{ path: 'targetProfileId', code: 'unknown_target_profile' }])
    const unknownVersion = await catchHttpError(() =>
      create.execute({ ...validCreateInput, targetProfileVersion: 999 }, ctx),
    )
    expect(unknownVersion.status).toBe(422)
    expect(unknownVersion.body.details).toEqual([{ path: 'targetProfileVersion', code: 'unknown_target_profile' }])
    expect(deliveryErrorBodySchema.safeParse(unknownVersion.body).success).toBe(true)
    expect(em.create).not.toHaveBeenCalled()
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('emits project.created once with trusted scope and marks the index side effect', async () => {
    const { ctx, markOrmEntityChange } = makeHarness()
    await create.execute(validCreateInput, ctx)
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledWith(
      'delivery_os.project.created',
      { projectId: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(markOrmEntityChange).toHaveBeenCalledTimes(1)
    expect(markOrmEntityChange.mock.calls[0][0]).toMatchObject({
      action: 'created',
      identifiers: { id: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      indexer: { entityType: 'delivery_os:delivery_project' },
    })
    expect(markOrmEntityChange.mock.calls[0][0].events).toBeUndefined()
  })

  it('answers 400 validation_failed for a malformed body and emits nothing', async () => {
    const { ctx, em } = makeHarness()
    const httpError = await catchHttpError(() => create.execute({ ...validCreateInput, name: '' }, ctx))
    expect(httpError.status).toBe(400)
    expect(httpError.body.code).toBe('validation_failed')
    expect(em.create).not.toHaveBeenCalled()
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('answers 403 without a session tenant', async () => {
    const { ctx, em } = makeHarness({ auth: null })
    const httpError = await catchHttpError(() => create.execute(validCreateInput, ctx))
    expect(httpError.status).toBe(403)
    expect(httpError.body.code).toBe('forbidden')
    expect(em.create).not.toHaveBeenCalled()
  })

  it('builds an audit entry scoped to the project', async () => {
    const { ctx } = makeHarness()
    mockFindOneWithDecryption.mockResolvedValueOnce(makeProject())
    const after = await create.captureAfter?.(validCreateInput, { projectId: PROJECT_ID }, ctx)
    const log = await create.buildLog?.({ input: validCreateInput, result: { projectId: PROJECT_ID }, ctx, snapshots: { after } })
    expect(log).toMatchObject({
      resourceKind: 'delivery_os.project',
      resourceId: PROJECT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })
})

describe('delivery_os.projects.update', () => {
  const update = getHandler<unknown, { projectId: string }>('delivery_os.projects.update')

  it('replaces the whole draft and leaves baseline, profile and scope untouched', async () => {
    const { ctx, em, markOrmEntityChange } = makeHarness()
    const project = makeProject({ draftSpec: draftSpecV1Schema.parse({ planSummary: 'Old plan' }) })
    mockFindOneWithDecryption.mockResolvedValueOnce(project)
    const result = await update.execute(
      { id: PROJECT_ID, name: 'Renamed', draftSpec: validDraft, tenantId: FOREIGN_TENANT_ID, activeBaselineId: null },
      ctx,
    )
    expect(result).toEqual({ projectId: PROJECT_ID })
    expect(project.name).toBe('Renamed')
    expect(project.draftSpec).toEqual(draftSpecV1Schema.parse(validDraft))
    expect(project.draftSpec.planSummary).toBeNull()
    expect(project.activeBaselineId).toBe(BASELINE_ID)
    expect(project.tenantId).toBe(TENANT_ID)
    expect(project.targetProfileVersion).toBe(knownProfile.version)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(markOrmEntityChange.mock.calls[0][0]).toMatchObject({ action: 'updated' })
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('loads the project inside the session scope with a row lock', async () => {
    const { ctx } = makeHarness()
    mockFindOneWithDecryption.mockResolvedValueOnce(makeProject())
    await update.execute({ id: PROJECT_ID, brief: null }, ctx)
    const [, entity, where, options, scope] = mockFindOneWithDecryption.mock.calls[0]
    expect(entity).toBe(DeliveryProject)
    expect(where).toEqual({ id: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null })
    expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('merges partial limits over the stored limits', async () => {
    const { ctx } = makeHarness()
    const project = makeProject({ limits: { maxParallelTasks: 4, maxCorrectionRounds: 2, attemptTimeoutMinutes: 30 } })
    mockFindOneWithDecryption.mockResolvedValueOnce(project)
    await update.execute({ id: PROJECT_ID, limits: { maxCorrectionRounds: 0 } }, ctx)
    expect(project.limits).toEqual({ maxParallelTasks: 4, maxCorrectionRounds: 0, attemptTimeoutMinutes: 30 })
  })

  it('rejects duplicate acceptance-criterion ids with 422 and keeps the stored draft', async () => {
    const { ctx, em } = makeHarness()
    const duplicated = {
      ...validDraft,
      acceptanceCriteria: [validDraft.acceptanceCriteria[0], { ...validDraft.acceptanceCriteria[1], id: 'AC-1' }],
    }
    const httpError = await catchHttpError(() => update.execute({ id: PROJECT_ID, draftSpec: duplicated }, ctx))
    expect(httpError.status).toBe(422)
    expect(httpError.body.code).toBe('duplicate_stable_id')
    expect(httpError.body.details[0].path).toBe('draftSpec.acceptanceCriteria.1.id')
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('rejects a comment anchor outside 0–1 and accepts one inside', async () => {
    const { ctx } = makeHarness()
    const comment = { id: 'C-1', screenAttachmentId: null, body: 'Move the button', status: 'open' }
    const outside = await catchHttpError(() =>
      update.execute({ id: PROJECT_ID, draftSpec: { ...validDraft, comments: [{ ...comment, anchor: { x: 1.2, y: 0.5 } }] } }, ctx),
    )
    expect(outside.status).toBe(422)
    expect(outside.body.code).toBe('invalid_comment_anchor')
    const project = makeProject()
    mockFindOneWithDecryption.mockResolvedValueOnce(project)
    await update.execute({ id: PROJECT_ID, draftSpec: { ...validDraft, comments: [{ ...comment, anchor: { x: 1, y: 0 } }] } }, ctx)
    expect(project.draftSpec.comments).toHaveLength(1)
  })

  it('answers 404 not_found for an id outside the session scope', async () => {
    const { ctx, markOrmEntityChange } = makeHarness()
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const httpError = await catchHttpError(() => update.execute({ id: PROJECT_ID, name: 'Renamed' }, ctx))
    expect(httpError.status).toBe(404)
    expect(httpError.body).toEqual({ error: 'Not found', code: 'not_found', details: [{ path: 'projectId', code: 'not_found' }] })
    expect(markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('rejects a stale updatedAt with the platform 409 and changes nothing', async () => {
    const { ctx, markOrmEntityChange } = makeHarness({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } })
    const project = makeProject()
    mockFindOneWithDecryption.mockResolvedValueOnce(project)
    const httpError = await catchHttpError(() => update.execute({ id: PROJECT_ID, name: 'Renamed' }, ctx))
    expect(httpError.status).toBe(409)
    expect(httpError.body.code).toBe('optimistic_lock_conflict')
    expect(httpError.body.currentUpdatedAt).toBe(UPDATED_AT.toISOString())
    expect(project.name).toBe('Customer portal')
    expect(markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('accepts a matching updatedAt and a missing header', async () => {
    const matching = makeHarness({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() } })
    const first = makeProject()
    mockFindOneWithDecryption.mockResolvedValueOnce(first)
    await update.execute({ id: PROJECT_ID, name: 'Renamed' }, matching.ctx)
    expect(first.name).toBe('Renamed')
    const withoutHeader = makeHarness()
    const second = makeProject()
    mockFindOneWithDecryption.mockResolvedValueOnce(second)
    await update.execute({ id: PROJECT_ID, name: 'Renamed again' }, withoutHeader.ctx)
    expect(second.name).toBe('Renamed again')
  })

  it('reports a concurrently archived project as a conflict when the client sent a version', async () => {
    const { ctx } = makeHarness({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() } })
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const httpError = await catchHttpError(() => update.execute({ id: PROJECT_ID, name: 'Renamed' }, ctx))
    expect(httpError.status).toBe(409)
    expect(httpError.body.code).toBe('optimistic_lock_conflict')
  })

  it('records before and after snapshots with the changed fields', async () => {
    const { ctx } = makeHarness()
    mockFindOneWithDecryption.mockResolvedValueOnce(makeProject())
    const prepared = await update.prepare?.({ id: PROJECT_ID, name: 'Renamed' }, ctx)
    mockFindOneWithDecryption.mockResolvedValueOnce(makeProject({ name: 'Renamed' }))
    const after = await update.captureAfter?.({ id: PROJECT_ID }, { projectId: PROJECT_ID }, ctx)
    const log = await update.buildLog?.({
      input: { id: PROJECT_ID },
      result: { projectId: PROJECT_ID },
      ctx,
      snapshots: { before: prepared?.before, after },
    })
    expect(log?.changes).toEqual({ name: { from: 'Customer portal', to: 'Renamed' } })
    expect(log?.resourceKind).toBe('delivery_os.project')
  })
})

describe('delivery_os.projects.delete', () => {
  const remove = getHandler<unknown, { projectId: string }>('delivery_os.projects.delete')
  const deleteInput = { query: { id: PROJECT_ID } }

  async function runBlocked(tasks: DeliveryTask[]): Promise<{ httpError: CrudHttpError; project: DeliveryProject; harness: Harness }> {
    const harness = makeHarness()
    const project = makeProject()
    mockFindOneWithDecryption.mockResolvedValueOnce(project)
    mockFindWithDecryption.mockResolvedValueOnce(tasks)
    const httpError = await catchHttpError(() => remove.execute(deleteInput, harness.ctx))
    return { httpError, project, harness }
  }

  it('soft deletes when every attempt is closed and leaves tasks and history untouched', async () => {
    const { ctx, em, markOrmEntityChange } = makeHarness()
    const project = makeProject()
    const task = makeTask({ executionAttempts: reconciledRegister('not_started') })
    const taskBefore = JSON.stringify(task)
    mockFindOneWithDecryption.mockResolvedValueOnce(project)
    mockFindWithDecryption.mockResolvedValueOnce([task])
    const result = await remove.execute(deleteInput, ctx)
    expect(result).toEqual({ projectId: PROJECT_ID })
    expect(project.deletedAt).toBeInstanceOf(Date)
    expect(project.activeBaselineId).toBe(BASELINE_ID)
    expect(JSON.stringify(task)).toBe(taskBefore)
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(markOrmEntityChange.mock.calls[0][0]).toMatchObject({ action: 'deleted' })
  })

  it('locks the live tasks of the project inside the session scope', async () => {
    const { ctx } = makeHarness()
    mockFindOneWithDecryption.mockResolvedValueOnce(makeProject())
    mockFindWithDecryption.mockResolvedValueOnce([])
    await remove.execute({ body: { id: PROJECT_ID } }, ctx)
    const [, entity, where, options] = mockFindWithDecryption.mock.calls[0]
    expect(entity).toBe(DeliveryTask)
    expect(where).toEqual({ projectId: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null })
    expect(options).toMatchObject({ lockMode: LockMode.PESSIMISTIC_WRITE })
  })

  it('is blocked with 409 attempt_active by a reserved attempt', async () => {
    const { httpError, project, harness } = await runBlocked([makeTask({ status: 'executing', executionAttempts: reservedRegister() })])
    expect(httpError.status).toBe(409)
    expect(httpError.body.code).toBe('attempt_active')
    expect(httpError.body.details).toEqual([
      { path: `tasks.${TASK_ID}.attempts.${ATTEMPT_ID}`, code: 'attempt_reserved' },
      { path: `tasks.${TASK_ID}`, code: 'task_executing' },
    ])
    expect(deliveryErrorBodySchema.safeParse(httpError.body).success).toBe(true)
    expect(project.deletedAt).toBeNull()
    expect(harness.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('is blocked with 409 attempt_active by a cancel_requested attempt and by an executing task', async () => {
    const cancelRequested = await runBlocked([makeTask({ executionAttempts: cancelRequestedRegister() })])
    expect(cancelRequested.httpError.body.code).toBe('attempt_active')
    expect(cancelRequested.httpError.body.details[0].code).toBe('attempt_cancel_requested')
    const executing = await runBlocked([makeTask({ status: 'executing' })])
    expect(executing.httpError.status).toBe(409)
    expect(executing.httpError.body.code).toBe('attempt_active')
    expect(executing.project.deletedAt).toBeNull()
  })

  it('is blocked with 409 reconciliation_required by an unknown-state attempt', async () => {
    const { httpError, project } = await runBlocked([
      makeTask({ status: 'blocked', statusReason: 'reconciliation_required', executionAttempts: reconciledRegister('unknown') }),
    ])
    expect(httpError.status).toBe(409)
    expect(httpError.body.code).toBe('reconciliation_required')
    expect(httpError.body.details[0]).toEqual({
      path: `tasks.${TASK_ID}.attempts.${ATTEMPT_ID}`,
      code: 'reconciliation_required',
    })
    expect(project.deletedAt).toBeNull()
  })

  it('fails closed with 409 reconciliation_required when an attempt register cannot be read', async () => {
    const corrupted = [{ attemptId: 'not-an-attempt' }] as unknown as ExecutionAttempt[]
    const { httpError, project } = await runBlocked([makeTask({ executionAttempts: corrupted })])
    expect(httpError.status).toBe(409)
    expect(httpError.body.code).toBe('reconciliation_required')
    expect(httpError.body.details).toEqual([{ path: `tasks.${TASK_ID}`, code: 'unreadable_attempt_register' }])
    expect(project.deletedAt).toBeNull()
  })

  it('answers 404 for an id outside the session scope and 400 for a malformed id', async () => {
    const { ctx } = makeHarness()
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const foreign = await catchHttpError(() => remove.execute(deleteInput, ctx))
    expect(foreign.status).toBe(404)
    expect(foreign.body.code).toBe('not_found')
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    const malformed = await catchHttpError(() => remove.execute({ query: { id: 'nope' } }, ctx))
    expect(malformed.status).toBe(400)
    expect(malformed.body.code).toBe('validation_failed')
  })

  it('rejects a stale updatedAt with 409 and archives with a matching one', async () => {
    const stale = makeHarness({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } })
    const staleProject = makeProject()
    mockFindOneWithDecryption.mockResolvedValueOnce(staleProject)
    const httpError = await catchHttpError(() => remove.execute(deleteInput, stale.ctx))
    expect(httpError.status).toBe(409)
    expect(httpError.body.code).toBe('optimistic_lock_conflict')
    expect(staleProject.deletedAt).toBeNull()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    const fresh = makeHarness({ headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() } })
    const freshProject = makeProject()
    mockFindOneWithDecryption.mockResolvedValueOnce(freshProject)
    mockFindWithDecryption.mockResolvedValueOnce([])
    await remove.execute(deleteInput, fresh.ctx)
    expect(freshProject.deletedAt).toBeInstanceOf(Date)
  })

  it('agrees with the attempt-level archive rule for every register state', () => {
    const registers = [[], reservedRegister(), cancelRequestedRegister(), reconciledRegister('unknown'), reconciledRegister('not_started')]
    for (const register of registers) {
      const verdict = checkProjectArchivable([makeTask({ executionAttempts: register })])
      expect(verdict.ok).toBe(!isArchiveBlocked(register))
    }
  })

  it('emits side effects only after the transaction has committed', async () => {
    const { ctx, em, markOrmEntityChange } = makeHarness()
    let commit: () => void = () => undefined
    const committed = new Promise<void>((resolve) => {
      commit = resolve
    })
    em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => {
      const outcome = await work(em)
      await committed
      return outcome
    })
    mockFindOneWithDecryption.mockResolvedValueOnce(makeProject())
    mockFindWithDecryption.mockResolvedValueOnce([])
    const pending = remove.execute(deleteInput, ctx)
    await new Promise((resolve) => setImmediate(resolve))
    expect(markOrmEntityChange).not.toHaveBeenCalled()
    commit()
    await pending
    expect(markOrmEntityChange).toHaveBeenCalledTimes(1)
  })

  it('logs the archive with the snapshot taken before it', async () => {
    const { ctx } = makeHarness()
    mockFindOneWithDecryption.mockResolvedValueOnce(makeProject())
    const prepared = await remove.prepare?.(deleteInput, ctx)
    const log = await remove.buildLog?.({
      input: deleteInput,
      result: { projectId: PROJECT_ID },
      ctx,
      snapshots: { before: prepared?.before },
    })
    expect(log).toMatchObject({ resourceKind: 'delivery_os.project', resourceId: PROJECT_ID, tenantId: TENANT_ID })
    expect(log?.snapshotAfter).toBeUndefined()
  })
})
