/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('../../api/__tests__/routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('../../api/__tests__/routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('../../api/__tests__/routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('../../api/__tests__/routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))

import '@open-mercato/core/modules/delivery_os/commands'
import { POST as CREATE_PROJECT, PUT as UPDATE_PROJECT } from '../../api/projects/route'
import { GET as PROJECT_DETAIL } from '../../api/projects/[id]/route'
import { POST as CREATE_BASELINE } from '../../api/projects/[id]/baselines/route'
import { POST as DECIDE } from '../../api/baselines/[id]/decisions/route'
import { POST as CREATE_TASK } from '../../api/projects/[id]/tasks/route'
import { PUT as UPDATE_TASK } from '../../api/tasks/route'
import { POST as RESERVE } from '../../api/tasks/[id]/attempts/route'
import { GET as PACKAGE } from '../../api/tasks/[id]/package/route'
import { POST as IMPORT_RESULT } from '../../api/tasks/[id]/results/route'
import { POST as RECORD_EVIDENCE } from '../../api/projects/[id]/evidence/route'
import { GET as REPORT } from '../../api/projects/[id]/report/route'
import { POST as DEPLOY } from '../../api/projects/[id]/deploy-decisions/route'
import { POST as RELEASE } from '../../api/projects/[id]/release-decisions/route'
import { apiRequest, detailCodesOf, expectFrozenError, readBody, resetRouteState, routeParams, routeState } from '../../api/__tests__/routeTestKit'
import { draftAttachmentRows, makeDraft } from './baselineTestKit'
import { formatRevisionRef } from '../reportQueries'
import { deliveryReportV1Schema, type DeliveryReportV1, type ResultManifestV1, type SourceRevision, type TaskPackageV1 } from '../../lib/contracts'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { TARGET_PROFILES } from '../../lib/targetProfiles'

type Json = Record<string, unknown>
type Flow = { projectId: string; baselineId: string; taskId: string }

const RAW_HASH = 'd'.repeat(64)
const BASE_REVISION = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const MANUAL_CHECK_ID = 'MC-visual-001'
const SCAN_CHECK_ID = 'dependency-audit'
const draft = makeDraft()
const allAcIds = (draft.acceptanceCriteria as Array<{ id: string }>).map((criterion) => criterion.id)
let clock = Date.parse('2026-09-19T08:00:00.000Z')

function tick(): void {
  clock += 1000
  jest.setSystemTime(clock)
}

async function expectStatus(response: Response, status: number): Promise<Json> {
  const body = await readBody(response)
  if (response.status !== status) expect({ status: response.status, body }).toEqual({ status })
  tick()
  return body
}

async function projectVersion(projectId: string): Promise<string> {
  const body = await expectStatus(await PROJECT_DETAIL(apiRequest('GET', `/projects/${projectId}`), routeParams(projectId)), 200)
  return body.updatedAt as string
}

async function taskVersion(taskId: string): Promise<string> {
  const task = routeState.store.tasks.find((row) => row.id === taskId)
  if (!task) throw new Error(`[internal] task ${taskId} is not in the route store`)
  return (task.updatedAt as Date).toISOString()
}

async function prepareReadyTask(): Promise<Flow> {
  const created = await expectStatus(
    await CREATE_PROJECT(apiRequest('POST', '/projects', {
      body: { name: 'Customer portal', inputMode: 'from_brief', targetProfileId: TARGET_PROFILES[0].id },
    })),
    201,
  )
  const projectId = created.id as string
  routeState.store.attachments.push(...draftAttachmentRows(draft))
  await expectStatus(
    await UPDATE_PROJECT(apiRequest('PUT', '/projects', { body: { id: projectId, draftSpec: draft }, lock: created.updatedAt as string })),
    200,
  )
  const baseline = await expectStatus(
    await CREATE_BASELINE(
      apiRequest('POST', `/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(projectId) }),
      routeParams(projectId),
    ),
    201,
  )
  const baselineId = baseline.baselineId as string
  for (const kind of ['requirements', 'design']) {
    const body = { kind, verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version }
    await expectStatus(
      await DECIDE(apiRequest('POST', `/baselines/${baselineId}/decisions`, { body, lock: await projectVersion(projectId) }), routeParams(baselineId)),
      201,
    )
  }
  const task = await expectStatus(
    await CREATE_TASK(
      apiRequest('POST', `/projects/${projectId}/tasks`, { body: { source: 'manual', baselineId, title: 'Service catalogue', acIds: allAcIds } }),
      routeParams(projectId),
    ),
    201,
  )
  const taskId = task.id as string
  await expectStatus(
    await UPDATE_TASK(apiRequest('PUT', '/tasks', { body: { id: taskId, status: 'ready' }, lock: task.updatedAt as string })),
    200,
  )
  return { projectId, baselineId, taskId }
}

async function deliverResult(flow: Flow, key: string, adjust: (manifest: ResultManifestV1) => ResultManifestV1 = (manifest) => manifest): Promise<SourceRevision> {
  const reserved = await expectStatus(
    await RESERVE(
      apiRequest('POST', `/tasks/${flow.taskId}/attempts`, {
        body: { mode: 'manual_handoff', baseRevision: BASE_REVISION },
        lock: await taskVersion(flow.taskId),
        headers: { 'Idempotency-Key': key },
      }),
      routeParams(flow.taskId),
    ),
    201,
  )
  const attemptId = reserved.attemptId as string
  const exported = await PACKAGE(apiRequest('GET', `/tasks/${flow.taskId}/package?attemptId=${attemptId}`), routeParams(flow.taskId))
  expect(exported.status).toBe(200)
  const manifest = adjust(buildResultManifest((await exported.json()) as TaskPackageV1))
  const accepted = await expectStatus(
    await IMPORT_RESULT(apiRequest('POST', `/tasks/${flow.taskId}/results`, { body: { attemptId, manifest } }), routeParams(flow.taskId)),
    201,
  )
  expect(accepted).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
  return manifest.resultRevision
}

function scanNotRun(manifest: ResultManifestV1): ResultManifestV1 {
  return {
    ...manifest,
    checks: manifest.checks.map((check) => (check.checkId === SCAN_CHECK_ID ? { ...check, status: 'not_run', exitCode: null } : check)),
  }
}

function recordEvidence(flow: Flow, body: Json): Promise<Response> {
  return RECORD_EVIDENCE(
    apiRequest('POST', `/projects/${flow.projectId}/evidence`, { body: { baselineId: flow.baselineId, ...body } }),
    routeParams(flow.projectId),
  )
}

async function review(flow: Flow, revision: SourceRevision, payload: Json): Promise<Json> {
  const body = { kind: 'review', taskId: flow.taskId, sourceRevision: revision, payload: { summary: 'Checked', findings: [], ...payload } }
  return expectStatus(await recordEvidence(flow, body), 201)
}

function verifyManualCheck(flow: Flow, revision: SourceRevision): Promise<Json> {
  return review(flow, revision, { verdict: 'approved', manualCheckId: MANUAL_CHECK_ID, reviewer: { kind: 'human' } })
}

async function recordScan(flow: Flow, revision: SourceRevision): Promise<void> {
  const payload = { checkId: SCAN_CHECK_ID, scanner: 'npm audit', status: 'passed', rawReportHash: RAW_HASH }
  await expectStatus(await recordEvidence(flow, { kind: 'scan', sourceRevision: revision, payload }), 201)
}

async function recordDeployment(flow: Flow, revision: SourceRevision, verified: boolean): Promise<string> {
  const buildId = `build-${formatRevisionRef(revision).slice(4, 12)}`
  const payload = {
    url: 'https://preview.example.test',
    environment: 'preview',
    buildId,
    deployedAt: new Date(clock).toISOString(),
    uploadStatus: 'succeeded',
    verification: verified
      ? { status: 'verified', checkedAt: new Date(clock).toISOString(), method: 'http-probe', observedBuildId: buildId }
      : null,
  }
  const body = await expectStatus(await recordEvidence(flow, { kind: 'deployment', sourceRevision: revision, payload }), 201)
  return body.evidenceId as string
}

async function reportOn(flow: Flow, revision: SourceRevision): Promise<DeliveryReportV1> {
  const path = `/projects/${flow.projectId}/report?revision=${encodeURIComponent(formatRevisionRef(revision))}`
  const response = await REPORT(apiRequest('GET', path), routeParams(flow.projectId))
  const body = await expectStatus(response, 200)
  expect(deliveryReportV1Schema.safeParse(body).success).toBe(true)
  return body as unknown as DeliveryReportV1
}

async function deploy(flow: Flow, revision: SourceRevision): Promise<Response> {
  return DEPLOY(
    apiRequest('POST', `/projects/${flow.projectId}/deploy-decisions`, {
      body: { baselineId: flow.baselineId, sourceRevision: revision, verdict: 'approved' },
      lock: await projectVersion(flow.projectId),
    }),
    routeParams(flow.projectId),
  )
}

async function release(flow: Flow, deploymentEvidenceId: string): Promise<Response> {
  return RELEASE(
    apiRequest('POST', `/projects/${flow.projectId}/release-decisions`, {
      body: { deploymentEvidenceId, verdict: 'approved' },
      lock: await projectVersion(flow.projectId),
    }),
    routeParams(flow.projectId),
  )
}

function blockers(report: DeliveryReportV1, gate: 'publishable' | 'releasable'): string[] {
  return report.gates[gate].blocking.map((blocker) => `${blocker.kind}:${blocker.id}=${blocker.status}`)
}

function acStatuses(report: DeliveryReportV1): Record<string, string> {
  return Object.fromEntries(report.acceptanceCriteria.map((criterion) => [criterion.acId, criterion.status]))
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] })
  jest.setSystemTime(clock)
})

afterAll(() => {
  jest.useRealTimers()
})

beforeEach(() => {
  resetRouteState()
})

describe('delivery_os publication chain (OSS-05 H26)', () => {
  it('walks report → deploy consent → verified deployment → release, and a new revision voids the old consent', async () => {
    const flow = await prepareReadyTask()
    const revisionA = await deliverResult(flow, 'publication-a')

    const greenA = await reportOn(flow, revisionA)
    expect(greenA.revision).toEqual(revisionA)
    expect(acStatuses(greenA)).toEqual({ 'AC-001': 'passed', 'AC-002': 'passed', 'AC-003': 'manual_pending' })
    expect(greenA.scans).toEqual([expect.objectContaining({ checkId: SCAN_CHECK_ID, status: 'present' })])
    expect(greenA.gates.publishable).toEqual({ ok: true, blocking: [] })
    expect(blockers(greenA, 'releasable')).toEqual([
      'ac:AC-003=manual_pending',
      'deploy_decision:deploy=missing',
      'deployment:deployment=missing',
    ])

    const unverifiedA = await recordDeployment(flow, revisionA, false)
    await expectFrozenError(await release(flow, unverifiedA), 422, 'deployment_unverified')

    const consentA = await expectStatus(await deploy(flow, revisionA), 201)
    await expectFrozenError(await release(flow, unverifiedA), 422, 'deployment_unverified')

    const verifiedA = await recordDeployment(flow, revisionA, true)
    const manualPending = await expectFrozenError(await release(flow, verifiedA), 422, 'report_not_green')
    expect(detailCodesOf(manualPending)).toEqual(['manual_pending'])
    expect(routeState.store.decisions.filter((decision) => decision.kind === 'release')).toHaveLength(0)

    await verifyManualCheck(flow, revisionA)
    const releasableA = await reportOn(flow, revisionA)
    expect(releasableA.gates.releasable).toEqual({ ok: true, blocking: [] })
    expect(releasableA.deployment).toMatchObject({ status: 'verified', evidenceId: verifiedA })
    const releaseA = await expectStatus(await release(flow, verifiedA), 201)

    const onA = await reportOn(flow, revisionA)
    expect(onA.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: consentA.decisionId, kind: 'deploy', appliesToRevision: true }),
        expect.objectContaining({ id: releaseA.decisionId, kind: 'release', subjectId: verifiedA, appliesToRevision: true }),
      ]),
    )

    await review(flow, revisionA, { verdict: 'changes_requested', reviewer: { kind: 'agent', ref: 'delivery-reviewer' } })
    const revisionB = await deliverResult(flow, 'publication-b', scanNotRun)
    expect(revisionB).not.toEqual(revisionA)

    const onB = await reportOn(flow, revisionB)
    expect(onB.revision).toEqual(revisionB)
    expect(onB.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: consentA.decisionId, kind: 'deploy', appliesToRevision: false }),
        expect.objectContaining({ id: releaseA.decisionId, kind: 'release', appliesToRevision: false }),
      ]),
    )
    expect(onB.gates.publishable.ok).toBe(false)
    expect(blockers(onB, 'publishable')).toEqual([`scan:${SCAN_CHECK_ID}=missing`])
    expect(onB.gates.releasable.ok).toBe(false)
    expect(blockers(onB, 'releasable')).toEqual([
      `scan:${SCAN_CHECK_ID}=missing`,
      'ac:AC-003=manual_pending',
      'deploy_decision:deploy=missing',
      'deployment:deployment=missing',
    ])

    await expectFrozenError(await deploy(flow, revisionB), 422, 'report_not_green')
    await recordScan(flow, revisionB)
    const verifiedB = await recordDeployment(flow, revisionB, true)
    await verifyManualCheck(flow, revisionB)
    const mismatch = await expectFrozenError(await release(flow, verifiedB), 422, 'revision_mismatch')
    expect(detailCodesOf(mismatch)).toEqual(['deploy_revision_mismatch'])
    expect(routeState.store.decisions.filter((decision) => decision.kind === 'release')).toHaveLength(1)

    const onlyConsentMissing = await reportOn(flow, revisionB)
    expect(onlyConsentMissing.gates.publishable).toEqual({ ok: true, blocking: [] })
    expect(blockers(onlyConsentMissing, 'releasable')).toEqual(['deploy_decision:deploy=missing'])

    const consentB = await expectStatus(await deploy(flow, revisionB), 201)
    const releaseB = await expectStatus(await release(flow, verifiedB), 201)
    const finalB = await reportOn(flow, revisionB)
    expect(finalB.gates.releasable).toEqual({ ok: true, blocking: [] })
    expect(finalB.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: consentB.decisionId, kind: 'deploy', appliesToRevision: true }),
        expect.objectContaining({ id: releaseB.decisionId, kind: 'release', appliesToRevision: true }),
        expect.objectContaining({ id: releaseA.decisionId, appliesToRevision: false }),
      ]),
    )
  })
})
