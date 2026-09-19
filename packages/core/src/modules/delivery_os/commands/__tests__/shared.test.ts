const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DeliveryProject, DeliveryTask } from '../../data/entities'
import { addDeliveryIssue, buildDeliveryError, deliveryErrorBodySchema } from '../../lib/contracts'
import {
  assertDeliveryCheck,
  deliveryHttpError,
  lockScopedProject,
  lockScopedProjectTasks,
  lockScopedTask,
  parseDeliveryInput,
  requireScopedProject,
  requireScopedTask,
  resolveDeliveryScope,
} from '../shared'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const TASK_ID = '55555555-5555-4555-8555-555555555555'
const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
const em = {} as EntityManager

function makeCtx(overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  return {
    container: { resolve: jest.fn() } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    ...overrides,
  }
}

function catchHttpError(run: () => unknown): CrudHttpError {
  try {
    run()
  } catch (error) {
    if (error instanceof CrudHttpError) return error
    throw error
  }
  throw new Error('[internal] expected a CrudHttpError')
}

async function catchHttpErrorAsync(run: () => Promise<unknown>): Promise<CrudHttpError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof CrudHttpError) return error
    throw error
  }
  throw new Error('[internal] expected a CrudHttpError')
}

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockReset()
})

describe('delivery_os commands/shared — error conversion', () => {
  it('keeps the frozen error body and status and marks the message internal', () => {
    const failure = buildDeliveryError('attempt_active', 'Attempt is active', [{ path: 'taskId', code: 'attempt_active' }])
    const httpError = deliveryHttpError(failure)
    expect(httpError.status).toBe(409)
    expect(httpError.body).toEqual(failure.body)
    expect(deliveryErrorBodySchema.safeParse(httpError.body).success).toBe(true)
    expect(httpError.message.startsWith('[internal]')).toBe(true)
  })

  it('throws for a failed check and stays silent for a passed one', () => {
    expect(() => assertDeliveryCheck({ ok: true })).not.toThrow()
    const httpError = catchHttpError(() =>
      assertDeliveryCheck({ ok: false, ...buildDeliveryError('task_not_ready', 'Task is not ready') }),
    )
    expect(httpError.status).toBe(409)
    expect(httpError.body.code).toBe('task_not_ready')
  })

  it('maps zod failures to the catalogue and returns parsed data otherwise', () => {
    const schema = z.object({ name: z.string().min(1) }).superRefine((value, ctx) => {
      if (value.name === 'dup') addDeliveryIssue(ctx, 'duplicate_stable_id', ['name'], 'Duplicate id dup')
    })
    expect(parseDeliveryInput(schema, { name: 'ok', tenantId: 'ignored' })).toEqual({ name: 'ok' })
    const shapeError = catchHttpError(() => parseDeliveryInput(schema, { name: '' }))
    expect(shapeError.status).toBe(400)
    expect(shapeError.body.code).toBe('validation_failed')
    const domainError = catchHttpError(() => parseDeliveryInput(schema, { name: 'dup' }))
    expect(domainError.status).toBe(422)
    expect(domainError.body.code).toBe('duplicate_stable_id')
    expect(domainError.body.details).toEqual([{ path: 'name', code: 'duplicate_stable_id', message: 'Duplicate id dup' }])
  })
})

describe('delivery_os commands/shared — scope', () => {
  it('reads tenant and organization from the session', () => {
    expect(resolveDeliveryScope(makeCtx())).toEqual(scope)
  })

  it('prefers a selected organization that the platform scope allows', () => {
    const ctx = makeCtx({
      selectedOrganizationId: OTHER_ORG_ID,
      organizationScope: { selectedId: OTHER_ORG_ID, filterIds: [OTHER_ORG_ID], allowedIds: [ORG_ID, OTHER_ORG_ID], tenantId: TENANT_ID },
    })
    expect(resolveDeliveryScope(ctx)).toEqual({ tenantId: TENANT_ID, organizationId: OTHER_ORG_ID })
  })

  it('refuses a selected organization that no platform scope vouches for', () => {
    const httpError = catchHttpError(() => resolveDeliveryScope(makeCtx({ selectedOrganizationId: OTHER_ORG_ID })))
    expect(httpError.status).toBe(403)
    expect(httpError.body.details).toEqual([{ code: 'scope_not_allowed' }])
  })

  it('rejects a selected organization outside the allowed set with the catalogue body', () => {
    const ctx = makeCtx({
      selectedOrganizationId: OTHER_ORG_ID,
      organizationScope: { selectedId: OTHER_ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID], tenantId: TENANT_ID },
    })
    const httpError = catchHttpError(() => resolveDeliveryScope(ctx))
    expect(httpError.status).toBe(403)
    expect(httpError.body).toEqual({
      error: 'Tenant and organization scope are required',
      code: 'forbidden',
      details: [{ code: 'scope_not_allowed' }],
    })
  })

  it('answers 403 forbidden without a session tenant or organization', () => {
    const noAuth = catchHttpError(() => resolveDeliveryScope(makeCtx({ auth: null })))
    expect(noAuth.status).toBe(403)
    expect(noAuth.body.code).toBe('forbidden')
    const noOrg = catchHttpError(() => resolveDeliveryScope(makeCtx({ auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: null } })))
    expect(noOrg.status).toBe(403)
  })
})

describe('delivery_os commands/shared — scoped loaders', () => {
  it('returns the project found inside the scope', async () => {
    const project = { id: PROJECT_ID }
    mockFindOneWithDecryption.mockResolvedValueOnce(project)
    await expect(requireScopedProject(em, PROJECT_ID, scope)).resolves.toBe(project)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      DeliveryProject,
      { id: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      undefined,
      scope,
    )
  })

  it('answers 404 not_found for a project outside the scope', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const httpError = await catchHttpErrorAsync(() => requireScopedProject(em, PROJECT_ID, scope))
    expect(httpError.status).toBe(404)
    expect(httpError.body).toEqual({ error: 'Not found', code: 'not_found', details: [{ path: 'projectId', code: 'not_found' }] })
  })

  it('returns the task found inside the scope and 404 otherwise', async () => {
    const task = { id: TASK_ID }
    mockFindOneWithDecryption.mockResolvedValueOnce(task)
    await expect(requireScopedTask(em, TASK_ID, scope)).resolves.toBe(task)
    expect(mockFindOneWithDecryption.mock.calls[0][1]).toBe(DeliveryTask)
    expect(mockFindOneWithDecryption.mock.calls[0][2]).toEqual({
      id: TASK_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
    })
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const httpError = await catchHttpErrorAsync(() => requireScopedTask(em, TASK_ID, scope))
    expect(httpError.status).toBe(404)
    expect(httpError.body.details).toEqual([{ path: 'taskId', code: 'not_found' }])
  })

  it('takes a pessimistic write lock in the lock helpers and none in plain loads', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'row' })
    mockFindWithDecryption.mockResolvedValue([])
    await requireScopedProject(em, PROJECT_ID, scope)
    await lockScopedProject(em, PROJECT_ID, scope)
    await lockScopedTask(em, TASK_ID, scope)
    await lockScopedProjectTasks(em, PROJECT_ID, scope)
    expect(mockFindOneWithDecryption.mock.calls[0][3]).toBeUndefined()
    expect(mockFindOneWithDecryption.mock.calls[1][3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(mockFindOneWithDecryption.mock.calls[2][3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      DeliveryTask,
      { projectId: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } },
      scope,
    )
  })
})
