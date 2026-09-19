jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockEmitDeliveryOsEvent = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('../../events', () => ({
  emitDeliveryOsEvent: (...args: unknown[]) => mockEmitDeliveryOsEvent(...args),
}))

import '@open-mercato/core/modules/delivery_os/commands'
import type { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  DeliveryEvidence,
  DeliveryFlowStageArtifact,
  DeliveryFlowStageDecision,
  DeliveryPublication,
  type DeliveryProject,
} from '../../data/entities'
import { deploymentEvidencePayloadSchema } from '../../data/validators'
import {
  FLOW_APPROVAL_STAGE_ORDER,
  FLOW_GATE_DETAIL_CODES,
  deliveryErrorBodySchema,
  publicationRecordResponseSchema,
  type FlowStageId,
  type PublicationResultV1,
  type SourceRevision,
} from '../../lib/contracts'
import { isVerifiedDeploymentPayload } from '../../lib/deliveryReport'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { hashPublicationPayload } from '../../lib/publicationRules'
import type { DecisionCommandResult } from '../decisions'
import type { PublicationRecordCommandResult } from '../publications'
import { createDeliveryOsReportQueries } from '../reportQueries'
import {
  ACTOR_ID,
  BASELINE_ID,
  catchHttpError,
  detailCodes,
  emptyStore,
  expectFrozenBody,
  FOREIGN_ORG_ID,
  getHandler,
  makeApproval,
  makeBaseline,
  makeHarness,
  makeProject,
  matches,
  ORG_ID,
  PROJECT_ID,
  rowsFor,
  STALE_UPDATED_AT,
  TENANT_ID,
  UPDATED_AT,
  type EmMock,
  type Row,
  type Store,
} from './baselineTestKit'

type PublicationStore = Store & { evidence: Row[]; publications: Row[]; stageArtifacts: Row[]; stageDecisions: Row[] }

const REVISION: SourceRevision = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const OTHER_REVISION: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }
const RAW_HASH = 'd'.repeat(64)
const OTHER_BASELINE_ID = '5b5b5b5b-5555-4555-8555-555555555556'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-444444444445'
const UNKNOWN_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
const PUBLISHED_AT = '2026-09-19T12:00:00.000Z'
const CHECKED_AT = '2026-09-19T12:01:00.000Z'

const record = getHandler<PublicationRecordCommandResult>('delivery_os.publications.record')
const decide = getHandler<DecisionCommandResult>('delivery_os.decisions.record')

let store: PublicationStore
let queriedEntities: unknown[]
let evidenceSeq = 0
let decisionSeq = 0
let stageSeq = 0
let createSeq = 0
let grantedFeatures: string[]

function rows(entity: unknown): Row[] {
  if (entity === DeliveryEvidence) return store.evidence
  if (entity === DeliveryPublication) return store.publications
  if (entity === DeliveryFlowStageArtifact) return store.stageArtifacts
  if (entity === DeliveryFlowStageDecision) return store.stageDecisions
  return rowsFor(store, entity)
}

function evidenceRow(kind: string, payload: unknown, overrides: Row = {}): Row {
  evidenceSeq += 1
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(evidenceSeq).padStart(12, '0')}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: null,
    attemptId: null,
    kind,
    sourceRevision: REVISION,
    payload,
    rawReportHash: RAW_HASH,
    attachmentIds: [],
    createdAt: new Date(Date.UTC(2026, 8, 19, 10, 0, evidenceSeq)),
    ...overrides,
  }
}

function greenEvidence(): Row[] {
  const content = store.baselines[0].content as { acTestMap: Record<string, string[]> }
  const check = (testId: string) => ({ checkId: 'unit-tests', testId, status: 'passed', sourceRevision: REVISION, acIds: [], rawReportHash: RAW_HASH })
  return [
    evidenceRow('test', { rawReportHash: RAW_HASH, checks: [check(content.acTestMap['AC-001'][0]), check(content.acTestMap['AC-002'][0])] }),
    evidenceRow('scan', { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: RAW_HASH }),
    evidenceRow('review', { verdict: 'approved', summary: 'Looks right', findings: [], manualCheckId: 'MC-visual-001', reviewer: { kind: 'human' } }),
  ]
}

function deployDecisionRow(verdict: 'approved' | 'rejected', revision: SourceRevision = REVISION, overrides: Row = {}): Row {
  decisionSeq += 1
  return {
    id: `dddddddd-dddd-4ddd-8ddd-${String(decisionSeq).padStart(12, '0')}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    kind: 'deploy',
    subjectType: 'baseline',
    subjectId: BASELINE_ID,
    subjectHash: store.baselines[0].contentHash,
    subjectVersion: 1,
    sourceRevision: revision,
    verdict,
    reason: verdict === 'approved' ? null : 'No',
    actorUserId: ACTOR_ID,
    decidedAt: new Date(Date.UTC(2026, 8, 19, 9, 0, decisionSeq)),
    ...overrides,
  }
}

function seedApprovedDeploy(revision: SourceRevision = REVISION, overrides: Row = {}): string {
  const row = deployDecisionRow('approved', revision, overrides)
  store.decisions.push(row as never)
  return row.id as string
}

function checkEvidenceId(): string {
  return store.evidence[0].id as string
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
    deployDecisionId: store.decisions.find((decision) => decision.kind === 'deploy')?.id ?? UNKNOWN_ID,
    publishedAt: PUBLISHED_AT,
    publishedBy: ACTOR_ID,
    verification: { status: 'verified', method: 'http', checkedAt: CHECKED_AT, httpStatus: 200, evidenceId: checkEvidenceId() },
    releaseDecisionId: null,
    ...overrides,
  }
}

function verifiedBy(evidenceId: string): Partial<PublicationResultV1> {
  return { verification: { status: 'verified', method: 'http', checkedAt: CHECKED_AT, httpStatus: 200, evidenceId } }
}

function seedEvidence(kind: string, payload: unknown, overrides: Row = {}): string {
  const row = evidenceRow(kind, payload, overrides)
  store.evidence.push(row)
  return row.id as string
}

function unverified(): Partial<PublicationResultV1> {
  return { verification: { status: 'unverified', method: null, checkedAt: null, httpStatus: null, evidenceId: null } }
}

function pinnedProject(overrides: Partial<DeliveryProject> = {}): DeliveryProject {
  return makeProject({
    activeBaselineId: BASELINE_ID,
    flowTemplateId: DEFAULT_FLOW_TEMPLATE.templateId,
    flowTemplateVersion: DEFAULT_FLOW_TEMPLATE.version,
    flowTemplateHash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE),
    flowTemplateSnapshot: DEFAULT_FLOW_TEMPLATE,
    flowPinnedAt: UPDATED_AT,
    ...overrides,
  })
}

type StageRef = { artifactId: string; version: number; contentHash: string }

function artifactRow(stageId: FlowStageId, version: number, upstream: { stageId: FlowStageId; ref: StageRef } | null): StageRef {
  stageSeq += 1
  const artifactId = `${String(stageSeq).padStart(8, '0')}-aaaa-4aaa-8aaa-000000000000`
  const contentHash = `${stageId}-v${version}`.padEnd(64, '0')
  store.stageArtifacts.push({
    id: artifactId,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    stageId,
    version,
    contentHash,
    dependsOn: upstream ? [{ stageId: upstream.stageId, ...upstream.ref }] : [],
    createdAt: UPDATED_AT,
  })
  return { artifactId, version, contentHash }
}

function approvalRow(stageId: FlowStageId, ref: StageRef, clientApproverName: string | null): void {
  stageSeq += 1
  store.stageDecisions.push({
    id: `${String(stageSeq).padStart(8, '0')}-dddd-4ddd-8ddd-000000000000`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    stageId,
    artifactId: ref.artifactId,
    subjectHash: ref.contentHash,
    subjectVersion: ref.version,
    verdict: 'approved',
    decidedAt: new Date(Date.UTC(2026, 8, 19, 9, 30, stageSeq)),
    clientApproverName,
  })
}

/** Seeds the four stages in order and approves every stage up to (excluding) `pendingFrom`. */
function seedStages(pendingFrom: FlowStageId | 'none'): void {
  let upstream: { stageId: FlowStageId; ref: StageRef } | null = null
  for (const stageId of FLOW_APPROVAL_STAGE_ORDER) {
    const ref = artifactRow(stageId, 1, upstream)
    if (stageId === pendingFrom) break
    const templateStage = DEFAULT_FLOW_TEMPLATE.stages.find((stage) => stage.kind === stageId)
    approvalRow(stageId, ref, templateStage?.requiresClientApproval ? 'Anna Client' : null)
    upstream = { stageId, ref }
  }
}

function projectLock(): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: store.projects[0].updatedAt.toISOString() }
}

type HarnessOptions = { headers?: Record<string, string>; orgId?: string; failPublicationPersist?: boolean }

/**
 * The kit `persist` mock routes by shape; publications and evidence get their own arrays and sequential ids. A
 * publication gets no id from `create` (its key is database-generated), so the command must assign it before the flush,
 * as on a real database. The fake transaction snapshots the store and restores it when the work throws, mirroring a
 * database rollback.
 */
function harness(options: HarnessOptions = {}) {
  const rbacService = { getGrantedFeatures: jest.fn(async () => grantedFeatures) }
  const built = makeHarness(store, {
    headers: options.headers ?? projectLock(),
    orgId: options.orgId,
    services: { rbacService, deliveryOsReportQueries: createDeliveryOsReportQueries(makeHarness(store).em as never) },
  })
  const em: EmMock = built.em
  em.create.mockImplementation((entity: unknown, data: Row) => {
    if (entity === DeliveryPublication) return { ...data }
    createSeq += 1
    return { id: `cccccccc-cccc-4ccc-8ccc-${String(createSeq).padStart(12, '0')}`, ...data }
  })
  em.persist.mockImplementation((row: Row) => {
    if ('deploymentEvidenceId' in row) {
      if (options.failPublicationPersist) throw new Error('[internal] simulated publication write failure')
      store.publications.push(row)
    } else if ('payloadHash' in row) store.evidence.push(row)
    else store.decisions.push(row as never)
  })
  em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => {
    const snapshot = {
      evidence: [...store.evidence],
      publications: [...store.publications],
      decisions: [...store.decisions],
      updatedAt: store.projects[0].updatedAt,
    }
    try {
      return await work(em)
    } catch (error) {
      store.evidence = snapshot.evidence
      store.publications = snapshot.publications
      store.decisions = snapshot.decisions
      store.projects[0].updatedAt = snapshot.updatedAt
      throw error
    }
  })
  return { ...built, rbacService }
}

function run(input: PublicationResultV1, options: HarnessOptions = {}, projectId: string = PROJECT_ID): Promise<PublicationRecordCommandResult> {
  const { ctx } = harness(options)
  return Promise.resolve(record.execute({ projectId, publication: input }, ctx))
}

function stageDetails(error: CrudHttpError): Array<{ path: string; code: string; message?: string }> {
  return error.body.details as Array<{ path: string; code: string; message?: string }>
}

function expectFlowGateRefusal(error: CrudHttpError, expected: Partial<Record<FlowStageId, string>>): void {
  expect(error.status).toBe(422)
  expect(error.body.code).toBe('stage_not_approved')
  const details = stageDetails(error)
  expect(details.length).toBeGreaterThan(0)
  for (const detail of details) {
    expect(detail.path).toMatch(/^stages\.(scope|ux|key_visual|design_system_ui)$/)
    expect(FLOW_GATE_DETAIL_CODES).toContain(detail.code)
    expect(typeof detail.message).toBe('string')
  }
  expect(Object.fromEntries(details.map((detail) => [detail.path.replace('stages.', ''), detail.code]))).toEqual(expected)
}

function expectNothingWritten(): void {
  expect(store.publications).toHaveLength(0)
  expect(store.evidence.filter((row) => row.kind === 'deployment')).toHaveLength(0)
  expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
}

beforeEach(() => {
  evidenceSeq = 0
  decisionSeq = 0
  stageSeq = 0
  createSeq = 0
  queriedEntities = []
  grantedFeatures = ['delivery_os.*']
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).find((row) => matches(row, where)) ?? null)
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => {
    queriedEntities.push(entity)
    return rows(entity).filter((row) => matches(row, where))
  })
  const baseline = makeBaseline()
  store = {
    ...emptyStore(),
    projects: [makeProject({ activeBaselineId: BASELINE_ID })],
    baselines: [baseline],
    decisions: [makeApproval(baseline, 'requirements'), makeApproval(baseline, 'design')],
    evidence: [],
    publications: [],
    stageArtifacts: [],
    stageDecisions: [],
  }
  store.evidence = greenEvidence()
})

describe('delivery_os.publications.record — happy path (F14, UA-43)', () => {
  it('records one v1 deployment evidence row and one publication row in one transaction and answers 201 fields', async () => {
    seedApprovedDeploy()
    const input = publication()
    const before = store.projects[0].updatedAt
    const { ctx, em } = harness()
    const result = await record.execute({ projectId: PROJECT_ID, publication: input }, ctx)

    expect(publicationRecordResponseSchema.safeParse(result).success).toBe(true)
    expect(result.duplicate).toBe(false)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    const deployments = store.evidence.filter((row) => row.kind === 'deployment')
    expect(deployments).toHaveLength(1)
    expect(store.publications).toHaveLength(1)
    const [evidence] = deployments
    const [stored] = store.publications
    expect(result).toEqual({ publicationId: stored.id, deploymentEvidenceId: evidence.id, duplicate: false })
    expect(result.publicationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(stored).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      baselineId: BASELINE_ID,
      sourceRevision: REVISION,
      deployDecisionId: input.deployDecisionId,
      deploymentEvidenceId: evidence.id,
      url: input.url,
      target: input.target,
      verification: input.verification,
      publishedAt: new Date(PUBLISHED_AT),
      publishedBy: ACTOR_ID,
      payloadHash: hashPublicationPayload(input),
      recordedBy: ACTOR_ID,
    })
    expect(evidence).toMatchObject({ kind: 'deployment', source: 'manual', baselineId: BASELINE_ID, sourceRevision: REVISION, taskId: null, recordedBy: ACTOR_ID })
    const payload = deploymentEvidencePayloadSchema.parse(evidence.payload)
    expect(payload).toMatchObject({ url: input.url, environment: 'preview', buildId: REVISION.commitSha, deployedAt: PUBLISHED_AT, uploadStatus: 'succeeded' })
    expect(payload.verification).toMatchObject({ status: 'verified', method: 'http', checkedAt: CHECKED_AT, observedBuildId: REVISION.commitSha })
    expect((evidence.payload as Row).verificationStatus).toBe('verified')
    expect(isVerifiedDeploymentPayload(evidence.payload)).toBe(true)
    expect(store.projects[0].updatedAt.getTime()).toBeGreaterThan(before.getTime())
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitDeliveryOsEvent.mock.calls[0][0]).toBe('delivery_os.evidence.recorded')
    expect(mockEmitDeliveryOsEvent.mock.calls[0][1]).toMatchObject({ evidenceId: evidence.id, kind: 'deployment', duplicate: false })
  })

  it('lets R21 delivery_os.decisions.record kind release succeed on the returned deploymentEvidenceId', async () => {
    seedApprovedDeploy()
    const result = await run(publication())
    const { ctx } = harness()
    const release = await decide.execute({ kind: 'release', projectId: PROJECT_ID, verdict: 'approved', deploymentEvidenceId: result.deploymentEvidenceId }, ctx)
    expect(release).toMatchObject({ kind: 'release', verdict: 'approved', baselineId: BASELINE_ID })
    expect(store.decisions.find((decision) => decision.kind === 'release')).toMatchObject({ subjectId: result.deploymentEvidenceId, sourceRevision: REVISION })
  })

  it('records an unverified publication whose evidence row R21 refuses with deployment_unverified', async () => {
    seedApprovedDeploy()
    const result = await run(publication(unverified()))
    const evidence = store.evidence.find((row) => row.id === result.deploymentEvidenceId)
    expect(evidence).toBeDefined()
    expect((evidence?.payload as Row).verification).toBeNull()
    expect((evidence?.payload as Row).verificationStatus).toBe('unverified')
    const { ctx } = harness()
    const error = await catchHttpError(() => decide.execute({ kind: 'release', projectId: PROJECT_ID, verdict: 'approved', deploymentEvidenceId: result.deploymentEvidenceId }, ctx))
    expectFrozenBody(error, 422, 'deployment_unverified')
  })

  it('verifies a snapshotRef attachment in scope and stores it on the evidence row', async () => {
    seedApprovedDeploy()
    const attachmentId = '55555555-5555-4555-8555-555555555555'
    store.attachments.push({ id: attachmentId, tenantId: TENANT_ID, organizationId: ORG_ID })
    const result = await run(publication({ snapshotRef: { attachmentId, sha256: 'a'.repeat(64) } }))
    expect(store.evidence.find((row) => row.id === result.deploymentEvidenceId)?.attachmentIds).toEqual([attachmentId])
    expect(store.publications[0].snapshotRef).toEqual({ attachmentId, sha256: 'a'.repeat(64) })

    store.attachments.length = 0
    const foreign = await catchHttpError(() => run(publication({ snapshotRef: { attachmentId: UNKNOWN_ID, sha256: 'a'.repeat(64) } })))
    expectFrozenBody(foreign, 422, 'foreign_reference')
  })

  it('names snapshotRef.attachmentId, not attachmentIds.0, when the snapshot attachment is unknown', async () => {
    seedApprovedDeploy()
    const error = await catchHttpError(() => run(publication({ snapshotRef: { attachmentId: UNKNOWN_ID, sha256: 'a'.repeat(64) } })))
    expectFrozenBody(error, 422, 'foreign_reference')
    expect(stageDetails(error).map((detail) => detail.path)).toEqual(['snapshotRef.attachmentId'])
    expect(detailCodes(error)).toEqual(['attachment_scope_mismatch'])
    expect(error.message).toContain('[internal] delivery_os foreign_reference')
    expectNothingWritten()
  })

  it('accepts a release decision of this project as releaseDecisionId', async () => {
    seedApprovedDeploy()
    const releaseId = seedApprovedDeploy(REVISION, { kind: 'release', subjectType: 'evidence' })
    const result = await run(publication({ releaseDecisionId: releaseId }))
    expect(result.duplicate).toBe(false)
    expect(store.publications).toHaveLength(1)
  })

  it('answers duplicate: true on a replay of the same payload without the lock header and without writes', async () => {
    seedApprovedDeploy()
    const input = publication()
    const first = await run(input)
    const { ctx, em } = harness({ headers: {} })
    const replay = await record.execute({ projectId: PROJECT_ID, publication: input }, ctx)
    expect(replay).toEqual({ ...first, duplicate: true })
    expect(em.transactional).not.toHaveBeenCalled()
    expect(store.publications).toHaveLength(1)
    expect(store.evidence.filter((row) => row.kind === 'deployment')).toHaveLength(1)
  })

  it('answers duplicate: true for a replay that spells identifiers in uppercase and timestamps without milliseconds or with an offset', async () => {
    seedApprovedDeploy()
    const input = publication()
    const first = await run(input)
    const stored = { ...store.publications[0] }
    const respelled = publication({
      baselineId: input.baselineId.toUpperCase(),
      deployDecisionId: input.deployDecisionId.toUpperCase(),
      publishedBy: ACTOR_ID.toUpperCase(),
      publishedAt: '2026-09-19T12:00:00Z',
      verification: { ...input.verification, checkedAt: '2026-09-19T14:01:00+02:00', evidenceId: checkEvidenceId().toUpperCase() },
    })
    expect(hashPublicationPayload(respelled)).toBe(hashPublicationPayload(input))
    const { ctx, em } = harness({ headers: {} })
    const replay = await record.execute({ projectId: PROJECT_ID, publication: respelled }, ctx)
    expect(replay).toEqual({ ...first, duplicate: true })
    expect(em.transactional).not.toHaveBeenCalled()
    expect(store.publications).toEqual([stored])
    expect(store.evidence.filter((row) => row.kind === 'deployment')).toHaveLength(1)
  })

  it('stores the sent values unchanged when the first record spells a timestamp without milliseconds', async () => {
    seedApprovedDeploy()
    const input = publication({ publishedAt: '2026-09-19T12:00:00Z' })
    const result = await run(input)
    expect(store.publications[0]).toMatchObject({ publishedAt: new Date(PUBLISHED_AT), payloadHash: hashPublicationPayload(publication()) })
    expect((store.evidence.find((row) => row.id === result.deploymentEvidenceId)?.payload as Row).deployedAt).toBe('2026-09-19T12:00:00Z')
  })

  it('recovers a unique violation on the payload hash as a duplicate', async () => {
    seedApprovedDeploy()
    const input = publication()
    const first = await run(input)
    const { ctx, em } = harness()
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => {
      if (entity === DeliveryPublication && em.transactional.mock.calls.length === 0) return null
      return rows(entity).find((row) => matches(row, where)) ?? null
    })
    em.transactional.mockImplementation(async () => {
      const violation = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
      throw violation
    })
    const result = await record.execute({ projectId: PROJECT_ID, publication: input }, ctx)
    expect(result).toEqual({ ...first, duplicate: true })
    expect(store.publications).toHaveLength(1)
  })
})

describe('delivery_os.publications.record — refusals', () => {
  it('answers 409 for a stale project version and 428 without the header', async () => {
    seedApprovedDeploy()
    const stale = await catchHttpError(() => run(publication(), { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } }))
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('optimistic_lock_conflict')
    expectFrozenBody(await catchHttpError(() => run(publication(), { headers: {} })), 428, 'optimistic_lock_required')
    expectNothingWritten()
  })

  it('answers 404 across organizations and 422 foreign_reference when the body names another project', async () => {
    seedApprovedDeploy()
    expectFrozenBody(await catchHttpError(() => run(publication(), { orgId: FOREIGN_ORG_ID })), 404, 'not_found')
    expectFrozenBody(await catchHttpError(() => run(publication({ projectId: OTHER_PROJECT_ID }))), 422, 'foreign_reference')
    expectNothingWritten()
  })

  it('answers 403 when the caller lacks delivery_os.results.import and honours wildcard grants', async () => {
    seedApprovedDeploy()
    grantedFeatures = ['delivery_os.projects.view']
    const denied = await catchHttpError(() => run(publication()))
    expectFrozenBody(denied, 403, 'forbidden')
    expect(detailCodes(denied)).toEqual(['feature_required'])
    expectNothingWritten()
    grantedFeatures = ['delivery_os.results.*']
    await expect(run(publication())).resolves.toMatchObject({ duplicate: false })
  })

  it('fails closed with 403 when the feature lookup itself throws', async () => {
    seedApprovedDeploy()
    const { ctx, rbacService } = harness()
    rbacService.getGrantedFeatures.mockRejectedValueOnce(new Error('[internal] rbac down'))
    expectFrozenBody(await catchHttpError(() => record.execute({ projectId: PROJECT_ID, publication: publication() }, ctx)), 403, 'forbidden')
    expectNothingWritten()
  })

  it('answers 422 deploy_decision_missing for a missing, rejected or other-baseline deploy decision', async () => {
    const missing = await catchHttpError(() => run(publication({ deployDecisionId: UNKNOWN_ID })))
    expectFrozenBody(missing, 422, 'deploy_decision_missing')
    expect(detailCodes(missing)).toEqual(['deploy_decision_missing'])

    store.decisions.push(deployDecisionRow('rejected') as never)
    const rejected = await catchHttpError(() => run(publication({ deployDecisionId: store.decisions.at(-1)?.id as string })))
    expectFrozenBody(rejected, 422, 'deploy_decision_missing')
    expect(detailCodes(rejected)).toEqual(['deploy_decision_rejected'])

    const otherBaseline = seedApprovedDeploy(REVISION, { subjectId: OTHER_BASELINE_ID, subjectHash: 'f'.repeat(64) })
    const other = await catchHttpError(() => run(publication({ deployDecisionId: otherBaseline })))
    expectFrozenBody(other, 422, 'deploy_decision_missing')
    expectNothingWritten()
  })

  it('refuses a deploy decision of another project even when the id is known', async () => {
    const foreign = seedApprovedDeploy(REVISION, { projectId: OTHER_PROJECT_ID })
    const error = await catchHttpError(() => run(publication({ deployDecisionId: foreign })))
    expectFrozenBody(error, 422, 'deploy_decision_missing')
    expectNothingWritten()
  })

  it('answers 422 revision_mismatch when the consent was given on revision A and the publication names revision B', async () => {
    seedApprovedDeploy(REVISION)
    const error = await catchHttpError(() => run(publication({ sourceRevision: OTHER_REVISION })))
    expectFrozenBody(error, 422, 'revision_mismatch')
    expect(detailCodes(error)).toEqual(['deploy_revision_mismatch'])
    expectNothingWritten()
  })

  it('lets a newer reject on the same revision win over the named approval', async () => {
    const approved = seedApprovedDeploy()
    store.decisions.push(deployDecisionRow('rejected') as never)
    const error = await catchHttpError(() => run(publication({ deployDecisionId: approved })))
    expectFrozenBody(error, 422, 'deploy_decision_missing')
    expect(detailCodes(error)).toEqual(['deploy_decision_rejected'])
    expect(stageDetails(error)[0].path).toBe('deployDecisionId')
    expect(stageDetails(error)[0].message).toEqual(expect.any(String))
    expectNothingWritten()
  })

  it('answers 422 foreign_reference on releaseDecisionId for an unknown, foreign or non-release decision', async () => {
    const deployId = seedApprovedDeploy()
    const foreignRelease = seedApprovedDeploy(REVISION, { kind: 'release', projectId: OTHER_PROJECT_ID })
    const otherOrgRelease = seedApprovedDeploy(REVISION, { kind: 'release', organizationId: FOREIGN_ORG_ID })
    for (const releaseDecisionId of [UNKNOWN_ID, foreignRelease, otherOrgRelease, deployId]) {
      const error = await catchHttpError(() => run(publication({ deployDecisionId: deployId, releaseDecisionId })))
      expectFrozenBody(error, 422, 'foreign_reference')
      expect(stageDetails(error)).toEqual([{ path: 'releaseDecisionId', code: 'foreign_release_decision' }])
    }
    expectNothingWritten()
  })

  it('answers 422 foreign_reference for a baseline of another project and for a verification evidence of another project', async () => {
    seedApprovedDeploy()
    expectFrozenBody(await catchHttpError(() => run(publication({ baselineId: OTHER_BASELINE_ID }))), 422, 'foreign_reference')
    store.evidence.push(evidenceRow('screenshot', {}, { projectId: OTHER_PROJECT_ID }))
    const foreignEvidence = store.evidence.at(-1)?.id as string
    const error = await catchHttpError(() => run(publication({ verification: { status: 'verified', method: 'http', checkedAt: CHECKED_AT, httpStatus: 200, evidenceId: foreignEvidence } })))
    expectFrozenBody(error, 422, 'foreign_reference')
    expect(detailCodes(error)).toEqual(['foreign_evidence'])
    expectNothingWritten()
  })

  it('answers 422 baseline_mismatch for a verification evidence recorded on another baseline', async () => {
    seedApprovedDeploy()
    store.evidence.push(evidenceRow('screenshot', {}, { baselineId: OTHER_BASELINE_ID }))
    const evidenceId = store.evidence.at(-1)?.id as string
    const error = await catchHttpError(() => run(publication({ verification: { status: 'verified', method: 'http', checkedAt: CHECKED_AT, httpStatus: 200, evidenceId } })))
    expectFrozenBody(error, 422, 'baseline_mismatch')
    expect(detailCodes(error)).toEqual(['baseline_mismatch'])
    expectNothingWritten()
  })

  it('answers 422 revision_mismatch for a verification evidence recorded on another revision', async () => {
    seedApprovedDeploy()
    store.evidence.push(evidenceRow('screenshot', {}, { sourceRevision: { ...REVISION, commitSha: 'f'.repeat(40) } }))
    const evidenceId = store.evidence.at(-1)?.id as string
    const error = await catchHttpError(() => run(publication({ verification: { status: 'verified', method: 'http', checkedAt: CHECKED_AT, httpStatus: 200, evidenceId } })))
    expectFrozenBody(error, 422, 'revision_mismatch')
    expect(detailCodes(error)).toEqual(['revision_mismatch'])
    expectNothingWritten()
  })

  it('answers 422 revision_mismatch for a verification evidence whose stored revision cannot be read', async () => {
    seedApprovedDeploy()
    store.evidence.push(evidenceRow('screenshot', {}, { sourceRevision: { kind: 'bogus' } }))
    const evidenceId = store.evidence.at(-1)?.id as string
    const error = await catchHttpError(() => run(publication(verifiedBy(evidenceId))))
    expectFrozenBody(error, 422, 'revision_mismatch')
    expect(detailCodes(error)).toEqual(['revision_mismatch'])
    expectNothingWritten()
  })

  it('accepts a verification evidence without a source revision on the same baseline', async () => {
    seedApprovedDeploy()
    const evidenceId = seedEvidence('screenshot', {}, { sourceRevision: null })
    const result = await run(publication(verifiedBy(evidenceId)))
    expect(result.duplicate).toBe(false)
  })

  it('binds a verification evidence to project and baseline ids sent in uppercase, as the uuid lookup ignores case', async () => {
    const lowerIds = (where: Row): Row =>
      Object.fromEntries(Object.entries(where).map(([key, value]) => [key, typeof value === 'string' && /^[0-9A-F-]{36}$/i.test(value) ? value.toLowerCase() : value]))
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).find((row) => matches(row, lowerIds(where))) ?? null)
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).filter((row) => matches(row, lowerIds(where))))
    seedApprovedDeploy()
    const evidenceId = seedEvidence('screenshot', {})
    const input = publication({ baselineId: BASELINE_ID.toUpperCase(), ...verifiedBy(evidenceId.toUpperCase()) })
    const { ctx } = harness()
    const result = await record.execute({ projectId: PROJECT_ID, publication: { ...input, projectId: PROJECT_ID.toUpperCase() } }, ctx)
    expect(result.duplicate).toBe(false)
    expect(store.publications).toHaveLength(1)
    expect(store.publications[0]).toMatchObject({ baselineId: BASELINE_ID })
  })

  it('refuses a publication that names its own earlier deployment evidence as the verification proof', async () => {
    seedApprovedDeploy()
    const first = await run(publication(unverified()))
    const evidenceCount = store.evidence.length
    mockEmitDeliveryOsEvent.mockClear()
    const error = await catchHttpError(() => run(publication(verifiedBy(first.deploymentEvidenceId))))
    expectFrozenBody(error, 422, 'unsupported_evidence_kind')
    expect(stageDetails(error)).toEqual([
      { path: 'verification.evidenceId', code: 'verification_evidence_kind', message: expect.stringContaining('deployment') },
    ])
    expect(store.publications).toHaveLength(1)
    expect(store.evidence).toHaveLength(evidenceCount)
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('answers 422 unsupported_evidence_kind for a reference_material verification evidence', async () => {
    seedApprovedDeploy()
    const evidenceId = seedEvidence('reference_material', { title: 'URL check', origin: 'https://preview.example.com/site' })
    const error = await catchHttpError(() => run(publication(verifiedBy(evidenceId))))
    expectFrozenBody(error, 422, 'unsupported_evidence_kind')
    expect(detailCodes(error)).toEqual(['verification_evidence_kind'])
    expect(stageDetails(error)[0].path).toBe('verification.evidenceId')
    expectNothingWritten()
  })

  it('checks the evidence kind after the project scope and before the baseline binding', async () => {
    seedApprovedDeploy()
    const foreign = seedEvidence('reference_material', {}, { projectId: OTHER_PROJECT_ID })
    expect(detailCodes(await catchHttpError(() => run(publication(verifiedBy(foreign)))))).toEqual(['foreign_evidence'])
    const otherBaseline = seedEvidence('reference_material', {}, { baselineId: OTHER_BASELINE_ID })
    expect(detailCodes(await catchHttpError(() => run(publication(verifiedBy(otherBaseline)))))).toEqual(['verification_evidence_kind'])
    expectNothingWritten()
  })

  it.each([
    ['a failed scan', 'scan', { checkId: 'publication-url-check', scanner: 'http-url-check', status: 'failed', rawReportHash: RAW_HASH }],
    ['a review requesting changes', 'review', { verdict: 'changes_requested', summary: 'Broken', findings: [] }],
    ['a test with a failed check', 'test', { rawReportHash: RAW_HASH, checks: [{ checkId: 'unit-tests', testId: 'T-1', status: 'failed' }] }],
  ])('answers 422 verification_evidence_not_passed for %s', async (_label, kind, payload) => {
    seedApprovedDeploy()
    const evidenceId = seedEvidence(kind, payload)
    const error = await catchHttpError(() => run(publication(verifiedBy(evidenceId))))
    expectFrozenBody(error, 422, 'unsupported_evidence_kind')
    expect(detailCodes(error)).toEqual(['verification_evidence_not_passed'])
    expect(stageDetails(error)[0].path).toBe('verification.evidenceId')
    expectNothingWritten()
  })

  it('records a publication verified by a passed scan', async () => {
    seedApprovedDeploy()
    const evidenceId = seedEvidence('scan', { checkId: 'publication-url-check', scanner: 'http-url-check', status: 'passed', rawReportHash: RAW_HASH })
    const result = await run(publication(verifiedBy(evidenceId)))
    expect(result.duplicate).toBe(false)
    expect(store.publications).toHaveLength(1)
    expect(store.publications[0].verification).toMatchObject({ status: 'verified', evidenceId })
  })

  it('answers 422 deployment_unverified from the schema for verified without method, time and evidence', async () => {
    seedApprovedDeploy()
    const error = await catchHttpError(() => run(publication({ verification: { status: 'verified', method: null, checkedAt: null, httpStatus: 200, evidenceId: null } })))
    expect(error.status).toBe(422)
    expect(error.body.code).toBe('deployment_unverified')
    expectNothingWritten()
  })

  it('rolls the deployment evidence back when the publication row cannot be written', async () => {
    seedApprovedDeploy()
    await expect(run(publication(), { failPublicationPersist: true })).rejects.toThrow('simulated publication write failure')
    expectNothingWritten()
    expect(store.projects[0].updatedAt).toEqual(UPDATED_AT)
  })
})

describe('delivery_os.publications.record — flow gate (UA-48 publication path)', () => {
  it('refuses a pinned project with UX pending with 422 stage_not_approved and per-stage details', async () => {
    store.projects[0] = pinnedProject()
    seedStages('ux')
    seedApprovedDeploy()
    const error = await catchHttpError(() => run(publication()))
    expectFlowGateRefusal(error, { ux: 'stage_not_approved', key_visual: 'stage_not_approved', design_system_ui: 'stage_not_approved' })
    expect(deliveryErrorBodySchema.safeParse(error.body).success).toBe(false)
    expectNothingWritten()
  })

  it('records the publication once all four stages are approved and current', async () => {
    store.projects[0] = pinnedProject()
    seedStages('none')
    seedApprovedDeploy()
    await expect(run(publication())).resolves.toMatchObject({ duplicate: false })
    expect(store.publications).toHaveLength(1)
  })

  it('fails closed when the pinned snapshot is unreadable', async () => {
    store.projects[0] = pinnedProject({ flowTemplateSnapshot: null })
    seedStages('none')
    seedApprovedDeploy()
    const error = await catchHttpError(() => run(publication()))
    expectFlowGateRefusal(error, { scope: 'stage_not_approved', ux: 'stage_not_approved', key_visual: 'stage_not_approved', design_system_ui: 'stage_not_approved' })
    expectNothingWritten()
  })

  it('fails closed when the pinned template ref lost its hash', async () => {
    store.projects[0] = pinnedProject({ flowTemplateHash: '' })
    seedStages('none')
    seedApprovedDeploy()
    const error = await catchHttpError(() => run(publication()))
    expectFlowGateRefusal(error, { scope: 'stage_not_approved', ux: 'stage_not_approved', key_visual: 'stage_not_approved', design_system_ui: 'stage_not_approved' })
    expectNothingWritten()
  })

  it('skips the gate without a stage query on a legacy project', async () => {
    seedApprovedDeploy()
    await expect(run(publication())).resolves.toMatchObject({ duplicate: false })
    expect(queriedEntities).not.toContain(DeliveryFlowStageArtifact)
    expect(queriedEntities).not.toContain(DeliveryFlowStageDecision)
  })
})
