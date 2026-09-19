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
import { GET, metadata, openApi } from '../projects/[id]/report/route'
import { POST as IMPORT_RESULT } from '../tasks/[id]/results/route'
import { BASELINE_ID, FOREIGN_ORG_ID, PROJECT_ID, makeBaseline, type Row } from '../../commands/__tests__/baselineTestKit'
import { formatRevisionRef } from '../../commands/reportQueries'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { deliveryReportV1Schema, type DeliveryReportV1, type SourceRevision } from '../../lib/contracts'
import { exportPackage, reserveAttemptId, seedReadyTask } from './attemptRouteKit'
import {
  EM_WRITE_METHODS,
  findMock,
  FOREIGN_TENANT_ID,
  TASK_ID,
  VIEW_ONLY,
  apiRequest,
  detailCodesOf,
  em,
  expectFrozenError,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

const OTHER_BASELINE_ID = '5b5b5b5b-5555-4555-8555-555555555555'
const OTHER_PROJECT_ID = '45454545-4444-4444-8444-444444444444'
const OTHER_REVISION: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }

function getReport(query: Record<string, string> = {}, projectId: string = PROJECT_ID): Promise<Response> {
  const search = new URLSearchParams(query).toString()
  return GET(apiRequest('GET', `/projects/${projectId}/report${search ? `?${search}` : ''}`), routeParams(projectId))
}

async function readReport(response: Response): Promise<DeliveryReportV1> {
  const body = await response.json()
  expect(response.status).toBe(200)
  const parsed = deliveryReportV1Schema.safeParse(body)
  expect(parsed.success).toBe(true)
  return body as DeliveryReportV1
}

function clearWriteSpies(): void {
  for (const method of EM_WRITE_METHODS) em[method].mockClear()
  routeState.writes = 0
}

function expectNoWrites(): void {
  for (const method of EM_WRITE_METHODS) expect(em[method]).not.toHaveBeenCalled()
  expect(routeState.writes).toBe(0)
}

async function seedManualFlowResult(): Promise<SourceRevision> {
  seedReadyTask()
  const attemptId = await reserveAttemptId()
  const manifest = buildResultManifest(await exportPackage(attemptId))
  const imported = await IMPORT_RESULT(
    apiRequest('POST', `/tasks/${TASK_ID}/results`, { body: { attemptId, manifest } }),
    routeParams(TASK_ID),
  )
  if (imported.status !== 201) throw new Error(`[internal] fixture result import answered ${imported.status}`)
  clearWriteSpies()
  return manifest.resultRevision
}

function statusOf(report: DeliveryReportV1, acId: string): string | undefined {
  return report.acceptanceCriteria.find((criterion) => criterion.acId === acId)?.status
}

beforeEach(() => {
  resetRouteState()
})

describe('GET /api/delivery_os/projects/:id/report — guards', () => {
  it('requires projects.view and answers 401 without a session', async () => {
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'GET', ['delivery_os.results.import'])).toBe(false)
    expect(isAllowedBy(metadata, 'GET', [])).toBe(false)
    routeState.auth = null
    expect((await getReport()).status).toBe(401)
  })
})

describe('GET /api/delivery_os/projects/:id/report', () => {
  it('reports the manual-flow result: AC passed on the result revision, missing on another, zero writes', async () => {
    const resultRevision = await seedManualFlowResult()
    signInAs({ features: VIEW_ONLY })

    const byDefault = await readReport(await getReport())
    expect(byDefault).toMatchObject({ projectId: PROJECT_ID, baselineId: BASELINE_ID, revision: resultRevision, revisionSource: 'latest_result' })
    expect(statusOf(byDefault, 'AC-001')).toBe('passed')
    expect(statusOf(byDefault, 'AC-002')).toBe('missing')
    expect(statusOf(byDefault, 'AC-003')).toBe('manual_pending')
    const testRow = byDefault.rows.find((row) => row.acId === 'AC-001' && row.testId)
    expect(testRow?.evidenceId).toBe(routeState.store.evidence[0].id)

    const selected = await readReport(await getReport({ revision: formatRevisionRef(resultRevision), baselineId: BASELINE_ID }))
    expect(selected).toMatchObject({ revisionSource: 'selected' })
    expect(statusOf(selected, 'AC-001')).toBe('passed')

    const other = await readReport(await getReport({ revision: formatRevisionRef(OTHER_REVISION) }))
    expect(other.revision).toEqual(OTHER_REVISION)
    expect(statusOf(other, 'AC-001')).toBe('missing')
    expect(other.gates.publishable.ok).toBe(false)
    expectNoWrites()
  })

  it('answers the report with revision none, nothing passed and both gates blocked before any result', async () => {
    seedReadyTask()
    const report = await readReport(await getReport())
    expect(report).toMatchObject({ revision: null, revisionSource: 'none', progress: { proven: 0, total: 3 } })
    expect(report.acceptanceCriteria.map((criterion) => criterion.status)).toEqual(['missing', 'missing', 'manual_pending'])
    expect(report.gates.publishable.ok).toBe(false)
    expect(report.gates.publishable.blocking).toContainEqual({ kind: 'revision', id: 'revision', status: 'missing' })
    expect(report.gates.releasable.ok).toBe(false)
    expectNoWrites()
  })

  it('answers 404 for a second tenant, a second organization and a malformed project id', async () => {
    await seedManualFlowResult()
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await getReport(), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await getReport({}, 'nope'), 404, 'not_found')
    await expectFrozenError(await getReport({}, OTHER_PROJECT_ID), 404, 'not_found')
    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFrozenError(await getReport({ revision: 'bad' }), 404, 'not_found')
    expectNoWrites()
  })

  it('answers 404 for a baseline of another project and for a project without an active baseline', async () => {
    seedReadyTask()
    routeState.store.baselines.push(makeBaseline(undefined, { id: OTHER_BASELINE_ID, projectId: OTHER_PROJECT_ID }) as unknown as Row)
    const foreign = await expectFrozenError(await getReport({ baselineId: OTHER_BASELINE_ID }), 404, 'not_found')
    expect(detailCodesOf(foreign)).toEqual(['not_found'])

    routeState.store.projects[0].activeBaselineId = null
    const none = await expectFrozenError(await getReport(), 404, 'not_found')
    expect(detailCodesOf(none)).toEqual(['no_active_baseline'])
    expect((await getReport({ baselineId: BASELINE_ID })).status).toBe(200)
  })

  it('answers 422 invalid_revision for an unparsable revision and for a snapshot on a git profile', async () => {
    seedReadyTask()
    for (const revision of ['', 'abc', 'git:xyz', 'svn:1', 'snapshot:nothex:ws', `git:${'a'.repeat(2000)}`]) {
      const body = await expectFrozenError(await getReport({ revision }), 422, 'invalid_revision')
      expect(detailCodesOf(body)).toEqual(['revision_unparsable'])
    }
    const snapshot = formatRevisionRef({ kind: 'snapshot', contentHash: 'b'.repeat(64), externalWorkspaceId: 'ws:1' })
    const body = await expectFrozenError(await getReport({ revision: snapshot }), 422, 'invalid_revision')
    expect(detailCodesOf(body)).toEqual(['revision_kind_mismatch'])
  })

  it('carries decisions with appliesToRevision and reads every row with tenant and organization filters', async () => {
    const resultRevision = await seedManualFlowResult()
    const baseline = routeState.store.baselines[0]
    routeState.store.decisions.push(
      {
        id: '3e3e3e3e-3333-4333-8333-333333333333',
        tenantId: baseline.tenantId,
        organizationId: baseline.organizationId,
        projectId: PROJECT_ID,
        kind: 'deploy',
        subjectType: 'baseline',
        subjectId: BASELINE_ID,
        subjectHash: baseline.contentHash,
        subjectVersion: 1,
        sourceRevision: resultRevision,
        verdict: 'approved',
        reason: null,
        actorUserId: routeState.auth?.sub,
        decidedAt: new Date('2026-09-19T11:00:00.000Z'),
      },
      { id: '3f3f3f3f-3333-4333-8333-333333333333', organizationId: FOREIGN_ORG_ID, tenantId: baseline.tenantId, projectId: PROJECT_ID, kind: 'deploy' },
    )
    routeState.store.evidence.push({ ...routeState.store.evidence[0], id: '3d3d3d3d-3d3d-4333-8333-333333333333', organizationId: FOREIGN_ORG_ID })
    findMock.findWithDecryption.mockClear()

    const onResult = await readReport(await getReport())
    expect(onResult.decisions).toEqual([
      expect.objectContaining({ kind: 'deploy', verdict: 'approved', sourceRevision: resultRevision, appliesToRevision: true }),
    ])
    expect(onResult.rows.every((row) => row.evidenceId !== '3d3d3d3d-3d3d-4333-8333-333333333333')).toBe(true)
    for (const [, , where] of findMock.findWithDecryption.mock.calls) {
      expect(where).toMatchObject({ projectId: PROJECT_ID, tenantId: baseline.tenantId, organizationId: baseline.organizationId })
    }
    const other = await readReport(await getReport({ revision: formatRevisionRef(OTHER_REVISION) }))
    expect(other.decisions).toEqual([expect.objectContaining({ kind: 'deploy', appliesToRevision: false })])
    expectNoWrites()
  })

  it('answers 400 for a malformed baselineId or limit', async () => {
    seedReadyTask()
    await expectFrozenError(await getReport({ baselineId: 'nope' }), 400, 'validation_failed')
    await expectFrozenError(await getReport({ limit: '0' }), 400, 'validation_failed')
    await expectFrozenError(await getReport({ limit: '1001' }), 400, 'validation_failed')
  })

  it('caps rows with limit and reports truncated', async () => {
    await seedManualFlowResult()
    const full = await readReport(await getReport())
    expect(full.truncated).toBe(false)
    expect(full.totalRows).toBeGreaterThan(1)
    const capped = await readReport(await getReport({ limit: '1' }))
    expect(capped).toMatchObject({ limit: 1, truncated: true, totalRows: full.totalRows })
    expect(capped.rows).toHaveLength(1)
  })

  it('keeps an archived project and an archived task readable', async () => {
    await seedManualFlowResult()
    routeState.store.projects[0].deletedAt = new Date()
    routeState.store.tasks[0].deletedAt = new Date()
    const report = await readReport(await getReport())
    expect(statusOf(report, 'AC-001')).toBe('passed')
    expect(report.acceptanceCriteria.find((criterion) => criterion.acId === 'AC-001')?.taskIds).toEqual([TASK_ID])
  })

  it('answers 422 for an unknown project profile and for altered stored baseline content', async () => {
    seedReadyTask()
    const project = routeState.store.projects[0]
    project.targetProfileId = 'unknown-profile'
    await expectFrozenError(await getReport(), 422, 'unknown_target_profile')

    resetRouteState()
    seedReadyTask()
    const baseline = routeState.store.baselines[0]
    baseline.content = { ...(baseline.content as Row), acTestMap: {} }
    const altered = await expectFrozenError(await getReport(), 422, 'hash_mismatch')
    expect(detailCodesOf(altered)).toEqual(['stored_content_altered'])
    expect(await readBody(await getReport({ revision: 'bad' }))).toMatchObject({ code: 'invalid_revision' })
  })
})
