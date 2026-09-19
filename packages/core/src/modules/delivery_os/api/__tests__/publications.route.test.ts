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
import { GET, POST, metadata, openApi } from '../projects/[id]/publications/route'
import {
  ACTOR_ID,
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
import {
  deliveryFlowErrorBodySchema,
  publicationListResponseSchema,
  publicationRecordResponseSchema,
  publicationResultV1Schema,
  type PublicationResultV1,
  type SourceRevision,
} from '../../lib/contracts'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
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

const REVISION: SourceRevision = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const OTHER_REVISION: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-444444444445'
const OTHER_BASELINE_ID = '5b5b5b5b-5555-4555-8555-555555555556'
const DECISION_ID = 'dddddddd-dddd-4ddd-8ddd-000000000001'
const CHECK_EVIDENCE_ID = 'eeeeeeee-eeee-4eee-8eee-000000000001'
const PUBLISHED_AT = '2026-09-19T12:00:00.000Z'
const CHECKED_AT = '2026-09-19T12:01:00.000Z'
const RAW_REPORT_HASH = 'd'.repeat(64)
let clock = Date.parse('2026-09-19T10:00:00.000Z')

function tick(): void {
  clock += 1000
  jest.setSystemTime(clock)
}

function deployDecision(overrides: Row = {}): Row {
  return {
    id: DECISION_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    kind: 'deploy',
    subjectType: 'baseline',
    subjectId: BASELINE_ID,
    subjectHash: routeState.store.baselines[0].contentHash,
    subjectVersion: 1,
    sourceRevision: REVISION,
    verdict: 'approved',
    reason: null,
    actorUserId: ACTOR_ID,
    decidedAt: new Date('2026-09-19T09:30:00.000Z'),
    ...overrides,
  }
}

function checkEvidence(overrides: Row = {}): Row {
  return {
    id: CHECK_EVIDENCE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: null,
    attemptId: null,
    kind: 'scan',
    sourceRevision: REVISION,
    payload: { checkId: 'publication-url-check', scanner: 'http-url-check', status: 'passed', rawReportHash: RAW_REPORT_HASH },
    rawReportHash: RAW_REPORT_HASH,
    attachmentIds: [],
    createdAt: new Date('2026-09-19T09:40:00.000Z'),
    ...overrides,
  }
}

function publication(overrides: Partial<PublicationResultV1> = {}): PublicationResultV1 {
  return {
    schemaVersion: 'delivery.publication-result/v1',
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    sourceRevision: REVISION,
    snapshotRef: null,
    target: { kind: 'preview', environment: 'preview', ref: 'preview-1' },
    url: 'https://preview.example.com/site',
    deployDecisionId: DECISION_ID,
    publishedAt: PUBLISHED_AT,
    publishedBy: ACTOR_ID,
    verification: { status: 'verified', method: 'http', checkedAt: CHECKED_AT, httpStatus: 200, evidenceId: CHECK_EVIDENCE_ID },
    releaseDecisionId: null,
    ...overrides,
  }
}

function currentLock(): Date {
  return routeState.store.projects[0].updatedAt as Date
}

async function post(body: unknown, options: { lock?: string | Date | null; projectId?: string } = {}): Promise<Response> {
  const projectId = options.projectId ?? PROJECT_ID
  const lock = options.lock === undefined ? currentLock() : options.lock
  const response = await POST(apiRequest('POST', `/projects/${projectId}/publications`, { body, lock }), routeParams(projectId))
  tick()
  return response
}

function list(query = '', projectId: string = PROJECT_ID): Promise<Response> {
  return GET(apiRequest('GET', `/projects/${projectId}/publications${query}`), routeParams(projectId))
}

async function expectError(response: Response, status: number, code: string): Promise<Record<string, unknown>> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(body).success).toBe(true)
  return body
}

function expectNothingWritten(): void {
  expect(routeState.store.publications).toHaveLength(0)
  expect(routeState.store.evidence.filter((row) => row.kind === 'deployment')).toHaveLength(0)
}

function pinProject(): void {
  Object.assign(routeState.store.projects[0], {
    flowTemplateId: DEFAULT_FLOW_TEMPLATE.templateId,
    flowTemplateVersion: DEFAULT_FLOW_TEMPLATE.version,
    flowTemplateHash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE),
    flowTemplateSnapshot: DEFAULT_FLOW_TEMPLATE,
    flowPinnedAt: UPDATED_AT,
  })
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
  routeState.store.projects.push(makeProject({ activeBaselineId: BASELINE_ID }) as unknown as Row)
  routeState.store.baselines.push(makeBaseline() as unknown as Row)
  routeState.store.decisions.push(deployDecision())
  routeState.store.evidence.push(checkEvidence())
})

describe('F14 /api/delivery_os/projects/:id/publications — guards', () => {
  it('declares results.import for POST and projects.view for GET', () => {
    expect(Object.keys(openApi.methods).sort()).toEqual(['GET', 'POST'])
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.results.import'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ALL_FEATURES)).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.projects.view', 'delivery_os.projects.manage'])).toBe(false)
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'GET', ['delivery_os.results.import'])).toBe(false)
    const statuses = (method: 'GET' | 'POST') => {
      const doc = openApi.methods[method]
      return [...(doc?.responses ?? []), ...(doc?.errors ?? [])].map((entry) => entry.status).sort()
    }
    expect(statuses('POST')).toEqual([200, 201, 400, 403, 404, 409, 413, 422, 428])
    expect(statuses('GET')).toEqual([200, 400, 403, 404])
  })

  it('answers 403 from the command when the caller lacks results.import, before any write', async () => {
    signInAs({ features: VIEW_ONLY })
    await expectError(await post(publication()), 403, 'forbidden')
    expectNothingWritten()
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    expect((await post(publication())).status).toBe(401)
    expect((await list()).status).toBe(401)
  })

  it('answers 404 for the second tenant and the second organization before reading the body', async () => {
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectError(await post({ not: 'a publication' }), 404, 'not_found')
      await expectError(await list(), 404, 'not_found')
    }
    signInAs({})
    await expectError(await post(publication(), { projectId: OTHER_PROJECT_ID }), 404, 'not_found')
    expectNothingWritten()
  })
})

describe('F14 POST /api/delivery_os/projects/:id/publications', () => {
  it('records a publication with 201 and a derived verified deployment evidence, then replays with 200 without the lock', async () => {
    const created = await post(publication())
    expect(created.status).toBe(201)
    const body = publicationRecordResponseSchema.parse(await readBody(created))
    expect(body.duplicate).toBe(false)
    expect(routeState.store.publications).toEqual([
      expect.objectContaining({ id: body.publicationId, deploymentEvidenceId: body.deploymentEvidenceId, deployDecisionId: DECISION_ID }),
    ])
    expect(routeState.store.evidence.find((row) => row.id === body.deploymentEvidenceId)).toMatchObject({
      kind: 'deployment',
      payload: expect.objectContaining({ verificationStatus: 'verified' }),
    })

    const replay = await post(publication(), { lock: null })
    expect(replay.status).toBe(200)
    expect(await readBody(replay)).toEqual({ ...body, duplicate: true })
    expect(routeState.store.publications).toHaveLength(1)
    expect(routeState.store.evidence.filter((row) => row.kind === 'deployment')).toHaveLength(1)
  })

  it('answers 428 without the lock header and 409 on a stale version for a new publication', async () => {
    await expectError(await post(publication(), { lock: null }), 428, 'optimistic_lock_required')
    const stale = await post(publication(), { lock: STALE_UPDATED_AT })
    expect(stale.status).toBe(409)
    expect((await readBody(stale)).code).toBe('optimistic_lock_conflict')
    expectNothingWritten()
  })

  it('answers 400 for a malformed body and 413 for a body above the cap', async () => {
    await expectError(await post({ ...publication(), url: 'not a url' }), 400, 'validation_failed')
    await expectError(await post({ ...publication(), url: `https://preview.example.com/${'x'.repeat(1_000_001)}` }), 413, 'payload_too_large')
    expectNothingWritten()
  })

  it('answers each 422 code of F14 through HTTP and writes nothing', async () => {
    await expectError(await post({ ...publication(), schemaVersion: 'delivery.publication-result/v9' }), 422, 'unsupported_schema_version')

    const forged = publication()
    const verifiedWithoutEvidence = { ...forged, verification: { ...forged.verification, evidenceId: null } }
    await expectError(await post(verifiedWithoutEvidence), 422, 'deployment_unverified')

    await expectError(await post(publication({ deployDecisionId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f' })), 422, 'deploy_decision_missing')
    await expectError(await post(publication({ sourceRevision: OTHER_REVISION })), 422, 'revision_mismatch')
    await expectError(await post(publication({ projectId: OTHER_PROJECT_ID })), 422, 'foreign_reference')
    await expectError(await post(publication({ baselineId: OTHER_BASELINE_ID })), 422, 'foreign_reference')
    routeState.store.evidence[0].projectId = OTHER_PROJECT_ID
    await expectError(await post(publication()), 422, 'foreign_reference')
    routeState.store.evidence[0].projectId = PROJECT_ID

    routeState.store.decisions.push(
      deployDecision({ id: 'dddddddd-dddd-4ddd-8ddd-000000000002', verdict: 'rejected', reason: 'Broken', decidedAt: new Date('2026-09-19T09:45:00.000Z') }),
    )
    await expectError(await post(publication()), 422, 'deploy_decision_missing')
    routeState.store.decisions.pop()

    pinProject()
    const gate = await expectError(await post(publication()), 422, 'stage_not_approved')
    expect((gate.details as Array<{ path: string }>).map((detail) => detail.path)).toEqual(
      expect.arrayContaining(['stages.scope', 'stages.ux', 'stages.key_visual', 'stages.design_system_ui']),
    )
    expectNothingWritten()
  })

  it('answers 422 unsupported_evidence_kind when the verification evidence is not a passing check', async () => {
    Object.assign(routeState.store.evidence[0], { kind: 'reference_material', payload: { title: 'URL check', origin: 'https://preview.example.com/site' } })
    const wrongKind = await expectError(await post(publication()), 422, 'unsupported_evidence_kind')
    expect(wrongKind.details).toEqual([
      { path: 'verification.evidenceId', code: 'verification_evidence_kind', message: expect.stringContaining('reference_material') },
    ])

    const failedScan = { checkId: 'publication-url-check', scanner: 'http-url-check', status: 'failed', rawReportHash: RAW_REPORT_HASH }
    Object.assign(routeState.store.evidence[0], checkEvidence({ payload: failedScan }))
    const failed = await expectError(await post(publication()), 422, 'unsupported_evidence_kind')
    expect((failed.details as Array<{ code: string }>).map((detail) => detail.code)).toEqual(['verification_evidence_not_passed'])
    expectNothingWritten()

    const unverified = await post(publication({ verification: { status: 'unverified', method: null, checkedAt: null, httpStatus: null, evidenceId: null } }))
    expect(unverified.status).toBe(201)
    const selfEvidenceId = (await readBody(unverified)).deploymentEvidenceId as string
    const selfVerified = await expectError(
      await post(publication({ verification: { status: 'verified', method: 'http', checkedAt: CHECKED_AT, httpStatus: 200, evidenceId: selfEvidenceId } })),
      422,
      'unsupported_evidence_kind',
    )
    expect((selfVerified.details as Array<{ path: string }>).map((detail) => detail.path)).toEqual(['verification.evidenceId'])
    expect(routeState.store.publications).toHaveLength(1)
    expect(routeState.store.evidence.filter((row) => row.kind === 'deployment')).toHaveLength(1)
  })
})

describe('F14 GET /api/delivery_os/projects/:id/publications', () => {
  async function recordThree(): Promise<string[]> {
    const ids: string[] = []
    for (const ref of ['preview-1', 'preview-2', 'preview-3']) {
      const response = await post(publication({ target: { kind: 'preview', environment: 'preview', ref } }))
      expect(response.status).toBe(201)
      ids.push((await readBody(response)).publicationId as string)
    }
    return ids
  }

  it('lists newest first with paging, stored fields and a view-only session', async () => {
    const ids = await recordThree()
    signInAs({ features: VIEW_ONLY })
    const response = await list('?pageSize=2')
    expect(response.status).toBe(200)
    const body = publicationListResponseSchema.parse(await readBody(response))
    expect(body.total).toBe(3)
    expect(body.items.map((item) => item.publicationId)).toEqual([ids[2], ids[1]])
    expect(body.items[0]).toMatchObject({
      schemaVersion: 'delivery.publication-result/v1',
      projectId: PROJECT_ID,
      baselineId: BASELINE_ID,
      target: { ref: 'preview-3' },
      deployDecisionId: DECISION_ID,
      recordedBy: ACTOR_ID,
    })
    expect(body.items[0]).not.toHaveProperty('releaseDecisionId')
    const { publicationId: _publicationId, deploymentEvidenceId: _evidenceId, recordedBy: _recordedBy, createdAt: _createdAt, ...document } = body.items[0]
    expect(publicationResultV1Schema.safeParse({ ...document, releaseDecisionId: null }).success).toBe(true)

    const second = publicationListResponseSchema.parse(await readBody(await list('?page=2&pageSize=2')))
    expect(second.items.map((item) => item.publicationId)).toEqual([ids[0]])
  })

  it('caps pageSize at 100 and rejects 101', async () => {
    await recordThree()
    const full = publicationListResponseSchema.parse(await readBody(await list('?pageSize=100')))
    expect({ items: full.items.length, total: full.total }).toEqual({ items: 3, total: 3 })
    await expectError(await list('?pageSize=101'), 400, 'validation_failed')
    await expectError(await list('?page=0'), 400, 'validation_failed')
  })

  it('never lists rows of another tenant or organization for the same project id', async () => {
    routeState.store.publications.push({ id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', tenantId: TENANT_ID, organizationId: FOREIGN_ORG_ID, projectId: PROJECT_ID })
    routeState.store.publications.push({ id: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', tenantId: FOREIGN_TENANT_ID, organizationId: ORG_ID, projectId: PROJECT_ID })
    const body = publicationListResponseSchema.parse(await readBody(await list()))
    expect(body).toEqual({ items: [], total: 0 })
  })
})
