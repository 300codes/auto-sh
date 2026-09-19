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
import { metadata, openApi } from '../projects/[id]/stages/[stageId]/artifacts/route'
import { ACTOR_ID, FOREIGN_ORG_ID, STALE_UPDATED_AT } from '../../commands/__tests__/baselineTestKit'
import {
  deliveryFlowErrorBodySchema,
  stageArtifactCreateResponseSchema,
  stageArtifactListResponseSchema,
} from '../../lib/contracts'
import { loadNegativeFlowFixtures } from '../../lib/fixtures/flow/index'
import { createProject, expectStatus, projectVersion, type Json } from './flowHelpers'
import {
  ALL_FEATURES,
  FOREIGN_TENANT_ID,
  VIEW_ONLY,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeState,
  signInAs,
} from './routeTestKit'
import {
  approveStage,
  createPinnedProject,
  designArtifact,
  listArtifacts,
  postArtifact,
  recordArtifact,
  scopeArtifact,
} from './stageRouteKit'

const FOREIGN_ACTOR_ID = '88888888-8888-4888-8888-888888888888'

async function expectFlowError(response: Response, status: number, code: string): Promise<Json> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(body).success).toBe(true)
  return body
}

beforeEach(() => {
  resetRouteState()
})

describe('POST /projects/:id/stages/:stageId/artifacts (F7)', () => {
  it('declares projects.view for both verbs and documents 201/200', () => {
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'POST', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'POST', [])).toBe(false)
    expect(openApi.methods.POST?.responses?.map((response) => response.status)).toEqual([201, 200])
  })

  it('checks the path stage before the body: unknown stage 422, unpinned project 422', async () => {
    const pinned = await createPinnedProject()
    await expectFlowError(await postArtifact(pinned, 'brief', { garbage: true }, null), 422, 'stage_unknown')
    await expectFlowError(await postArtifact(pinned, 'implementation', { garbage: true }, null), 422, 'stage_unknown')
    const legacy = (await createProject({ targetProfileId: 'wordpress-theme' })).id as string
    await expectFlowError(await postArtifact(legacy, 'scope', { garbage: true }, null), 422, 'flow_not_pinned')
    expect(routeState.store.stageArtifacts).toHaveLength(0)
  })

  it('answers 400 validation_failed for an unknown stage inside the body (negative fixture)', async () => {
    const projectId = await createPinnedProject()
    const fixture = loadNegativeFlowFixtures().find((candidate) => candidate.name === 'stage-artifact.unknown-stage')
    const document = { ...(fixture?.document as Json), projectId }
    await expectFlowError(await postArtifact(projectId, 'scope', document, await projectVersion(projectId)), fixture?.expected.status ?? 400, 'validation_failed')
  })

  it('answers 422 for an unsupported schema version and for a body stage that differs from the path', async () => {
    const projectId = await createPinnedProject()
    const artifact = scopeArtifact(projectId)
    const lock = await projectVersion(projectId)
    await expectFlowError(await postArtifact(projectId, 'scope', { ...artifact, schemaVersion: 'delivery.stage-artifact/v9' }, lock), 422, 'unsupported_schema_version')
    await expectFlowError(await postArtifact(projectId, 'ux', artifact, lock), 422, 'foreign_reference')
  })

  it('records a version (201) and answers identical content with 200 duplicate without a header', async () => {
    const projectId = await createPinnedProject()
    const artifact = scopeArtifact(projectId)
    const created = await expectStatus(await postArtifact(projectId, 'scope', artifact, await projectVersion(projectId)), 201)
    expect(stageArtifactCreateResponseSchema.parse(created)).toMatchObject({ stageId: 'scope', version: 1, duplicate: false })
    const replay = await expectStatus(await postArtifact(projectId, 'scope', artifact, null), 200)
    expect(replay).toMatchObject({ artifactId: created.artifactId, duplicate: true, version: 1 })
    expect(routeState.store.stageArtifacts).toHaveLength(1)
  })

  it('ignores a trustedExecution option smuggled into the body (the actor stays the session user)', async () => {
    const projectId = await createPinnedProject()
    const body = { ...scopeArtifact(projectId), trustedExecution: { source: 'delivery_agents', actorUserId: FOREIGN_ACTOR_ID } }
    await expectStatus(await postArtifact(projectId, 'scope', body, await projectVersion(projectId)), 201)
    expect(routeState.store.stageArtifacts[0].createdBy).toBe(ACTOR_ID)
  })

  it('requires the project header for a new version: 428 without, 409 when stale', async () => {
    const projectId = await createPinnedProject()
    await expectFlowError(await postArtifact(projectId, 'scope', scopeArtifact(projectId), null), 428, 'optimistic_lock_required')
    const stale = await postArtifact(projectId, 'scope', scopeArtifact(projectId), STALE_UPDATED_AT)
    expect({ status: stale.status, code: (await readBody(stale)).code }).toEqual({ status: 409, code: 'optimistic_lock_conflict' })
    expect(routeState.store.stageArtifacts).toHaveLength(0)
  })

  it.each([
    ['view only, manual', VIEW_ONLY, 'manual'],
    ['manage without results.import, figma', ['delivery_os.projects.view', 'delivery_os.projects.manage'], 'figma'],
    ['results.import without manage, intake', ['delivery_os.projects.view', 'delivery_os.results.import'], 'intake'],
  ] as const)('refuses the source feature with 403 (%s)', async (_label, features, source) => {
    const projectId = await createPinnedProject()
    const lock = await projectVersion(projectId)
    signInAs({ features: [...features] })
    await expectFlowError(await postArtifact(projectId, 'scope', { ...scopeArtifact(projectId), source }, lock), 403, 'forbidden')
    expect(routeState.store.stageArtifacts).toHaveLength(0)
  })

  it('accepts an agent source with results.import only', async () => {
    const projectId = await createPinnedProject()
    const lock = await projectVersion(projectId)
    signInAs({ features: ['delivery_os.projects.view', 'delivery_os.results.import'] })
    await expectStatus(await postArtifact(projectId, 'scope', { ...scopeArtifact(projectId), source: 'agent' }, lock), 201)
  })

  it.each([
    ['tenant', { tenantId: FOREIGN_TENANT_ID }],
    ['organization', { orgId: FOREIGN_ORG_ID }],
  ])('hides a project of another %s behind 404 for POST and GET', async (_label, foreign) => {
    const projectId = await createPinnedProject()
    const lock = await projectVersion(projectId)
    signInAs(foreign)
    await expectFlowError(await postArtifact(projectId, 'scope', scopeArtifact(projectId), lock), 404, 'not_found')
    await expectFlowError(await listArtifacts(projectId, 'scope'), 404, 'not_found')
    expect(routeState.store.stageArtifacts).toHaveLength(0)
  })

  it('refuses a downstream artifact bound to a superseded upstream version with 409 stage_artifact_stale', async () => {
    const projectId = await createPinnedProject()
    const scopeV1 = await recordArtifact(projectId, scopeArtifact(projectId))
    await approveStage(projectId, 'scope', scopeV1, 'approve-scope-v1')
    const scopeV2 = await recordArtifact(projectId, scopeArtifact(projectId, 'Second scope version'))
    await approveStage(projectId, 'scope', scopeV2, 'approve-scope-v2')
    const ux = designArtifact(projectId, 'ux', [{ stageId: 'scope', ...scopeV1 }])
    await expectFlowError(await postArtifact(projectId, 'ux', ux, await projectVersion(projectId)), 409, 'stage_artifact_stale')
  })
})

describe('GET /projects/:id/stages/:stageId/artifacts (F9)', () => {
  it('lists versions newest first with the total and pages at most 100', async () => {
    const projectId = await createPinnedProject()
    await recordArtifact(projectId, scopeArtifact(projectId, 'First'))
    await recordArtifact(projectId, scopeArtifact(projectId, 'Second'))
    await recordArtifact(projectId, scopeArtifact(projectId, 'Third'))
    const list = stageArtifactListResponseSchema.parse(await expectStatus(await listArtifacts(projectId, 'scope'), 200))
    expect(list.total).toBe(3)
    expect(list.items.map((item) => item.version)).toEqual([3, 2, 1])
    expect(list.items[0]).toMatchObject({ stageId: 'scope', source: 'manual', content: expect.objectContaining({ summary: 'Third' }) })

    const second = stageArtifactListResponseSchema.parse(await expectStatus(await listArtifacts(projectId, 'scope', '?page=2&pageSize=1'), 200))
    expect({ total: second.total, versions: second.items.map((item) => item.version) }).toEqual({ total: 3, versions: [2] })
    await expectFlowError(await listArtifacts(projectId, 'scope', '?pageSize=101'), 400, 'validation_failed')
    expect(stageArtifactListResponseSchema.shape.items.safeParse(Array.from({ length: 101 }, () => list.items[0])).success).toBe(false)
  })

  it('lists only the path stage, answers an empty stage, and applies the path check', async () => {
    const projectId = await createPinnedProject()
    await recordArtifact(projectId, scopeArtifact(projectId))
    expect(await expectStatus(await listArtifacts(projectId, 'ux'), 200)).toEqual({ items: [], total: 0 })
    await expectFlowError(await listArtifacts(projectId, 'qa'), 422, 'stage_unknown')
    const legacy = (await createProject({ targetProfileId: 'wordpress-theme' })).id as string
    await expectFlowError(await listArtifacts(legacy, 'scope'), 422, 'flow_not_pinned')
  })

  it('is readable with projects.view only and never writes', async () => {
    const projectId = await createPinnedProject()
    await recordArtifact(projectId, scopeArtifact(projectId))
    const writes = routeState.writes
    signInAs({ features: VIEW_ONLY })
    await expectStatus(await listArtifacts(projectId, 'scope'), 200)
    expect(routeState.writes).toBe(writes)
    signInAs({ features: ALL_FEATURES })
  })
})
