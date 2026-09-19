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
import { GET, POST, metadata, openApi } from '../projects/[id]/baselines/route'
import {
  FOREIGN_ORG_ID,
  PROJECT_ID,
  STALE_UPDATED_AT,
  UPDATED_AT,
  draftAttachmentRows,
  makeBaseline,
  makeDraft,
  makeProject,
  type Row,
} from '../../commands/__tests__/baselineTestKit'
import { baselineListResponseSchema } from '../schemas'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  VIEW_ONLY,
  apiRequest,
  detailCodesOf,
  expectFrozenError,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

const path = `/projects/${PROJECT_ID}/baselines`

function seedProject(overrides: Row = {}): Row {
  const project = makeProject(overrides) as unknown as Row
  routeState.store.projects.push(project)
  routeState.store.attachments.push(...draftAttachmentRows(project.draftSpec as Row))
  return project
}

function postManual(lock: string | Date | null = UPDATED_AT): Promise<Response> {
  return POST(apiRequest('POST', path, { body: { source: 'manual' }, lock }), routeParams(PROJECT_ID))
}

beforeEach(() => resetRouteState())

describe('delivery_os baselines route', () => {
  it('declares guards and OpenAPI docs', () => {
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['customers.*'])).toBe(false)
    expect(Object.keys(openApi.methods)).toEqual(['GET', 'POST'])
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    expect((await GET(apiRequest('GET', path), routeParams(PROJECT_ID))).status).toBe(401)
    expect((await postManual()).status).toBe(401)
  })

  it('freezes the draft: 201, then 200 duplicate for identical content', async () => {
    seedProject()
    const created = await postManual()
    const body = await readBody(created)
    expect(created.status).toBe(201)
    expect(body).toMatchObject({ version: 1, duplicate: false, openCommentIds: [] })
    expect(routeState.store.baselines).toHaveLength(1)

    const replay = await postManual()
    expect(replay.status).toBe(200)
    expect(await readBody(replay)).toMatchObject({ baselineId: body.baselineId, duplicate: true })
    expect(routeState.store.baselines).toHaveLength(1)
  })

  it('requires the manage feature for a manual source and fails closed without rbac', async () => {
    seedProject()
    signInAs({ features: VIEW_ONLY })
    const denied = await expectFrozenError(await postManual(), 403, 'forbidden')
    expect(detailCodesOf(denied)).toEqual(['feature_required'])

    signInAs({ features: EMPLOYEE_FEATURES })
    routeState.rbacAvailable = false
    await expectFrozenError(await postManual(), 403, 'forbidden')
    expect(routeState.store.baselines).toHaveLength(0)
  })

  it('checks results.import for a requirements proposal and then reports the source as unsupported', async () => {
    seedProject()
    const proposal = { source: 'requirements_proposal', manifest: { schemaVersion: 'delivery.requirements-proposal/v1' } }
    signInAs({ features: ['delivery_os.projects.view', 'delivery_os.projects.manage'] })
    const denied = await POST(apiRequest('POST', path, { body: proposal, lock: UPDATED_AT }), routeParams(PROJECT_ID))
    await expectFrozenError(denied, 403, 'forbidden')

    signInAs({ features: EMPLOYEE_FEATURES })
    const unsupported = await POST(apiRequest('POST', path, { body: proposal, lock: UPDATED_AT }), routeParams(PROJECT_ID))
    const body = await expectFrozenError(unsupported, 400, 'validation_failed')
    expect(detailCodesOf(body)).toContain('unsupported_source')
  })

  it('answers 428 without the project version and the platform 409 for a stale one', async () => {
    seedProject()
    await expectFrozenError(await postManual(null), 428, 'optimistic_lock_required')
    const stale = await postManual(STALE_UPDATED_AT)
    expect(stale.status).toBe(409)
    expect((await readBody(stale)).code).toBe('optimistic_lock_conflict')
    expect(routeState.store.baselines).toHaveLength(0)
  })

  it('answers one 422 with every gap of the draft', async () => {
    seedProject({ draftSpec: makeDraft({ acceptanceCriteria: [], screens: [] }) })
    const body = await expectFrozenError(await postManual(), 422, 'missing_acceptance_criteria')
    expect(detailCodesOf(body)).toEqual(expect.arrayContaining(['missing_acceptance_criteria', 'missing_render']))
  })

  it('answers 400 for an unknown source and 404 for a second tenant or organization', async () => {
    seedProject()
    const unknown = await POST(apiRequest('POST', path, { body: { source: 'fax' }, lock: UPDATED_AT }), routeParams(PROJECT_ID))
    await expectFrozenError(unknown, 400, 'validation_failed')
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await postManual(), 404, 'not_found')
      await expectFrozenError(await GET(apiRequest('GET', path), routeParams(PROJECT_ID)), 404, 'not_found')
    }
  })

  it('refuses a rejected organization selection like the CRUD factory and keeps path ids authoritative', async () => {
    seedProject()
    const spoofed = await POST(
      apiRequest('POST', path, { body: { source: 'manual', projectId: '00000000-0000-4000-8000-000000000000' }, lock: UPDATED_AT }),
      routeParams(PROJECT_ID),
    )
    expect(spoofed.status).toBe(201)
    expect(routeState.store.baselines[0].projectId).toBe(PROJECT_ID)

    routeState.selectionRejected = true
    const rejected = await postManual()
    expect(rejected.status).toBe(422)
    expect((await readBody(rejected)).code).toBe('organization_selection_invalid')
    expect(routeState.store.baselines).toHaveLength(1)
  })

  it('lists baselines newest first with content, decisions and the active flag, without writing', async () => {
    const first = makeBaseline()
    seedProject({ activeBaselineId: first.id, deletedAt: new Date() })
    routeState.store.baselines.push(first as unknown as Row)
    routeState.store.decisions.push({
      id: '8d8d8d8d-8888-4888-8888-888888888881',
      tenantId: first.tenantId,
      organizationId: first.organizationId,
      projectId: PROJECT_ID,
      kind: 'requirements',
      subjectType: 'baseline',
      subjectId: first.id,
      subjectHash: first.contentHash,
      subjectVersion: 1,
      verdict: 'approved',
      reason: null,
      actorUserId: '88888888-8888-4888-8888-888888888888',
      decidedAt: UPDATED_AT,
    })
    const response = await GET(apiRequest('GET', path), routeParams(PROJECT_ID))
    const body = await readBody(response)
    expect(response.status).toBe(200)
    expect(baselineListResponseSchema.safeParse(body).success).toBe(true)
    expect(body.total).toBe(1)
    expect((body.items as Row[])[0]).toMatchObject({ id: first.id, isActive: true, version: 1 })
    expect(((body.items as Row[])[0].decisions as Row[])[0]).toMatchObject({ kind: 'requirements', verdict: 'approved' })
    expect(routeState.writes).toBe(0)
  })
})
