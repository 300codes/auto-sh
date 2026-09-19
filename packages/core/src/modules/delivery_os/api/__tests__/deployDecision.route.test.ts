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
import { POST, metadata, openApi } from '../projects/[id]/deploy-decisions/route'
import { GET as REPORT } from '../projects/[id]/report/route'
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
import { formatRevisionRef } from '../../commands/reportQueries'
import { deliveryReportV1Schema, type DeliveryReportV1, type SourceRevision } from '../../lib/contracts'
import {
  ALL_FEATURES,
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
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

const REVISION: SourceRevision = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const OTHER_REVISION: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }
const RAW_HASH = 'd'.repeat(64)
let evidenceSeq = 0

function evidenceRow(kind: string, payload: unknown): Row {
  evidenceSeq += 1
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(evidenceSeq).padStart(12, '0')}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: null,
    kind,
    sourceRevision: REVISION,
    payload,
    rawReportHash: RAW_HASH,
    createdAt: new Date(Date.UTC(2026, 8, 19, 10, 0, evidenceSeq)),
  }
}

function seedEvidence(ac002Status: string): void {
  const content = routeState.store.baselines[0].content as { acTestMap: Record<string, string[]> }
  const check = (acId: string, status: string) => ({
    checkId: 'unit-tests',
    testId: content.acTestMap[acId][0],
    status,
    sourceRevision: REVISION,
    acIds: [],
    rawReportHash: RAW_HASH,
  })
  routeState.store.evidence.push(
    evidenceRow('test', { rawReportHash: RAW_HASH, checks: [check('AC-001', 'passed'), check('AC-002', ac002Status)] }),
    evidenceRow('scan', { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: RAW_HASH }),
  )
}

function postDecision(
  body: Row,
  options: { lock?: string | Date | null; projectId?: string } = {},
): Promise<Response> {
  const projectId = options.projectId ?? PROJECT_ID
  const lock = options.lock === undefined ? routeState.store.projects[0].updatedAt as Date : options.lock
  return POST(apiRequest('POST', `/projects/${projectId}/deploy-decisions`, { body, lock }), routeParams(projectId))
}

function approve(overrides: Row = {}, options: { lock?: string | Date | null; projectId?: string } = {}): Promise<Response> {
  return postDecision({ baselineId: BASELINE_ID, sourceRevision: REVISION, verdict: 'approved', ...overrides }, options)
}

async function reportOn(revision: SourceRevision): Promise<DeliveryReportV1> {
  const response = await REPORT(
    apiRequest('GET', `/projects/${PROJECT_ID}/report?revision=${encodeURIComponent(formatRevisionRef(revision))}`),
    routeParams(PROJECT_ID),
  )
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(deliveryReportV1Schema.safeParse(body).success).toBe(true)
  return body as DeliveryReportV1
}

beforeEach(() => {
  resetRouteState()
  routeState.store.projects.push(makeProject({ activeBaselineId: BASELINE_ID }) as unknown as Row)
  routeState.store.baselines.push(makeBaseline() as unknown as Row)
})

describe('POST /api/delivery_os/projects/:id/deploy-decisions — guards', () => {
  it('requires deploy.approve (manage-only and employee actors are refused) and answers 401 without a session', async () => {
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.deploy.approve'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ALL_FEATURES)).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.projects.view', 'delivery_os.projects.manage'])).toBe(false)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.baselines.approve'])).toBe(false)
    routeState.auth = null
    expect((await approve()).status).toBe(401)
  })
})

describe('POST /api/delivery_os/projects/:id/deploy-decisions', () => {
  it('answers 422 report_not_green listing the blocking AC on a red report and writes nothing', async () => {
    seedEvidence('failed')
    const body = await expectFrozenError(await approve(), 422, 'report_not_green')
    expect(body.details).toEqual([{ path: 'ac:AC-002', code: 'failed', message: 'ac AC-002 is failed' }])
    expect(routeState.store.decisions).toHaveLength(0)
  })

  it('answers 201 on a green report and the report applies the decision to that revision only', async () => {
    seedEvidence('passed')
    const response = await approve()
    expect(response.status).toBe(201)
    const body = await readBody(response)
    expect(Object.keys(body).sort()).toEqual(['decisionId', 'projectUpdatedAt'])
    expect(routeState.store.decisions).toEqual([
      expect.objectContaining({ id: body.decisionId, kind: 'deploy', subjectType: 'baseline', sourceRevision: REVISION }),
    ])
    expect(routeState.store.projects[0].updatedAt).toEqual(new Date(body.projectUpdatedAt as string))

    const onRevision = await reportOn(REVISION)
    expect(onRevision.gates.publishable.ok).toBe(true)
    expect(onRevision.decisions).toEqual([
      expect.objectContaining({ id: body.decisionId, kind: 'deploy', verdict: 'approved', appliesToRevision: true }),
    ])
    const onOther = await reportOn(OTHER_REVISION)
    expect(onOther.decisions).toEqual([expect.objectContaining({ id: body.decisionId, appliesToRevision: false })])
  })

  it('keeps the route on the deploy kind even when the body names another kind', async () => {
    seedEvidence('failed')
    const body = await expectFrozenError(await approve({ kind: 'requirements', projectId: FOREIGN_ORG_ID }), 422, 'report_not_green')
    expect(detailCodesOf(body)).toEqual(['failed'])
  })

  it('accepts a reject with a reason on a red report and refuses one without a reason', async () => {
    await expectFrozenError(await postDecision({ baselineId: BASELINE_ID, sourceRevision: REVISION, verdict: 'rejected' }), 422, 'reason_required')
    const response = await postDecision({ baselineId: BASELINE_ID, sourceRevision: REVISION, verdict: 'rejected', reason: 'Not yet' })
    expect(response.status).toBe(201)
  })

  it('answers 409 for a stale version, 428 without the header and 422 for a non-active baseline', async () => {
    seedEvidence('passed')
    const stale = await approve({}, { lock: STALE_UPDATED_AT })
    expect(stale.status).toBe(409)
    expect((await readBody(stale)).code).toBe('optimistic_lock_conflict')
    await expectFrozenError(await approve({}, { lock: null }), 428, 'optimistic_lock_required')
    routeState.store.projects[0].activeBaselineId = null
    await expectFrozenError(await approve({}, { lock: UPDATED_AT }), 422, 'baseline_not_active')
    expect(routeState.store.decisions).toHaveLength(0)
  })

  it('answers 404 for a foreign tenant, a foreign organization and a malformed project id', async () => {
    seedEvidence('passed')
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await approve(), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await approve({}, { projectId: 'nope' }), 404, 'not_found')
    expect(routeState.store.decisions).toHaveLength(0)
  })
})
