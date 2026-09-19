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
import { POST, metadata, openApi } from '../projects/[id]/release-decisions/route'
import { POST as DEPLOY } from '../projects/[id]/deploy-decisions/route'
import { GET as REPORT } from '../projects/[id]/report/route'
import {
  BASELINE_ID,
  FOREIGN_ORG_ID,
  ORG_ID,
  PROJECT_ID,
  STALE_UPDATED_AT,
  TENANT_ID,
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
const BUILD_ID = 'build-42'
let evidenceSeq = 0

function evidenceRow(kind: string, payload: unknown, revision: SourceRevision = REVISION): Row {
  evidenceSeq += 1
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(evidenceSeq).padStart(12, '0')}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: null,
    kind,
    sourceRevision: revision,
    payload,
    rawReportHash: RAW_HASH,
    createdAt: new Date(Date.UTC(2026, 8, 19, 8, 0, evidenceSeq)),
  }
}

function seedGreenEvidence(revision: SourceRevision = REVISION): void {
  const content = routeState.store.baselines[0].content as { acTestMap: Record<string, string[]> }
  const check = (acId: string) => ({
    checkId: 'unit-tests',
    testId: content.acTestMap[acId][0],
    status: 'passed',
    sourceRevision: revision,
    acIds: [],
    rawReportHash: RAW_HASH,
  })
  routeState.store.evidence.push(
    evidenceRow('test', { rawReportHash: RAW_HASH, checks: [check('AC-001'), check('AC-002')] }, revision),
    evidenceRow('scan', { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: RAW_HASH }, revision),
    evidenceRow(
      'review',
      { verdict: 'approved', summary: 'ok', findings: [], manualCheckId: 'MC-visual-001', reviewer: { kind: 'human' } },
      revision,
    ),
  )
}

function seedDeployment(verified: boolean, revision: SourceRevision = REVISION): string {
  const row = evidenceRow(
    'deployment',
    {
      url: 'https://preview.example.test',
      environment: 'preview',
      buildId: BUILD_ID,
      deployedAt: '2026-09-19T08:30:00.000Z',
      uploadStatus: 'succeeded',
      verification: verified
        ? { status: 'verified', checkedAt: '2026-09-19T08:31:00.000Z', method: 'http-probe', observedBuildId: BUILD_ID }
        : null,
    },
    revision,
  )
  routeState.store.evidence.push(row)
  return row.id as string
}

function lockNow(): Date {
  return routeState.store.projects[0].updatedAt as Date
}

async function approveDeploy(revision: SourceRevision = REVISION): Promise<void> {
  const response = await DEPLOY(
    apiRequest('POST', `/projects/${PROJECT_ID}/deploy-decisions`, {
      body: { baselineId: BASELINE_ID, sourceRevision: revision, verdict: 'approved' },
      lock: lockNow(),
    }),
    routeParams(PROJECT_ID),
  )
  expect(response.status).toBe(201)
}

function postRelease(body: Row, options: { lock?: string | Date | null; projectId?: string } = {}): Promise<Response> {
  const projectId = options.projectId ?? PROJECT_ID
  const lock = options.lock === undefined ? lockNow() : options.lock
  return POST(apiRequest('POST', `/projects/${projectId}/release-decisions`, { body, lock }), routeParams(projectId))
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

describe('POST /api/delivery_os/projects/:id/release-decisions — guards', () => {
  it('requires release.approve: deploy.approve alone, manage-only and employee actors are refused', async () => {
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.release.approve'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ALL_FEATURES)).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.deploy.approve'])).toBe(false)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.projects.view', 'delivery_os.projects.manage'])).toBe(false)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
    routeState.auth = null
    expect((await postRelease({ deploymentEvidenceId: seedDeployment(true), verdict: 'approved' })).status).toBe(401)
  })
})

describe('POST /api/delivery_os/projects/:id/release-decisions', () => {
  it('answers 201 when deploy consent, a verified deployment and the releasable report agree, and the report lists it', async () => {
    seedGreenEvidence()
    await approveDeploy()
    const deploymentId = seedDeployment(true)
    const response = await postRelease({ deploymentEvidenceId: deploymentId, verdict: 'approved' })
    expect(response.status).toBe(201)
    const body = await readBody(response)
    expect(Object.keys(body).sort()).toEqual(['decisionId', 'projectUpdatedAt'])
    expect(routeState.store.decisions).toEqual([
      expect.objectContaining({ kind: 'deploy' }),
      expect.objectContaining({
        id: body.decisionId,
        kind: 'release',
        subjectType: 'deployment_evidence',
        subjectId: deploymentId,
        sourceRevision: REVISION,
      }),
    ])
    expect(routeState.store.projects[0].updatedAt).toEqual(new Date(body.projectUpdatedAt as string))

    const onRevision = await reportOn(REVISION)
    expect(onRevision.gates.releasable.ok).toBe(true)
    expect(onRevision.decisions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: body.decisionId, kind: 'release', appliesToRevision: true })]),
    )
    const onOther = await reportOn(OTHER_REVISION)
    expect(onOther.decisions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: body.decisionId, appliesToRevision: false })]),
    )
  })

  it('answers 422 deployment_unverified for an unverified deployment and writes nothing', async () => {
    seedGreenEvidence()
    await approveDeploy()
    await expectFrozenError(await postRelease({ deploymentEvidenceId: seedDeployment(false), verdict: 'approved' }), 422, 'deployment_unverified')
    expect(routeState.store.decisions.map((decision) => decision.kind)).toEqual(['deploy'])
  })

  it('answers 422 revision_mismatch for a deployment on revision B with consent on revision A', async () => {
    seedGreenEvidence()
    seedGreenEvidence(OTHER_REVISION)
    await approveDeploy(REVISION)
    const body = await expectFrozenError(
      await postRelease({ deploymentEvidenceId: seedDeployment(true, OTHER_REVISION), verdict: 'approved' }),
      422,
      'revision_mismatch',
    )
    expect(detailCodesOf(body)).toEqual(['deploy_revision_mismatch'])
  })

  it('answers 422 deploy_decision_missing when a later deploy reject wins over the earlier approve', async () => {
    seedGreenEvidence()
    await approveDeploy()
    const reject = await DEPLOY(
      apiRequest('POST', `/projects/${PROJECT_ID}/deploy-decisions`, {
        body: { baselineId: BASELINE_ID, sourceRevision: REVISION, verdict: 'rejected', reason: 'Copy is wrong' },
        lock: lockNow(),
      }),
      routeParams(PROJECT_ID),
    )
    expect(reject.status).toBe(201)
    await expectFrozenError(await postRelease({ deploymentEvidenceId: seedDeployment(true), verdict: 'approved' }), 422, 'deploy_decision_missing')
  })

  it('keeps the route on the release kind even when the body names another kind or project', async () => {
    seedGreenEvidence()
    await approveDeploy()
    const deploymentId = seedDeployment(false)
    await expectFrozenError(
      await postRelease({ deploymentEvidenceId: deploymentId, verdict: 'approved', kind: 'deploy', projectId: FOREIGN_ORG_ID }),
      422,
      'deployment_unverified',
    )
  })

  it('accepts a reject with a reason and refuses one without a reason', async () => {
    const deploymentId = seedDeployment(false)
    await expectFrozenError(await postRelease({ deploymentEvidenceId: deploymentId, verdict: 'rejected' }), 422, 'reason_required')
    const response = await postRelease({ deploymentEvidenceId: deploymentId, verdict: 'rejected', reason: 'Broken header' })
    expect(response.status).toBe(201)
  })

  it('answers 409 for a stale version, 428 without the header and 404 for foreign scopes and unknown rows', async () => {
    seedGreenEvidence()
    await approveDeploy()
    const deploymentId = seedDeployment(true)
    const stale = await postRelease({ deploymentEvidenceId: deploymentId, verdict: 'approved' }, { lock: STALE_UPDATED_AT })
    expect(stale.status).toBe(409)
    await expectFrozenError(await postRelease({ deploymentEvidenceId: deploymentId, verdict: 'approved' }, { lock: null }), 428, 'optimistic_lock_required')
    await expectFrozenError(
      await postRelease({ deploymentEvidenceId: '9a9a9a9a-9999-4999-8999-999999999999', verdict: 'approved' }),
      404,
      'not_found',
    )
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await postRelease({ deploymentEvidenceId: deploymentId, verdict: 'approved' }), 404, 'not_found')
    }
    expect(routeState.store.decisions.map((decision) => decision.kind)).toEqual(['deploy'])
  })
})
