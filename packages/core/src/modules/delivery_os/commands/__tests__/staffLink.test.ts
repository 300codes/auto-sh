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

jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))

import '@open-mercato/core/modules/delivery_os/commands'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { deliveryFlowErrorBodySchema, staffLinkSchema } from '../../lib/contracts'
import type { StaffLinkCommandResult } from '../staffLink'
import {
  ACTOR_ID,
  catchHttpError,
  detailCodes,
  emptyStore,
  expectFrozenBody,
  FOREIGN_ORG_ID,
  getHandler,
  makeHarness,
  makeProject,
  matches,
  ORG_ID,
  PROJECT_ID,
  rowsFor,
  STALE_UPDATED_AT,
  TENANT_ID,
  UPDATED_AT,
  type Row,
  type Store,
} from './baselineTestKit'

const STAFF_PROJECT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OTHER_STAFF_PROJECT_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const OTHER_DELIVERY_PROJECT_ID = 'cccccccc-3333-4333-8333-cccccccccccc'

const linkStaff = getHandler<StaffLinkCommandResult>('delivery_os.staff.link')

type Access = { canManageAll: boolean; projectIds: string[]; staffMemberId: string | null }

type Options = {
  headers?: Record<string, string>
  orgId?: string
  features?: string[] | 'throw'
  access?: Access | 'throw' | 'absent'
  staffProjects?: string[] | 'throw'
}

let store: Store
let resolveProjectAccess: jest.Mock
let probeQuery: jest.Mock

function lockHeader(value: string = UPDATED_AT.toISOString()): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: value }
}

function harness(options: Options = {}) {
  const features = options.features ?? []
  const access = options.access ?? { canManageAll: false, projectIds: [STAFF_PROJECT_ID], staffMemberId: null }
  resolveProjectAccess = jest.fn(async (input: { canManageAll: boolean }) => {
    if (access === 'throw' || access === 'absent') throw new Error('[internal] staff unavailable')
    return input.canManageAll ? { canManageAll: true, projectIds: [], staffMemberId: null } : access
  })
  const staffProjects = options.staffProjects ?? [STAFF_PROJECT_ID, OTHER_STAFF_PROJECT_ID]
  probeQuery = jest.fn(async (_entity: string, query: { filters: { id: { $eq: string } } }) => {
    if (staffProjects === 'throw') throw new Error('[internal] query engine unavailable')
    return { items: staffProjects.includes(query.filters.id.$eq) ? [{ id: query.filters.id.$eq }] : [] }
  })
  const services: Record<string, unknown> = {
    queryEngine: { query: probeQuery },
    rbacService: {
      getGrantedFeatures: jest.fn(async () => {
        if (features === 'throw') throw new Error('[internal] rbac unavailable')
        return features
      }),
    },
  }
  if (access !== 'absent') services.timeTrackingAccessResolver = { resolveProjectAccess }
  const built = makeHarness(store, { headers: options.headers ?? lockHeader(), orgId: options.orgId, services })
  built.em.create.mockImplementation((_entity: unknown, data: Row) => ({ id: 'dddddddd-4444-4444-8444-dddddddddddd', ...data }))
  built.em.persist.mockImplementation((row: Row) => {
    store.staffLinks.push(row)
  })
  return built
}

function run(staffProjectId: string, options: Options = {}): Promise<StaffLinkCommandResult> {
  const { ctx } = harness(options)
  return Promise.resolve(linkStaff.execute({ projectId: PROJECT_ID, staffProjectId }, ctx))
}

function linkRow(overrides: Row = {}): Row {
  return {
    id: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    staffProjectId: STAFF_PROJECT_ID,
    linkedBy: ACTOR_ID,
    linkedAt: UPDATED_AT,
    syncCursors: { fileA: { cursor: 'c1', lastBatchKey: null, lastBatchHash: null, lastSyncAt: null, lastError: null } },
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

beforeEach(() => {
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rowsFor(store, entity).find((row) => matches(row, where)) ?? null)
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rowsFor(store, entity).filter((row) => matches(row, where)))
  store = { ...emptyStore(), projects: [makeProject()] }
})

describe('delivery_os.staff.link (F10)', () => {
  it('links a staff project the caller is a member of and bumps the project version', async () => {
    const result = await run(STAFF_PROJECT_ID)
    expect(staffLinkSchema.safeParse(result).success).toBe(true)
    expect(result).toMatchObject({ projectId: PROJECT_ID, staffProjectId: STAFF_PROJECT_ID, linkedBy: ACTOR_ID, syncCursors: {}, unchanged: false })
    expect(store.staffLinks).toHaveLength(1)
    expect(store.staffLinks[0]).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID, projectId: PROJECT_ID })
    expect(store.projects[0].updatedAt.getTime()).toBeGreaterThan(UPDATED_AT.getTime())
    expect(resolveProjectAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ACTOR_ID, tenantId: TENANT_ID, organizationId: ORG_ID, canManageAll: false }),
    )
  })

  it.each([['staff.timesheets.projects.manage'], ['staff.timesheets.*'], ['staff.*'], ['*']])(
    'treats %s as manage-all and accepts a project outside the member list',
    async (feature) => {
      const result = await run(OTHER_STAFF_PROJECT_ID, { features: [feature] })
      expect(result.staffProjectId).toBe(OTHER_STAFF_PROJECT_ID)
      expect(resolveProjectAccess).toHaveBeenCalledWith(expect.objectContaining({ canManageAll: true }))
      expect(probeQuery).toHaveBeenCalledWith('staff:staff_time_project', expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }))
    },
  )

  it('answers 404 to a manager for a staff project that does not exist in the scope, or when the probe is unavailable', async () => {
    expectFrozenBody(await catchHttpError(() => run(OTHER_STAFF_PROJECT_ID, { features: ['*'], staffProjects: [] })), 404, 'not_found')
    expectFrozenBody(await catchHttpError(() => run(OTHER_STAFF_PROJECT_ID, { features: ['*'], staffProjects: 'throw' })), 404, 'not_found')
    expect(store.staffLinks).toHaveLength(0)
  })

  it('answers 404 for a member whose staff project is gone from the scope (membership outlives a soft delete)', async () => {
    expectFrozenBody(await catchHttpError(() => run(STAFF_PROJECT_ID, { staffProjects: [] })), 404, 'not_found')
  })

  it('answers 404, not 409, for an inaccessible staff project that is linked elsewhere', async () => {
    store.staffLinks.push(linkRow({ projectId: OTHER_DELIVERY_PROJECT_ID, staffProjectId: OTHER_STAFF_PROJECT_ID }))
    expectFrozenBody(await catchHttpError(() => run(OTHER_STAFF_PROJECT_ID)), 404, 'not_found')
  })

  it('answers 404 not_found for a staff project the caller cannot reach, without writing', async () => {
    const error = await catchHttpError(() => run(OTHER_STAFF_PROJECT_ID))
    expectFrozenBody(error, 404, 'not_found')
    expect(store.staffLinks).toHaveLength(0)
  })

  it('fails closed to 404 when the RBAC lookup or the staff resolver throws', async () => {
    expectFrozenBody(await catchHttpError(() => run(OTHER_STAFF_PROJECT_ID, { features: 'throw' })), 404, 'not_found')
    expectFrozenBody(await catchHttpError(() => run(STAFF_PROJECT_ID, { access: 'throw' })), 404, 'not_found')
  })

  it('answers 422 staff_link_required when the staff resolver is not registered', async () => {
    const error = await catchHttpError(() => run(STAFF_PROJECT_ID, { access: 'absent' }))
    expect(error.status).toBe(422)
    expect(deliveryFlowErrorBodySchema.safeParse(error.body).success).toBe(true)
    expect(error.body.code).toBe('staff_link_required')
  })

  it('answers 404 for a project of another organization before consulting staff', async () => {
    const error = await catchHttpError(() => run(STAFF_PROJECT_ID, { orgId: FOREIGN_ORG_ID }))
    expectFrozenBody(error, 404, 'not_found')
    expect(resolveProjectAccess).not.toHaveBeenCalled()
  })

  it('requires the project lock header and rejects a stale one', async () => {
    expectFrozenBody(await catchHttpError(() => run(STAFF_PROJECT_ID, { headers: {} })), 428, 'optimistic_lock_required')
    const stale = await catchHttpError(() => run(STAFF_PROJECT_ID, { headers: lockHeader(STALE_UPDATED_AT) }))
    expect(stale.status).toBe(409)
    expect(store.staffLinks).toHaveLength(0)
  })

  it('answers the same staff project as unchanged, without a lock header and with the cursors kept', async () => {
    store.staffLinks.push(linkRow())
    const result = await run(STAFF_PROJECT_ID, { headers: {} })
    expect(result.unchanged).toBe(true)
    expect(Object.keys(result.syncCursors)).toEqual(['fileA'])
    expect(store.projects[0].updatedAt).toEqual(UPDATED_AT)
  })

  it('re-links to another staff project while no card exists and resets the cursors', async () => {
    store.staffLinks.push(linkRow())
    const result = await run(OTHER_STAFF_PROJECT_ID, { features: ['staff.*'] })
    expect(result).toMatchObject({ staffProjectId: OTHER_STAFF_PROJECT_ID, syncCursors: {}, unchanged: false })
    expect(store.staffLinks).toHaveLength(1)
  })

  it('refuses a re-link once imported cards live in the linked staff project', async () => {
    store.staffLinks.push(linkRow())
    store.commentThreads.push({ id: 't1', tenantId: TENANT_ID, organizationId: ORG_ID, projectId: PROJECT_ID, staffTaskId: 'ffffffff-6666-4666-8666-ffffffffffff' })
    const error = await catchHttpError(() => run(OTHER_STAFF_PROJECT_ID, { features: ['staff.*'] }))
    expectFrozenBody(error, 409, 'invalid_transition')
    expect(detailCodes(error)).toEqual(['staff_link_in_use'])
    expect(store.staffLinks[0].staffProjectId).toBe(STAFF_PROJECT_ID)
  })

  it('refuses a staff project already linked to another delivery project', async () => {
    store.staffLinks.push(linkRow({ projectId: OTHER_DELIVERY_PROJECT_ID }))
    const error = await catchHttpError(() => run(STAFF_PROJECT_ID))
    expectFrozenBody(error, 409, 'invalid_transition')
    expect(detailCodes(error)).toEqual(['staff_project_already_linked'])
  })

  it('maps a unique-index race to the same conflict', async () => {
    const { ctx, em } = harness()
    em.persist.mockImplementation(() => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    })
    const error = await catchHttpError(() => linkStaff.execute({ projectId: PROJECT_ID, staffProjectId: STAFF_PROJECT_ID }, ctx))
    expectFrozenBody(error, 409, 'invalid_transition')
  })

  it('rejects a malformed staff project id', async () => {
    expectFrozenBody(await catchHttpError(() => run('not-a-uuid')), 400, 'validation_failed')
  })
})
