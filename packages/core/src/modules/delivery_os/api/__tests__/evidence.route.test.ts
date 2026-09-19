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
import { POST, metadata, openApi } from '../projects/[id]/evidence/route'
import { BASELINE_ID, FOREIGN_ORG_ID, ORG_ID, PROJECT_ID, TENANT_ID } from '../../commands/__tests__/baselineTestKit'
import { emitDeliveryOsEvent } from '../../events'
import { loadResultManifestFixture } from '../../lib/fixtures'
import { evidenceRecordResponseSchema } from '../schemas'
import { seedReadyTask } from './attemptRouteKit'
import {
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  TASK_ID,
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

const GIT_REVISION = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const SHA = 'b'.repeat(64)

const scanBody = {
  kind: 'scan',
  baselineId: BASELINE_ID,
  sourceRevision: GIT_REVISION,
  payload: { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: SHA },
}

const deploymentBody = {
  kind: 'deployment',
  baselineId: BASELINE_ID,
  sourceRevision: GIT_REVISION,
  payload: {
    url: 'https://preview.example.test/build-42',
    environment: 'preview',
    buildId: 'build-42',
    deployedAt: '2026-09-19T10:10:00.000Z',
    uploadStatus: 'succeeded',
  },
}

const manifest = loadResultManifestFixture('git')

const reviewBody = {
  kind: 'review',
  baselineId: BASELINE_ID,
  taskId: TASK_ID,
  sourceRevision: manifest.resultRevision,
  payload: { verdict: 'approved', summary: 'All acceptance criteria are covered', reviewer: { kind: 'human' } },
}

function seedAcceptedResult(): void {
  routeState.store.tasks[0].status = 'awaiting_review'
  routeState.store.evidence.push({
    id: '9e9e9e9e-9999-4999-8999-999999999999',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: TASK_ID,
    attemptId: null,
    kind: 'result_manifest',
    source: 'adapter',
    sourceRevision: manifest.resultRevision,
    payload: manifest,
    payloadHash: SHA,
    rawReportHash: null,
    attachmentIds: [],
    recordedBy: null,
    createdAt: new Date('2026-09-18T08:30:00.000Z'),
  })
}

function recordEvidence(body: unknown, options: { projectId?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const projectId = options.projectId ?? PROJECT_ID
  return POST(apiRequest('POST', `/projects/${projectId}/evidence`, { body, headers: options.headers }), routeParams(projectId))
}

beforeEach(() => {
  resetRouteState()
  jest.mocked(emitDeliveryOsEvent).mockClear()
  seedReadyTask()
})

describe('POST /api/delivery_os/projects/:id/evidence — guards', () => {
  it('requires results.import and exposes POST only', () => {
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.results.import'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.*'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.projects.view', 'delivery_os.projects.manage', 'delivery_os.attempts.manage'])).toBe(false)
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    expect((await recordEvidence(scanBody)).status).toBe(401)
    expect(routeState.writes).toBe(0)
  })
})

describe('POST /api/delivery_os/projects/:id/evidence', () => {
  it('records evidence once: 201, then 200 duplicate with the same id and one row', async () => {
    const created = await recordEvidence(scanBody)
    expect(created.status).toBe(201)
    const createdBody = await readBody(created)
    expect(Object.keys(createdBody).sort()).toEqual(['duplicate', 'evidenceId'])
    expect(evidenceRecordResponseSchema.safeParse(createdBody).success).toBe(true)
    expect(createdBody.duplicate).toBe(false)

    const replay = await recordEvidence(scanBody)
    expect(replay.status).toBe(200)
    expect(await readBody(replay)).toEqual({ evidenceId: createdBody.evidenceId, duplicate: true })
    expect(routeState.store.evidence).toHaveLength(1)
    expect(routeState.store.evidence[0]).toMatchObject({ kind: 'scan', source: 'manual', projectId: PROJECT_ID, baselineId: BASELINE_ID, rawReportHash: SHA })
    expect(jest.mocked(emitDeliveryOsEvent).mock.calls.map(([id]) => id)).toEqual(['delivery_os.evidence.recorded', 'delivery_os.evidence.recorded'])
  })

  it('verifies the task through an approved review and answers the task status', async () => {
    seedAcceptedResult()
    const created = await recordEvidence(reviewBody)
    expect(created.status).toBe(201)
    const body = await readBody(created)
    expect(Object.keys(body).sort()).toEqual(['duplicate', 'evidenceId', 'taskStatus', 'taskStatusReason', 'taskUpdatedAt'])
    expect(evidenceRecordResponseSchema.safeParse(body).success).toBe(true)
    expect(body).toMatchObject({ duplicate: false, taskStatus: 'verified' })
    expect(routeState.store.tasks[0]).toMatchObject({ status: 'verified', statusReason: null })
    expect(jest.mocked(emitDeliveryOsEvent).mock.calls.map(([id]) => id)).toEqual(['delivery_os.evidence.recorded', 'delivery_os.task.updated'])

    const replay = await recordEvidence(reviewBody)
    expect(replay.status).toBe(200)
    expect(await readBody(replay)).toMatchObject({ evidenceId: body.evidenceId, duplicate: true, taskStatus: 'verified' })
    expect(routeState.store.evidence.filter((row) => row.kind === 'review')).toHaveLength(1)
  })

  it('answers 422 missing_required_tests when a required test did not pass on the result revision', async () => {
    seedAcceptedResult()
    const result = routeState.store.evidence[0]
    result.payload = { ...manifest, checks: manifest.checks.map((check) => (check.acIds.includes('AC-001') ? { ...check, status: 'not_run' } : check)) }
    const refused = await expectFrozenError(await recordEvidence(reviewBody), 422, 'missing_required_tests')
    expect(detailCodesOf(refused)).toEqual(['ac_unproven'])
    expect(routeState.store.tasks[0].status).toBe('awaiting_review')
    expect(routeState.store.evidence).toHaveLength(1)
  })

  it('never changes the task and stores a deployment without verification as unverified', async () => {
    const taskBefore = JSON.stringify(routeState.store.tasks)
    const response = await recordEvidence({ ...deploymentBody, taskId: TASK_ID })
    expect(response.status).toBe(201)
    expect(routeState.store.evidence[0]).toMatchObject({ kind: 'deployment', taskId: TASK_ID })
    expect(routeState.store.evidence[0].payload).toMatchObject({ verification: null, verificationStatus: 'unverified' })
    expect(JSON.stringify(routeState.store.tasks)).toBe(taskBefore)
  })

  it('ignores ids, scope and source sent in the body', async () => {
    const response = await recordEvidence({
      ...scanBody,
      projectId: FOREIGN_ORG_ID,
      tenantId: FOREIGN_TENANT_ID,
      organizationId: FOREIGN_ORG_ID,
      source: 'adapter',
      recordedBy: FOREIGN_ORG_ID,
    })
    expect(response.status).toBe(201)
    expect(routeState.store.evidence[0]).toMatchObject({
      projectId: PROJECT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      source: 'manual',
      recordedBy: routeState.auth?.sub,
    })
    expect((await recordEvidence(scanBody)).status).toBe(200)
  })

  it('never forwards a trustedExecution option sent in the body and stores the evidence as manual', async () => {
    const smuggled = await recordEvidence({
      ...scanBody,
      source: 'adapter',
      trustedExecution: { source: 'delivery_agents', actorUserId: TASK_ID },
    })
    expect(smuggled.status).toBe(201)
    const body = await readBody(smuggled)
    expect(routeState.store.evidence).toHaveLength(1)
    expect(routeState.store.evidence[0]).toMatchObject({ kind: 'scan', source: 'manual', recordedBy: routeState.auth?.sub })
    expect(routeState.store.evidence[0]).not.toHaveProperty('trustedExecution')

    const replay = await recordEvidence(scanBody)
    expect(replay.status).toBe(200)
    expect(await readBody(replay)).toEqual({ evidenceId: body.evidenceId, duplicate: true })
    expect(routeState.store.evidence).toHaveLength(1)
  })

  it('answers 404 for a foreign tenant or organization before looking at the body', async () => {
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await recordEvidence(scanBody), 404, 'not_found')
      await expectFrozenError(await recordEvidence({ kind: 'nope' }), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await recordEvidence(scanBody, { projectId: 'nope' }), 404, 'not_found')
    expect(routeState.store.evidence).toHaveLength(0)
    expect(routeState.writes).toBe(0)
  })

  it('answers the frozen bodies for a bad kind, an incomplete deployment and a wrong revision kind', async () => {
    const unknownKind = await expectFrozenError(await recordEvidence({ ...scanBody, kind: 'result_manifest' }), 422, 'unsupported_evidence_kind')
    expect(detailCodesOf(unknownKind)).toEqual(['unsupported_evidence_kind'])

    const notAwaitingReview = await expectFrozenError(await recordEvidence(reviewBody), 409, 'invalid_transition')
    expect(detailCodesOf(notAwaitingReview)).toEqual(['task_not_awaiting_review'])

    const { buildId: _buildId, ...withoutBuildId } = deploymentBody.payload
    await expectFrozenError(await recordEvidence({ ...deploymentBody, payload: withoutBuildId }), 422, 'deployment_incomplete')

    const snapshot = { kind: 'snapshot', contentHash: SHA, externalWorkspaceId: 'wp-local-1' }
    await expectFrozenError(await recordEvidence({ ...scanBody, sourceRevision: snapshot }), 422, 'revision_kind_mismatch')
    await expectFrozenError(await recordEvidence({ ...scanBody, baselineId: FOREIGN_ORG_ID }), 422, 'foreign_reference')
    await expectFrozenError(await recordEvidence({ ...scanBody, payload: {} }), 400, 'validation_failed')
    expect(routeState.store.evidence).toHaveLength(0)
  })

  it('caps the body size', async () => {
    const declared = await recordEvidence(scanBody, { headers: { 'content-length': '8000001' } })
    const body = await expectFrozenError(declared, 413, 'payload_too_large')
    expect((body.details as Array<{ path?: string }>)[0].path).toBe('body')
    expect(routeState.store.evidence).toHaveLength(0)
  })
})
