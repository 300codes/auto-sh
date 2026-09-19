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
import { metadata, openApi } from '../projects/[id]/stages/[stageId]/decisions/route'
import { FOREIGN_ORG_ID, STALE_UPDATED_AT } from '../../commands/__tests__/baselineTestKit'
import {
  deliveryFlowErrorBodySchema,
  stageDecisionListResponseSchema,
  stageDecisionResponseSchema,
  type ClientApproval,
} from '../../lib/contracts'
import { projectVersion, expectStatus, type Json } from './flowHelpers'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  VIEW_ONLY,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeState,
  signInAs,
} from './routeTestKit'
import {
  approvalFor,
  approveStage,
  createPinnedProject,
  designArtifact,
  listDecisions,
  postDecision,
  recordArtifact,
  scopeArtifact,
  type ArtifactRef,
} from './stageRouteKit'

const CLIENT_APPROVAL: ClientApproval = {
  approverName: 'Anna Kowalska',
  approverRole: 'Owner',
  evidence: { kind: 'meeting', reference: 'Review call 2026-09-19', attachment: null, recordedAt: '2026-09-19T10:00:00.000Z' },
}

async function expectFlowError(response: Response, status: number, code: string): Promise<Json> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(body).success).toBe(true)
  return body
}

async function projectWithScope(): Promise<{ projectId: string; scope: ArtifactRef }> {
  const projectId = await createPinnedProject()
  return { projectId, scope: await recordArtifact(projectId, scopeArtifact(projectId)) }
}

beforeEach(() => {
  resetRouteState()
})

describe('POST /projects/:id/stages/:stageId/decisions (F8)', () => {
  it('requires stages.approve, which a manage-only user does not carry', () => {
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.stages.approve'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(openApi.methods.POST?.responses?.map((response) => response.status)).toEqual([201, 200])
  })

  it('refuses a manage-only caller in the command too (stage approverFeatures, 403) and writes nothing', async () => {
    const { projectId, scope } = await projectWithScope()
    const lock = await projectVersion(projectId)
    signInAs({ features: EMPLOYEE_FEATURES })
    await expectFlowError(await postDecision(projectId, 'scope', approvalFor(scope), { key: 'k-403', lock }), 403, 'forbidden')
    expect(routeState.store.stageDecisions).toHaveLength(0)
  })

  it('checks the path stage before the Idempotency-Key and the body', async () => {
    const { projectId } = await projectWithScope()
    await expectFlowError(await postDecision(projectId, 'deploy', { garbage: true }, { key: null, lock: null }), 422, 'stage_unknown')
  })

  it('answers 400 idempotency_key_required without the header and 400 validation_failed for a malformed body', async () => {
    const { projectId, scope } = await projectWithScope()
    const lock = await projectVersion(projectId)
    await expectFlowError(await postDecision(projectId, 'scope', approvalFor(scope), { key: null, lock }), 400, 'idempotency_key_required')
    await expectFlowError(await postDecision(projectId, 'scope', { verdict: 'maybe' }, { key: 'k-bad', lock }), 400, 'validation_failed')
    await expectFlowError(
      await postDecision(projectId, 'scope', approvalFor(scope, { verdict: 'rejected' }), { key: 'k-reason', lock }),
      422,
      'reason_required',
    )
    expect(routeState.store.stageDecisions).toHaveLength(0)
  })

  it('records a decision (201), replays the same key and body with 200 duplicate without a header, and refuses another body (409)', async () => {
    const { projectId, scope } = await projectWithScope()
    const created = await approveStage(projectId, 'scope', scope, 'k-1')
    expect(stageDecisionResponseSchema.parse(created)).toMatchObject({ verdict: 'approved', currency: 'approved', duplicate: false })
    const replay = await expectStatus(await postDecision(projectId, 'scope', approvalFor(scope), { key: 'k-1', lock: null }), 200)
    expect(replay).toMatchObject({ decisionId: created.decisionId, duplicate: true })
    const other = approvalFor(scope, { verdict: 'rejected', reason: 'Wrong audience' })
    await expectFlowError(await postDecision(projectId, 'scope', other, { key: 'k-1', lock: await projectVersion(projectId) }), 409, 'idempotency_conflict')
    expect(routeState.store.stageDecisions).toHaveLength(1)
  })

  it('requires the project header for a new key: 428 without, 409 when stale', async () => {
    const { projectId, scope } = await projectWithScope()
    await expectFlowError(await postDecision(projectId, 'scope', approvalFor(scope), { key: 'k-2', lock: null }), 428, 'optimistic_lock_required')
    const stale = await postDecision(projectId, 'scope', approvalFor(scope), { key: 'k-2', lock: STALE_UPDATED_AT })
    expect({ status: stale.status, code: (await readBody(stale)).code }).toEqual({ status: 409, code: 'optimistic_lock_conflict' })
    expect(routeState.store.stageDecisions).toHaveLength(0)
  })

  it('refuses a wrong subject hash (409 subject_hash_mismatch) and a superseded artifact (409 stage_artifact_stale)', async () => {
    const { projectId, scope } = await projectWithScope()
    const wrongHash = approvalFor(scope, { subjectHash: 'f'.repeat(64) })
    await expectFlowError(await postDecision(projectId, 'scope', wrongHash, { key: 'k-hash', lock: await projectVersion(projectId) }), 409, 'subject_hash_mismatch')
    await recordArtifact(projectId, scopeArtifact(projectId, 'Second scope version'))
    await expectFlowError(await postDecision(projectId, 'scope', approvalFor(scope), { key: 'k-old', lock: await projectVersion(projectId) }), 409, 'stage_artifact_stale')
    expect(routeState.store.stageDecisions).toHaveLength(0)
  })

  it('requires the client approval on a client stage (422 client_approval_required) and stores it', async () => {
    const { projectId, scope } = await projectWithScope()
    await approveStage(projectId, 'scope', scope, 'k-scope')
    const ux = await recordArtifact(projectId, designArtifact(projectId, 'ux', [{ stageId: 'scope', ...scope }]))
    await approveStage(projectId, 'ux', ux, 'k-ux')
    const keyVisual = await recordArtifact(
      projectId,
      designArtifact(projectId, 'key_visual', [
        { stageId: 'scope', ...scope },
        { stageId: 'ux', ...ux },
      ]),
    )
    await expectFlowError(
      await postDecision(projectId, 'key_visual', approvalFor(keyVisual), { key: 'k-kv', lock: await projectVersion(projectId) }),
      422,
      'client_approval_required',
    )
    const approved = await approveStage(projectId, 'key_visual', keyVisual, 'k-kv-client', { clientApproval: CLIENT_APPROVAL })
    expect(approved).toMatchObject({ clientApproved: true, currency: 'approved' })

    const history = stageDecisionListResponseSchema.parse(await expectStatus(await listDecisions(projectId, 'key_visual'), 200))
    expect(history.items).toHaveLength(1)
    expect(history.items[0]).toMatchObject({ clientApproved: true, clientApproval: CLIENT_APPROVAL, verdict: 'approved' })
    expect(history.items[0]).not.toHaveProperty('idempotencyKey')
    expect(history.items[0]).not.toHaveProperty('requestHash')
  })

  it.each([
    ['tenant', { tenantId: FOREIGN_TENANT_ID }],
    ['organization', { orgId: FOREIGN_ORG_ID }],
  ])('hides a project of another %s behind 404 for POST and GET', async (_label, foreign) => {
    const { projectId, scope } = await projectWithScope()
    const lock = await projectVersion(projectId)
    signInAs(foreign)
    await expectFlowError(await postDecision(projectId, 'scope', approvalFor(scope), { key: 'k-foreign', lock }), 404, 'not_found')
    await expectFlowError(await listDecisions(projectId, 'scope'), 404, 'not_found')
    expect(routeState.store.stageDecisions).toHaveLength(0)
  })
})

describe('GET /projects/:id/stages/:stageId/decisions (F9)', () => {
  it('lists decisions newest first, pages, and caps pageSize at 100', async () => {
    const { projectId, scope } = await projectWithScope()
    await approveStage(projectId, 'scope', scope, 'k-a')
    await expectStatus(
      await postDecision(projectId, 'scope', approvalFor(scope, { verdict: 'rejected', reason: 'Missing booking page' }), {
        key: 'k-b',
        lock: await projectVersion(projectId),
      }),
      201,
    )
    await approveStage(projectId, 'scope', scope, 'k-c')
    routeState.store.stageDecisions.forEach((row, index) => {
      row.decidedAt = new Date(Date.UTC(2026, 8, 19, 10, index))
    })

    const list = stageDecisionListResponseSchema.parse(await expectStatus(await listDecisions(projectId, 'scope'), 200))
    expect(list.total).toBe(3)
    expect(list.items.map((item) => item.verdict)).toEqual(['approved', 'rejected', 'approved'])
    expect(list.items[1]).toMatchObject({ reason: 'Missing booking page', clientApproved: false, clientApproval: null })
    expect(list.items[0].decisionId).toBe(routeState.store.stageDecisions[2].id)

    const page = stageDecisionListResponseSchema.parse(await expectStatus(await listDecisions(projectId, 'scope', '?page=2&pageSize=2'), 200))
    expect({ total: page.total, ids: page.items.map((item) => item.decisionId) }).toEqual({ total: 3, ids: [routeState.store.stageDecisions[0].id] })
    await expectFlowError(await listDecisions(projectId, 'scope', '?pageSize=101'), 400, 'validation_failed')
    expect(await expectStatus(await listDecisions(projectId, 'ux'), 200)).toEqual({ items: [], total: 0 })
  })
})
