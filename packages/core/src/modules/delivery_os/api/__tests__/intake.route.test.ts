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
import { GET, PUT, metadata, openApi } from '../projects/[id]/intake/route'
import { POST as IMPORT_PROPOSAL, metadata as proposalMetadata, openApi as proposalOpenApi } from '../projects/[id]/intake/proposals/route'
import { PUT as UPDATE_PROJECT } from '../projects/route'
import { FOREIGN_ORG_ID } from '../../commands/__tests__/baselineTestKit'
import {
  deliveryFlowErrorBodySchema,
  intakeResponseSchema,
  scopingProposalImportResponseSchema,
  type IntakeResponse,
} from '../../lib/contracts'
import { loadIntakeFixture, loadScopingProposalFixture } from '../../lib/fixtures/flow/index'
import { createProject, expectStatus, type Json } from './flowHelpers'
import {
  ALL_FEATURES,
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  VIEW_ONLY,
  apiRequest,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

const PROJECT_CREATED_AT = new Date('2026-09-01T08:00:00.000Z')

async function expectFlowError(response: Response, status: number, code: string): Promise<Json> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(body).success).toBe(true)
  return body
}

async function createWordpressProject(): Promise<string> {
  const created = await createProject({ targetProfileId: 'wordpress-theme' })
  const row = routeState.store.projects.find((project) => project.id === created.id)
  if (!row) throw new Error('[internal] created project is not in the route store')
  row.createdAt = PROJECT_CREATED_AT
  return created.id as string
}

function draft(overrides: Json = {}): Json {
  const { projectId: _projectId, proposals: _proposals, ...request } = loadIntakeFixture()
  return { ...request, step: 'scoping', brief: { ...request.brief, materials: [] }, ...overrides }
}

function getIntake(projectId: string): Promise<Response> {
  return GET(apiRequest('GET', `/projects/${projectId}/intake`), routeParams(projectId))
}

function putIntake(projectId: string, body: Json, lock: string | null): Promise<Response> {
  return PUT(apiRequest('PUT', `/projects/${projectId}/intake`, { body, lock }), routeParams(projectId))
}

function importProposal(projectId: string, body: Json, lock: string | null = null): Promise<Response> {
  return IMPORT_PROPOSAL(apiRequest('POST', `/projects/${projectId}/intake/proposals`, { body, lock }), routeParams(projectId))
}

function proposal(projectId: string, overrides: Json = {}): Json {
  return { ...loadScopingProposalFixture(), projectId, ...overrides }
}

async function readIntake(projectId: string): Promise<IntakeResponse> {
  const body = await expectStatus(await getIntake(projectId), 200)
  return intakeResponseSchema.parse(body)
}

beforeEach(() => {
  resetRouteState()
})

describe('GET/PUT /projects/:id/intake (F1/F2)', () => {
  it('declares auth and features, and documents both methods', () => {
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'PUT', VIEW_ONLY)).toBe(false)
    expect(isAllowedBy(metadata, 'PUT', EMPLOYEE_FEATURES)).toBe(true)
    expect(isAllowedBy(metadata, 'GET', [])).toBe(false)
    expect(Object.keys(openApi.methods).sort()).toEqual(['GET', 'PUT'])
  })

  it('returns the empty default draft versioned by the project createdAt before the first write', async () => {
    const projectId = await createWordpressProject()
    const intake = await readIntake(projectId)
    expect(intake.intake).toMatchObject({ projectId, step: 'brief', questions: [], proposals: [], platform: { chosen: null } })
    expect(intake.targetProfile).toEqual({ profileId: 'wordpress-theme', profileVersion: 1 })
    expect(intake.updatedAt).toBe(PROJECT_CREATED_AT.toISOString())
    expect(routeState.store.intakes).toHaveLength(0)
  })

  it('seeds the business goal of the first draft from the project brief', async () => {
    const projectId = await createWordpressProject()
    const row = routeState.store.projects.find((project) => project.id === projectId)
    row.brief = '  Launch a small studio site that sells three services.  '
    const intake = await readIntake(projectId)
    expect(intake.intake.brief.businessGoal).toBe('Launch a small studio site that sells three services.')
    expect(routeState.store.intakes).toHaveLength(0)
  })

  it('leaves the business goal empty when the project brief is blank or too long for the field', async () => {
    const projectId = await createWordpressProject()
    const row = routeState.store.projects.find((project) => project.id === projectId)
    for (const brief of ['   ', 'x'.repeat(8001), null]) {
      row.brief = brief
      expect((await readIntake(projectId)).intake.brief.businessGoal).toBeNull()
    }
  })

  it('saves and resumes the draft; a proposals key in the body is ignored', async () => {
    const projectId = await createWordpressProject()
    const forged = loadIntakeFixture().proposals
    const saved = intakeResponseSchema.parse(
      await expectStatus(await putIntake(projectId, draft({ proposals: forged }), PROJECT_CREATED_AT.toISOString()), 200),
    )
    expect(saved.intake.proposals).toEqual([])
    const resumed = await readIntake(projectId)
    expect(resumed).toEqual(saved)
    expect(resumed.intake.step).toBe('scoping')
    expect(resumed.intake.questions.map((question) => question.id)).toEqual(['Q-001'])
  })

  it('keeps the server-owned proposal references when a later PUT sends none or forged ones', async () => {
    const projectId = await createWordpressProject()
    const imported = await expectStatus(await importProposal(projectId, proposal(projectId), PROJECT_CREATED_AT.toISOString()), 201)
    const forged = [{ ...loadIntakeFixture().proposals[0], proposalId: 'forged-proposal', status: 'accepted' }]
    const afterForged = intakeResponseSchema.parse(
      await expectStatus(await putIntake(projectId, draft({ proposals: forged }), imported.intakeUpdatedAt as string), 200),
    )
    expect(afterForged.intake.proposals.map((ref) => [ref.proposalId, ref.status])).toEqual([[imported.manifestId, 'proposed']])
    const afterEmpty = intakeResponseSchema.parse(
      await expectStatus(await putIntake(projectId, draft({ proposals: [] }), afterForged.updatedAt), 200),
    )
    expect(afterEmpty.intake.proposals.map((ref) => ref.proposalId)).toEqual([imported.manifestId])
  })

  it('refuses a write without the intake version header (428) and writes nothing', async () => {
    const projectId = await createWordpressProject()
    await expectFlowError(await putIntake(projectId, draft(), null), 428, 'optimistic_lock_required')
    expect(routeState.store.intakes).toHaveLength(0)
  })

  it('answers 409 on a stale intake version while a concurrent project edit keeps its own version', async () => {
    const projectId = await createWordpressProject()
    const first = await expectStatus(await putIntake(projectId, draft(), PROJECT_CREATED_AT.toISOString()), 200)

    const project = routeState.store.projects.find((row) => row.id === projectId)
    const projectLock = (project?.updatedAt as Date).toISOString()
    await expectStatus(
      await UPDATE_PROJECT(apiRequest('PUT', '/projects', { body: { id: projectId, name: 'Renamed portal' }, lock: projectLock })),
      200,
    )

    const stale = await putIntake(projectId, draft({ step: 'platform' }), PROJECT_CREATED_AT.toISOString())
    const conflict = await readBody(stale)
    expect({ status: stale.status, code: conflict.code }).toEqual({ status: 409, code: 'optimistic_lock_conflict' })

    const fresh = intakeResponseSchema.parse(await expectStatus(await putIntake(projectId, draft({ step: 'platform' }), first.updatedAt as string), 200))
    expect(fresh.intake.step).toBe('platform')
  })

  it('refuses a platform choice that differs from the frozen project profile (422)', async () => {
    const projectId = await createWordpressProject()
    const base = draft()
    const platform = base.platform as { chosen: Json }
    const body = { ...base, platform: { ...platform, chosen: { ...platform.chosen, profileId: 'react-vite' } } }
    await expectFlowError(await putIntake(projectId, body, PROJECT_CREATED_AT.toISOString()), 422, 'target_profile_frozen')
  })

  it.each([
    ['tenant', { tenantId: FOREIGN_TENANT_ID }],
    ['organization', { orgId: FOREIGN_ORG_ID }],
  ])('hides a project of another %s behind 404 on GET and PUT', async (_label, foreign) => {
    const projectId = await createWordpressProject()
    signInAs({ ...foreign, features: ALL_FEATURES })
    await expectFlowError(await getIntake(projectId), 404, 'not_found')
    await expectFlowError(await putIntake(projectId, draft(), PROJECT_CREATED_AT.toISOString()), 404, 'not_found')
    expect(routeState.store.intakes).toHaveLength(0)
  })

  it('keeps an archived project intake readable', async () => {
    const projectId = await createWordpressProject()
    const project = routeState.store.projects.find((row) => row.id === projectId)
    if (project) project.deletedAt = new Date()
    expect((await readIntake(projectId)).intake.step).toBe('brief')
  })
})

describe('POST /projects/:id/intake/proposals (F3)', () => {
  it('requires results.import and documents 201/200', () => {
    expect(isAllowedBy(proposalMetadata, 'POST', ['delivery_os.projects.view', 'delivery_os.projects.manage'])).toBe(false)
    expect(isAllowedBy(proposalMetadata, 'POST', EMPLOYEE_FEATURES)).toBe(true)
    const statuses = proposalOpenApi.methods.POST?.responses?.map((response) => response.status)
    expect(statuses).toEqual([201, 200])
  })

  it('imports a proposal (201) and answers a replay with the same body as a duplicate (200) without a lock', async () => {
    const projectId = await createWordpressProject()
    const created = await expectStatus(await importProposal(projectId, proposal(projectId), PROJECT_CREATED_AT.toISOString()), 201)
    expect(scopingProposalImportResponseSchema.parse(created)).toMatchObject({ projectId, duplicate: false })
    const intake = await readIntake(projectId)
    expect(intake.intake.proposals.map((ref) => ref.proposalId)).toEqual([created.manifestId])
    expect(intake.updatedAt).toBe(created.intakeUpdatedAt)

    const replay = await expectStatus(await importProposal(projectId, proposal(projectId)), 200)
    expect(replay).toEqual({ ...created, duplicate: true })
    expect((await readIntake(projectId)).intake.proposals).toHaveLength(1)
  })

  it('requires the intake version for a new manifest (428)', async () => {
    const projectId = await createWordpressProject()
    await expectFlowError(await importProposal(projectId, proposal(projectId)), 428, 'optimistic_lock_required')
    expect(routeState.store.intakes).toHaveLength(0)
  })

  it('refuses an unknown schema version with 422 unsupported_schema_version', async () => {
    const projectId = await createWordpressProject()
    const body = proposal(projectId, { schemaVersion: 'delivery.scoping-proposal/v9' })
    await expectFlowError(await importProposal(projectId, body, PROJECT_CREATED_AT.toISOString()), 422, 'unsupported_schema_version')
  })

  it('refuses a proposal for another project (422 foreign_reference)', async () => {
    const projectId = await createWordpressProject()
    const body = proposal('11111111-1111-4111-8111-111111111111')
    await expectFlowError(await importProposal(projectId, body, PROJECT_CREATED_AT.toISOString()), 422, 'foreign_reference')
  })

  it('refuses a scope proposal without scope content (422 manifest_required)', async () => {
    const projectId = await createWordpressProject()
    const body = proposal(projectId, { scope: null })
    await expectFlowError(await importProposal(projectId, body, PROJECT_CREATED_AT.toISOString()), 422, 'manifest_required')
  })

  it('ignores a trustedExecution option smuggled into the HTTP body', async () => {
    const projectId = await createWordpressProject()
    const body = { ...proposal(projectId), trustedExecution: { actorUserId: '66666666-6666-4666-8666-666666666666' } }
    await expectFlowError(await importProposal(projectId, body), 428, 'optimistic_lock_required')
  })

  it('hides a project of another organization behind 404', async () => {
    const projectId = await createWordpressProject()
    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFlowError(await importProposal(projectId, proposal(projectId), PROJECT_CREATED_AT.toISOString()), 404, 'not_found')
  })
})
