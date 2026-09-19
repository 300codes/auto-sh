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
import { PUT as UPDATE_PROJECT } from '../../api/projects/route'
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
import { GET as LIST_PUBLICATIONS, POST as PUBLISH } from '../../api/projects/[id]/publications/route'
import { createProject, expectStatus as expectRouteStatus, projectVersion, taskVersion, type Json } from '../../api/__tests__/flowHelpers'
import { apiRequest, readBody, resetRouteState, routeParams, routeState } from '../../api/__tests__/routeTestKit'
import { approveStage, createPinnedProject, designArtifact, recordArtifact, scopeArtifact, type ArtifactRef } from '../../api/__tests__/stageRouteKit'
import { draftAttachmentRows, makeDraft } from './baselineTestKit'
import { formatRevisionRef } from '../reportQueries'
import {
  deliveryFlowErrorBodySchema,
  type ClientApproval,
  deliveryReportV1Schema,
  publicationListResponseSchema,
  type FlowStageId,
  type PublicationResultV1,
  type SourceRevision,
  type TaskPackageV1,
} from '../../lib/contracts'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { hashCanonical } from '../../lib/hash'
import { createFakeDeployAdapter, type FakeDeployAdapter } from '../../lib/fixtures/flow/fakes'

type Flow = { projectId: string; baselineId: string; taskId: string }

const BASE_REVISION: SourceRevision = { kind: 'snapshot', contentHash: '7'.repeat(64), externalWorkspaceId: 'wp-local-1' }
const MANUAL_CHECK_ID = 'MC-visual-001'
const TARGET = { kind: 'wordpress', environment: 'preview', ref: 'psi-fryzjer-preview' } as const
const draft = makeDraft()
const allAcIds = (draft.acceptanceCriteria as Array<{ id: string }>).map((criterion) => criterion.id)
let clock = Date.parse('2026-09-19T08:00:00.000Z')
let deployAdapter: FakeDeployAdapter

function tick(): void {
  clock += 1000
  jest.setSystemTime(clock)
}

async function expectStatus(response: Response, status: number): Promise<Json> {
  const body = await expectRouteStatus(response, status)
  tick()
  return body
}

async function expectError(response: Response, status: number, code: string): Promise<Json> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(body).success).toBe(true)
  tick()
  return body
}

async function prepareReadyTask(projectId: string): Promise<Flow> {
  routeState.store.attachments.push(...draftAttachmentRows(draft))
  await expectStatus(
    await UPDATE_PROJECT(apiRequest('PUT', '/projects', { body: { id: projectId, draftSpec: draft }, lock: await projectVersion(projectId) })),
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
      apiRequest('POST', `/projects/${projectId}/tasks`, { body: { source: 'manual', baselineId, title: 'Salon home page', acIds: allAcIds } }),
      routeParams(projectId),
    ),
    201,
  )
  const taskId = task.id as string
  await expectStatus(await UPDATE_TASK(apiRequest('PUT', '/tasks', { body: { id: taskId, status: 'ready' }, lock: task.updatedAt as string })), 200)
  return { projectId, baselineId, taskId }
}

async function deliverResult(flow: Flow, key: string): Promise<SourceRevision> {
  const reserved = await expectStatus(
    await RESERVE(
      apiRequest('POST', `/tasks/${flow.taskId}/attempts`, {
        body: { mode: 'manual_handoff', baseRevision: BASE_REVISION },
        lock: taskVersion(flow.taskId),
        headers: { 'Idempotency-Key': key },
      }),
      routeParams(flow.taskId),
    ),
    201,
  )
  const attemptId = reserved.attemptId as string
  const exported = await PACKAGE(apiRequest('GET', `/tasks/${flow.taskId}/package?attemptId=${attemptId}`), routeParams(flow.taskId))
  expect(exported.status).toBe(200)
  const manifest = buildResultManifest((await exported.json()) as TaskPackageV1)
  const accepted = await expectStatus(
    await IMPORT_RESULT(apiRequest('POST', `/tasks/${flow.taskId}/results`, { body: { attemptId, manifest } }), routeParams(flow.taskId)),
    201,
  )
  expect(accepted).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
  return manifest.resultRevision
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

async function urlCheckEvidence(flow: Flow, revision: SourceRevision, url: string): Promise<string> {
  const rawReportHash = hashCanonical({ url, httpStatus: 200 })
  const payload = { checkId: 'publication-url-check', scanner: 'http-url-check', status: 'passed', rawReportHash }
  const body = await expectStatus(await recordEvidence(flow, { kind: 'scan', sourceRevision: revision, payload }), 201)
  return body.evidenceId as string
}

async function reportBody(flow: Flow, revision: SourceRevision): Promise<Json> {
  const path = `/projects/${flow.projectId}/report?revision=${encodeURIComponent(formatRevisionRef(revision))}`
  const body = await expectStatus(await REPORT(apiRequest('GET', path), routeParams(flow.projectId)), 200)
  expect(deliveryReportV1Schema.safeParse(body).success).toBe(true)
  return body
}

async function deploy(flow: Flow, revision: SourceRevision): Promise<string> {
  const response = await DEPLOY(
    apiRequest('POST', `/projects/${flow.projectId}/deploy-decisions`, {
      body: { baselineId: flow.baselineId, sourceRevision: revision, verdict: 'approved' },
      lock: await projectVersion(flow.projectId),
    }),
    routeParams(flow.projectId),
  )
  return (await expectStatus(response, 201)).decisionId as string
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

function published(flow: Flow, revision: SourceRevision, deployDecisionId: string, evidenceId: string | null = null): PublicationResultV1 {
  return deployAdapter.publish({
    projectId: flow.projectId,
    baselineId: flow.baselineId,
    sourceRevision: revision,
    deployDecisionId,
    target: TARGET,
    verified: evidenceId !== null,
    evidenceId,
  })
}

async function publish(flow: Flow, publication: PublicationResultV1): Promise<Response> {
  return PUBLISH(
    apiRequest('POST', `/projects/${flow.projectId}/publications`, { body: publication, lock: await projectVersion(flow.projectId) }),
    routeParams(flow.projectId),
  )
}

function deploymentRows(): number {
  return routeState.store.evidence.filter((row) => row.kind === 'deployment').length
}

async function approveAllStages(projectId: string): Promise<Record<FlowStageId, ArtifactRef>> {
  const scope = await recordArtifact(projectId, scopeArtifact(projectId))
  await approveStage(projectId, 'scope', scope, 'scope-1')
  const ux = await recordArtifact(projectId, designArtifact(projectId, 'ux', [{ stageId: 'scope', ...scope }]))
  await approveStage(projectId, 'ux', ux, 'ux-1')
  const keyVisual = await recordArtifact(projectId, designArtifact(projectId, 'key_visual', [{ stageId: 'ux', ...ux }]))
  await approveStage(projectId, 'key_visual', keyVisual, 'kv-1', { clientApproval: clientApproval() })
  const ui = await recordArtifact(projectId, designArtifact(projectId, 'design_system_ui', [{ stageId: 'key_visual', ...keyVisual }]))
  await approveStage(projectId, 'design_system_ui', ui, 'ui-1', { clientApproval: clientApproval() })
  return { scope, ux, key_visual: keyVisual, design_system_ui: ui }
}

function clientApproval(): ClientApproval {
  return {
    approverName: 'Anna Client',
    approverRole: 'Owner',
    evidence: { kind: 'meeting', reference: 'Review call 2026-09-19', attachment: null, recordedAt: '2026-09-19T10:00:00.000Z' },
  }
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
  deployAdapter = createFakeDeployAdapter()
})

describe('delivery_os publication chain R20 → F14 → R21 (FLOW-07 seam)', () => {
  it('publishes an approved revision through the fake deploy adapter and only a verified publication unlocks release', async () => {
    const created = await createProject({ targetProfileId: 'wordpress-theme' })
    const flow = await prepareReadyTask(created.id as string)
    const revisionA = await deliverResult(flow, 'wp-a')

    const legacyReport = await reportBody(flow, revisionA)
    expect({ mode: legacyReport.mode, flow: legacyReport.flow }).toEqual({ mode: 'legacy', flow: null })
    const consentA = await deploy(flow, revisionA)

    const unverified = await expectStatus(await publish(flow, published(flow, revisionA, consentA)), 201)
    await expectError(await release(flow, unverified.deploymentEvidenceId as string), 422, 'deployment_unverified')

    const checkId = await urlCheckEvidence(flow, revisionA, 'https://preview.example.test/psi-fryzjer-preview')
    const verified = await expectStatus(await publish(flow, published(flow, revisionA, consentA, checkId)), 201)
    expect(verified.deploymentEvidenceId).not.toBe(unverified.deploymentEvidenceId)
    await review(flow, revisionA, { verdict: 'approved', manualCheckId: MANUAL_CHECK_ID, reviewer: { kind: 'human' } })
    const releaseA = await expectStatus(await release(flow, verified.deploymentEvidenceId as string), 201)
    expect(releaseA.decisionId).toEqual(expect.any(String))

    const listed = publicationListResponseSchema.parse(
      await expectStatus(await LIST_PUBLICATIONS(apiRequest('GET', `/projects/${flow.projectId}/publications`), routeParams(flow.projectId)), 200),
    )
    expect(listed.items.map((item) => [item.publicationId, item.verification.status])).toEqual([
      [verified.publicationId, 'verified'],
      [unverified.publicationId, 'unverified'],
    ])

    await review(flow, revisionA, { verdict: 'changes_requested', reviewer: { kind: 'agent', ref: 'delivery-reviewer' } })
    const revisionB = await deliverResult(flow, 'wp-b')
    expect(revisionB).not.toEqual(revisionA)
    const rowsBefore = deploymentRows()
    const mismatch = await expectError(await publish(flow, published(flow, revisionB, consentA)), 422, 'revision_mismatch')
    expect((mismatch.details as Array<{ code: string }>).map((detail) => detail.code)).toContain('deploy_revision_mismatch')
    expect(deploymentRows()).toBe(rowsBefore)
    expect(routeState.store.publications).toHaveLength(2)
  })

  it('gates a pinned project: deploy consent needs a release candidate and the flow gate closes once the key visual is re-versioned', async () => {
    const projectId = await createPinnedProject()
    const refs = await approveAllStages(projectId)
    const flow = await prepareReadyTask(projectId)
    const revision = await deliverResult(flow, 'wp-pinned')

    const pinnedReport = await reportBody(flow, revision)
    expect(pinnedReport.mode).toBe('flow')
    expect(pinnedReport.flow).toMatchObject({ gate: { ok: true } })
    const refusedConsent = await DEPLOY(
      apiRequest('POST', `/projects/${flow.projectId}/deploy-decisions`, {
        body: { baselineId: flow.baselineId, sourceRevision: revision, verdict: 'approved' },
        lock: await projectVersion(flow.projectId),
      }),
      routeParams(flow.projectId),
    )
    const refusedBody = await readBody(refusedConsent)
    expect({ status: refusedConsent.status, code: refusedBody.code }).toEqual({ status: 422, code: 'release_candidate_required' })

    const revised = designArtifact(projectId, 'key_visual', [{ stageId: 'ux', ...refs.ux }])
    const keyVisualV2 = await recordArtifact(projectId, { ...revised, content: { ...revised.content, summary: 'key_visual package after client feedback' } } as typeof revised)
    await approveStage(projectId, 'key_visual', keyVisualV2, 'kv-2', { clientApproval: clientApproval() })
    const staleReport = await reportBody(flow, revision)
    expect(staleReport.flow).toMatchObject({ gate: { ok: false } })
    expect(deploymentRows()).toBe(0)
    expect(routeState.store.publications).toHaveLength(0)
  })
})
