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
import { DELETE, GET, POST, PUT, metadata, openApi } from '../projects/route'
import { GET as GET_DETAIL, metadata as detailMetadata, openApi as detailOpenApi } from '../projects/[id]/route'
import {
  BASELINE_ID,
  FOREIGN_ORG_ID,
  ORG_ID,
  PROJECT_ID,
  STALE_UPDATED_AT,
  TENANT_ID,
  UPDATED_AT,
  makeBaseline,
  makeProject,
  type Row,
} from '../../commands/__tests__/baselineTestKit'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import { projectDetailSchema, projectListItemSchema } from '../schemas'
import {
  ALL_FEATURES,
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
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

const validCreate = { name: 'Customer portal', inputMode: 'from_brief', targetProfileId: TARGET_PROFILES[0].id }

function seedProject(overrides: Row = {}): Row {
  const project = makeProject(overrides) as unknown as Row
  routeState.store.projects.push(project)
  return project
}

beforeEach(() => resetRouteState())

describe('delivery_os projects routes — guards', () => {
  it('declares auth and feature guards per method and exports OpenAPI docs', () => {
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(isAllowedBy(metadata, method, VIEW_ONLY)).toBe(false)
      expect(isAllowedBy(metadata, method, EMPLOYEE_FEATURES)).toBe(true)
      expect(isAllowedBy(metadata, method, ALL_FEATURES)).toBe(true)
    }
    expect(isAllowedBy(detailMetadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(detailMetadata, 'GET', ['customers.*'])).toBe(false)
    expect(Object.keys(openApi.methods)).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'DELETE']))
    expect(Object.keys(detailOpenApi.methods)).toEqual(['GET'])
  })

  it('answers 401 without a session on every method', async () => {
    routeState.auth = null
    const responses = await Promise.all([
      GET(apiRequest('GET', '/projects')),
      POST(apiRequest('POST', '/projects', { body: validCreate })),
      PUT(apiRequest('PUT', '/projects', { body: { id: PROJECT_ID, name: 'Renamed' } })),
      DELETE(apiRequest('DELETE', `/projects?id=${PROJECT_ID}`)),
      GET_DETAIL(apiRequest('GET', `/projects/${PROJECT_ID}`), routeParams(PROJECT_ID)),
    ])
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401])
    expect(routeState.writes).toBe(0)
  })
})

describe('GET /api/delivery_os/projects', () => {
  it('lists camelCase items with updatedAt, pinned to the session scope, archived hidden by default', async () => {
    routeState.queryEngine.query.mockResolvedValue({
      items: [
        {
          id: PROJECT_ID,
          name: 'Customer portal',
          input_mode: 'from_brief',
          brief: null,
          target_profile_id: TARGET_PROFILES[0].id,
          target_profile_version: 1,
          repository_ref: null,
          active_baseline_id: null,
          created_at: UPDATED_AT,
          updated_at: UPDATED_AT,
          deleted_at: null,
        },
      ],
      total: 1,
    })
    const response = await GET(apiRequest('GET', '/projects?search=portal&withDeleted=true'))
    const body = await readBody(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 50, totalPages: 1 })
    const [item] = body.items as Row[]
    expect(projectListItemSchema.safeParse(item).success).toBe(true)
    expect(item.updatedAt).toBe(UPDATED_AT.toISOString())
    const [, options] = routeState.queryEngine.query.mock.calls[0]
    expect(options.withDeleted).toBe(false)
    expect(options.tenantId).toBe(TENANT_ID)
    expect(options.filters.organization_id).toEqual({ $eq: ORG_ID })
    expect(options.filters.name.$ilike).toContain('portal')
  })

  it('shows archived projects only with includeArchived=true', async () => {
    await GET(apiRequest('GET', '/projects?includeArchived=true'))
    expect(routeState.queryEngine.query.mock.calls[0][1].withDeleted).toBe(true)
  })

  it('ignores export parameters, so the organization pin cannot be skipped', async () => {
    const response = await GET(apiRequest('GET', '/projects?format=csv&exportScope=full&full=true'))
    expect(response.headers.get('content-type')).toContain('application/json')
    const [, options] = routeState.queryEngine.query.mock.calls[0]
    expect(options.filters.organization_id).toEqual({ $eq: ORG_ID })
    expect(options.withDeleted).toBe(false)
  })

  it('rejects pageSize above 100 as the factory does and never queries', async () => {
    const response = await GET(apiRequest('GET', '/projects?pageSize=101'))
    expect(response.status).toBe(400)
    expect(routeState.queryEngine.query).not.toHaveBeenCalled()
  })
})

describe('POST /api/delivery_os/projects', () => {
  it('creates a project under the session scope and answers 201 { id, updatedAt }', async () => {
    const response = await POST(
      apiRequest('POST', '/projects', { body: { ...validCreate, tenantId: FOREIGN_TENANT_ID, organizationId: FOREIGN_ORG_ID } }),
    )
    const body = await readBody(response)

    expect(response.status).toBe(201)
    const [created] = routeState.store.projects
    expect(body).toEqual({ id: created.id, updatedAt: (created.updatedAt as Date).toISOString() })
    expect(created.tenantId).toBe(TENANT_ID)
    expect(created.organizationId).toBe(ORG_ID)
  })

  it('answers the frozen 400 body with zod paths for an invalid payload', async () => {
    const response = await POST(apiRequest('POST', '/projects', { body: { inputMode: 'from_fax' } }))
    const body = await expectFrozenError(response, 400, 'validation_failed')
    expect((body.details as Array<{ path: string }>).map((detail) => detail.path)).toEqual(
      expect.arrayContaining(['name', 'inputMode', 'targetProfileId']),
    )
    expect(routeState.store.projects).toHaveLength(0)
  })

  it('answers the frozen 400 body for a body that is not an object', async () => {
    await expectFrozenError(await POST(apiRequest('POST', '/projects', { body: ['not', 'an', 'object'] })), 400, 'validation_failed')
    await expectFrozenError(await PUT(apiRequest('PUT', '/projects', { body: 'text' })), 400, 'validation_failed')
  })

  it('answers 422 unknown_target_profile', async () => {
    const response = await POST(apiRequest('POST', '/projects', { body: { ...validCreate, targetProfileId: 'cobol-mainframe' } }))
    await expectFrozenError(response, 422, 'unknown_target_profile')
  })
})

describe('PUT /api/delivery_os/projects', () => {
  it('updates with a matching version and returns { ok, updatedAt }', async () => {
    const project = seedProject()
    const response = await PUT(apiRequest('PUT', '/projects', { body: { id: PROJECT_ID, name: 'Renamed' }, lock: UPDATED_AT }))
    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ ok: true, updatedAt: UPDATED_AT.toISOString() })
    expect(project.name).toBe('Renamed')
  })

  it('answers the untouched platform 409 for a stale version and changes nothing', async () => {
    const project = seedProject()
    const response = await PUT(
      apiRequest('PUT', '/projects', { body: { id: PROJECT_ID, name: 'Renamed' }, lock: STALE_UPDATED_AT }),
    )
    const body = await readBody(response)
    expect(response.status).toBe(409)
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(UPDATED_AT.toISOString())
    expect(body).not.toHaveProperty('details')
    expect(project.name).toBe('Customer portal')
  })

  it('answers 404 for a second tenant and for a second organization', async () => {
    seedProject()
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      const response = await PUT(apiRequest('PUT', '/projects', { body: { id: PROJECT_ID, name: 'Hijacked' } }))
      await expectFrozenError(response, 404, 'not_found')
    }
    expect(routeState.store.projects[0].name).toBe('Customer portal')
  })

  it('answers the frozen 400 body when the draft is invalid', async () => {
    seedProject()
    const response = await PUT(apiRequest('PUT', '/projects', { body: { id: PROJECT_ID, draftSpec: { requirements: 'none' } } }))
    await expectFrozenError(response, 400, 'validation_failed')
  })
})

describe('DELETE /api/delivery_os/projects', () => {
  it('archives by ?id= and hides nothing from the detail route', async () => {
    const project = seedProject()
    const response = await DELETE(apiRequest('DELETE', `/projects?id=${PROJECT_ID}`, { lock: UPDATED_AT }))
    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ ok: true })
    expect(project.deletedAt).toBeInstanceOf(Date)

    const detail = await GET_DETAIL(apiRequest('GET', `/projects/${PROJECT_ID}`), routeParams(PROJECT_ID))
    const body = await readBody(detail)
    expect(detail.status).toBe(200)
    expect(body.status).toBe('archived')
    expect(body.archivedAt).toEqual(expect.any(String))
  })

  it('answers the platform 409 for a stale version', async () => {
    const project = seedProject()
    const response = await DELETE(apiRequest('DELETE', `/projects?id=${PROJECT_ID}`, { lock: STALE_UPDATED_AT }))
    expect(response.status).toBe(409)
    expect((await readBody(response)).code).toBe('optimistic_lock_conflict')
    expect(project.deletedAt).toBeNull()
  })

  it('answers 409 attempt_active while a task is executing', async () => {
    seedProject()
    routeState.store.tasks.push(makeTaskRow({ status: 'executing' }))
    const response = await DELETE(apiRequest('DELETE', `/projects?id=${PROJECT_ID}`))
    const body = await expectFrozenError(response, 409, 'attempt_active')
    expect(detailCodesOf(body)).toContain('task_executing')
  })

  it('answers 400 without an id and 404 for a foreign scope', async () => {
    seedProject()
    await expectFrozenError(await DELETE(apiRequest('DELETE', '/projects')), 400, 'validation_failed')
    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFrozenError(await DELETE(apiRequest('DELETE', `/projects?id=${PROJECT_ID}`)), 404, 'not_found')
  })
})

describe('GET /api/delivery_os/projects/:id', () => {
  it('returns the detail with updatedAt, status and progress numerator and denominator', async () => {
    const baseline = makeBaseline()
    seedProject({ activeBaselineId: BASELINE_ID })
    routeState.store.baselines.push(baseline as unknown as Row)
    const acIds = (baseline.content as { acceptanceCriteria: Array<{ id: string }> }).acceptanceCriteria.map((ac) => ac.id)
    routeState.store.tasks.push(makeTaskRow({ acIds: [acIds[0]], status: 'verified' }))

    const response = await GET_DETAIL(apiRequest('GET', `/projects/${PROJECT_ID}`), routeParams(PROJECT_ID))
    const body = await readBody(response)

    expect(response.status).toBe(200)
    expect(projectDetailSchema.safeParse(body).success).toBe(true)
    expect(body.updatedAt).toBe(UPDATED_AT.toISOString())
    expect(body.progress).toEqual({
      proven: 1,
      total: acIds.length,
      unit: 'ac',
      percent: Math.floor(100 / acIds.length),
    })
    expect(body.status).toBe(acIds.length === 1 ? 'verified' : 'coverage_gap')
    expect(routeState.writes).toBe(0)
  })

  it('answers 404 for a second tenant, a second organization, an unknown id and a malformed id', async () => {
    seedProject()
    signInAs({ tenantId: FOREIGN_TENANT_ID })
    await expectFrozenError(await GET_DETAIL(apiRequest('GET', '/projects/x'), routeParams(PROJECT_ID)), 404, 'not_found')
    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFrozenError(await GET_DETAIL(apiRequest('GET', '/projects/x'), routeParams(PROJECT_ID)), 404, 'not_found')
    signInAs({})
    await expectFrozenError(await GET_DETAIL(apiRequest('GET', '/projects/x'), routeParams(BASELINE_ID)), 404, 'not_found')
    await expectFrozenError(await GET_DETAIL(apiRequest('GET', '/projects/x'), routeParams('not-a-uuid')), 404, 'not_found')
  })
})
