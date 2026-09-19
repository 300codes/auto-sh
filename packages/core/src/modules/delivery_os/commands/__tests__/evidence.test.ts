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
import { LockMode } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { DeliveryBaseline, DeliveryEvidence, DeliveryProject, DeliveryTask } from '../../data/entities'
import { reserveAttempt } from '../../lib/attempts'
import type { ExecutionAttempt, SourceRevision } from '../../lib/contracts'
import { loadBaselineContentFixture, loadResultManifestFixture, loadTaskPackageFixture } from '../../lib/fixtures'
import { deriveProjectStatus } from '../../lib/projectStatus'
import { buildTraceability } from '../../lib/traceability'
import type { EvidenceRecordCommandResult } from '../evidence'
import {
  ACTOR_ID,
  FOREIGN_ORG_ID,
  ORG_ID,
  TENANT_ID,
  UPDATED_AT,
  catchHttpError,
  detailCodes,
  expectFrozenBody,
  getHandler,
  makeAttachmentInspector,
  makeBaseline,
  makeProject,
  matches,
  type EmMock,
  type Row,
} from './baselineTestKit'

const EVIDENCE_EVENT = 'delivery_os.evidence.recorded'
const SCREENSHOT_ID = 'c1c1c1c1-1111-4111-8111-111111111111'
const EXTRA_ATTACHMENT_ID = 'c2c2c2c2-2222-4222-8222-222222222222'
const FOREIGN_ATTACHMENT_ID = 'c3c3c3c3-3333-4333-8333-333333333333'
const OTHER_BASELINE_ID = 'd4d4d4d4-4444-4444-8444-444444444444'
const UNKNOWN_ID = 'e5e5e5e5-5555-4555-8555-555555555555'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SNAPSHOT_REVISION: SourceRevision = { kind: 'snapshot', contentHash: SHA_A, externalWorkspaceId: 'wp-local-1' }

type Store = {
  projects: DeliveryProject[]
  tasks: DeliveryTask[]
  baselines: DeliveryBaseline[]
  evidence: DeliveryEvidence[]
  attachments: Row[]
}

let store: Store
const taskPackage = loadTaskPackageFixture('git')
const manifest = loadResultManifestFixture('git')
const GIT_REVISION = manifest.resultRevision

function rowsFor(entity: unknown): Row[] {
  if (entity === DeliveryProject) return store.projects as unknown as Row[]
  if (entity === DeliveryTask) return store.tasks as unknown as Row[]
  if (entity === DeliveryBaseline) return store.baselines as unknown as Row[]
  if (entity === DeliveryEvidence) return store.evidence as unknown as Row[]
  if (entity === Attachment) return store.attachments
  throw new Error('[internal] unexpected entity in test store')
}

function attachmentRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    mimeType: 'image/png',
    fileSize: 2048,
    partitionCode: 'privateAttachments',
    storagePath: `delivery/${id}.png`,
    storedSha256: SHA_A,
    unreadable: false,
    ...overrides,
  }
}

function reservedAttempt(): ExecutionAttempt {
  const result = reserveAttempt([], {
    idempotencyKey: taskPackage.idempotencyKey,
    payload: { mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
    mode: 'manual_handoff',
    baselineId: taskPackage.baselineId,
    baselineHash: taskPackage.baselineHash,
    baseRevision: taskPackage.baseRevision,
    now: '2026-09-19T10:00:00.000Z',
    newAttemptId: taskPackage.attemptId,
  })
  if (!result.ok) throw new Error('[internal] fixture reservation failed')
  return result.attempt
}

function makeTask(overrides: Partial<DeliveryTask> = {}): DeliveryTask {
  return {
    id: taskPackage.taskId,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: taskPackage.projectId,
    baselineId: taskPackage.baselineId,
    title: taskPackage.title,
    description: null,
    acIds: taskPackage.acceptanceCriteria.map((criterion) => criterion.id),
    dependsOnTaskIds: [],
    allowedPaths: taskPackage.allowedPaths,
    targetProfileId: taskPackage.targetProfileId,
    targetProfileVersion: taskPackage.targetProfileVersion,
    status: 'awaiting_review',
    statusReason: null,
    attemptNumber: 1,
    executionAttempts: [reservedAttempt()],
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryTask
}

function seed(options: { profileId?: string; task?: Partial<DeliveryTask> } = {}): void {
  const profileId = options.profileId ?? taskPackage.targetProfileId
  store = {
    projects: [makeProject({ id: taskPackage.projectId, activeBaselineId: taskPackage.baselineId, targetProfileId: profileId, targetProfileVersion: 1 })],
    tasks: [makeTask({ targetProfileId: profileId, ...options.task })],
    baselines: [
      makeBaseline(loadBaselineContentFixture(), { id: taskPackage.baselineId, projectId: taskPackage.projectId }),
      makeBaseline(loadBaselineContentFixture(), { id: OTHER_BASELINE_ID, projectId: taskPackage.projectId, version: 2 }),
    ],
    evidence: [],
    attachments: [
      attachmentRow(SCREENSHOT_ID),
      attachmentRow(EXTRA_ATTACHMENT_ID, { mimeType: 'application/pdf' }),
      attachmentRow(FOREIGN_ATTACHMENT_ID, { organizationId: FOREIGN_ORG_ID }),
    ],
  }
}

let createdRows = 0

function makeHarness(options: { orgId?: string; sub?: string } = {}) {
  const em: EmMock = {
    fork: jest.fn(),
    create: jest.fn((_entity: unknown, data: Row) => ({ createdAt: new Date(UPDATED_AT.getTime() + 60_000 * ++createdRows), ...data })),
    persist: jest.fn((row: Row) => {
      store.evidence.push(row as unknown as DeliveryEvidence)
    }),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => work(em))
  const services: Record<string, unknown> = {
    em,
    dataEngine: { markOrmEntityChange: jest.fn() },
    deliveryOsAttachmentInspector: makeAttachmentInspector(() => store.attachments),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name in services) return services[name]
      throw new Error(`[internal] ${name} is not registered`)
    }),
  }
  const ctx: CommandRuntimeContext = {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: options.sub ?? ACTOR_ID, tenantId: TENANT_ID, orgId: options.orgId ?? ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: new Request('http://localhost/api/delivery_os/projects/evidence', { method: 'POST' }),
  }
  return { ctx, services }
}

const handler = () => getHandler<EvidenceRecordCommandResult>('delivery_os.evidence.record')

const bodies = {
  test: (): Row => ({
    kind: 'test',
    taskId: taskPackage.taskId,
    attemptId: taskPackage.attemptId,
    sourceRevision: GIT_REVISION,
    payload: { rawReportHash: SHA_A, checks: loadResultManifestFixture('git').checks },
  }),
  screenshot: (): Row => ({
    kind: 'screenshot',
    taskId: taskPackage.taskId,
    sourceRevision: GIT_REVISION,
    attachmentIds: [EXTRA_ATTACHMENT_ID],
    payload: {
      attachmentId: SCREENSHOT_ID,
      sha256: SHA_A,
      name: 'Service list at 1280',
      viewport: { width: 1280, height: 720 },
      capturedAt: '2026-09-19T10:05:00.000Z',
    },
  }),
  scan: (): Row => ({
    kind: 'scan',
    sourceRevision: GIT_REVISION,
    payload: { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: SHA_B },
  }),
  deployment: (): Row => ({
    kind: 'deployment',
    sourceRevision: GIT_REVISION,
    payload: {
      url: 'https://preview.example.test/build-42',
      environment: 'preview',
      buildId: 'build-42',
      deployedAt: '2026-09-19T10:10:00.000Z',
      uploadStatus: 'succeeded',
    },
  }),
  reference_material: (): Row => ({
    kind: 'reference_material',
    payload: { title: 'Historical WordPress smoke report', origin: 'wp-m02 archive' },
  }),
}

function input(body: Row, overrides: Row = {}): Row {
  return { projectId: taskPackage.projectId, baselineId: taskPackage.baselineId, ...body, ...overrides }
}

function record(payload: Row, options: Parameters<typeof makeHarness>[0] = {}) {
  const { ctx } = makeHarness(options)
  return handler().execute(payload, ctx)
}

function emitted(): Row[] {
  return mockEmitDeliveryOsEvent.mock.calls.filter(([id]) => id === EVIDENCE_EVENT).map(([, payload]) => payload as Row)
}

beforeEach(() => {
  jest.clearAllMocks()
  seed()
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).filter((row) => matches(row, where)),
  )
  mockFindOneWithDecryption.mockImplementation(
    async (_em: unknown, entity: unknown, where: Row) => rowsFor(entity).find((row) => matches(row, where)) ?? null,
  )
})

describe('delivery_os.evidence.record: storing each kind once', () => {
  it.each(['test', 'screenshot', 'scan', 'deployment'] as const)('stores %s evidence once and answers a replay as a duplicate', async (kind) => {
    const tasksBefore = JSON.stringify(store.tasks)
    const first = await record(input(bodies[kind]()))
    expect(first).toEqual({ evidenceId: expect.any(String), duplicate: false, kind })
    const replay = await record(input(bodies[kind]()))
    expect(replay).toEqual({ evidenceId: first.evidenceId, duplicate: true, kind })

    expect(store.evidence).toHaveLength(1)
    expect(store.evidence[0]).toMatchObject({
      id: first.evidenceId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: taskPackage.projectId,
      baselineId: taskPackage.baselineId,
      kind,
      source: 'manual',
      recordedBy: ACTOR_ID,
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(store.tasks)).toBe(tasksBefore)
    expect(emitted().map((payload) => payload.duplicate)).toEqual([false, true])
    expect(emitted()[0]).toEqual({
      projectId: taskPackage.projectId,
      taskId: store.evidence[0].taskId ?? null,
      attemptId: store.evidence[0].attemptId ?? null,
      evidenceId: first.evidenceId,
      kind,
      duplicate: false,
      completionDelivery: null,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(mockEmitDeliveryOsEvent.mock.calls[0][2]).toEqual({ persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('stores reference material for the WordPress profile once', async () => {
    seed({ profileId: 'wordpress-theme' })
    const first = await record(input(bodies.reference_material(), { sourceRevision: SNAPSHOT_REVISION }))
    const replay = await record(input(bodies.reference_material(), { sourceRevision: SNAPSHOT_REVISION }))
    expect(replay).toEqual({ evidenceId: first.evidenceId, duplicate: true, kind: 'reference_material' })
    expect(store.evidence).toHaveLength(1)
    expect(store.evidence[0]).toMatchObject({ kind: 'reference_material', taskId: null, attemptId: null, rawReportHash: null })
  })

  it('keeps the raw report hash of tests and scans and the verified file ids', async () => {
    await record(input(bodies.test()))
    await record(input(bodies.scan()))
    await record(input(bodies.screenshot()))
    expect(store.evidence.map((row) => row.rawReportHash)).toEqual([SHA_A, SHA_B, null])
    expect(store.evidence[0]).toMatchObject({ taskId: taskPackage.taskId, attemptId: taskPackage.attemptId, sourceRevision: GIT_REVISION })
    expect(store.evidence[2].attachmentIds).toEqual([SCREENSHOT_ID, EXTRA_ATTACHMENT_ID].sort())
  })

  it('treats the same proof for another task, baseline or revision as new evidence', async () => {
    await record(input(bodies.scan()))
    await record(input(bodies.scan(), { taskId: taskPackage.taskId }))
    await record(input(bodies.scan(), { baselineId: OTHER_BASELINE_ID }))
    await record(input(bodies.scan(), { sourceRevision: { kind: 'git', commitSha: 'c'.repeat(40) } }))
    expect(store.evidence).toHaveLength(4)
    expect(new Set(store.evidence.map((row) => row.payloadHash)).size).toBe(4)
  })

  it('answers a replay before any domain check and without reading storage', async () => {
    const first = await record(input(bodies.screenshot()))
    store.baselines = []
    store.attachments[0].storedSha256 = SHA_B
    const { ctx, services } = makeHarness()
    const replay = await handler().execute(input(bodies.screenshot()), ctx)
    expect(replay).toEqual({ evidenceId: first.evidenceId, duplicate: true, kind: 'screenshot' })
    expect(services.deliveryOsAttachmentInspector).not.toHaveBeenCalled()
    expect(store.evidence).toHaveLength(1)
  })

  it('locks the project row and writes one audit entry, none for a duplicate', async () => {
    const { ctx } = makeHarness()
    const result = await handler().execute(input(bodies.scan()), ctx)
    const projectRead = mockFindOneWithDecryption.mock.calls.find(([, entity]) => entity === DeliveryProject)
    expect(projectRead?.[3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })

    const log = await handler().buildLog?.({ input: input(bodies.scan()), result, ctx, snapshots: {} } as never)
    expect(log).toMatchObject({
      resourceKind: 'delivery_os.evidence',
      resourceId: result.evidenceId,
      parentResourceKind: 'delivery_os.project',
      parentResourceId: taskPackage.projectId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    const duplicateLog = await handler().buildLog?.({ input: input(bodies.scan()), result: { ...result, duplicate: true }, ctx, snapshots: {} } as never)
    expect(duplicateLog).toBeNull()
    expect(handler().undo).toBeUndefined()
  })
})

describe('delivery_os.evidence.record: scope', () => {
  it('ignores tenant, organization, source and recorder values in the input', async () => {
    const spoofed = input(bodies.scan(), { tenantId: FOREIGN_ORG_ID, organizationId: FOREIGN_ORG_ID, source: 'adapter', recordedBy: UNKNOWN_ID })
    const first = await record(spoofed)
    expect(store.evidence[0]).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID, source: 'manual', recordedBy: ACTOR_ID })
    expect('tenantId' in store.evidence[0].payload).toBe(false)
    expect(await record(input(bodies.scan()))).toEqual({ evidenceId: first.evidenceId, duplicate: true, kind: 'scan' })
  })

  it('does not hash a client-sent verification status and stores no recorder for a session without a user id', async () => {
    const first = await record(input(bodies.deployment()), { sub: 'api-key:not-a-uuid' })
    const claimed = bodies.deployment()
    ;(claimed.payload as Row).verificationStatus = 'verified'
    expect(await record(input(claimed))).toEqual({ evidenceId: first.evidenceId, duplicate: true, kind: 'deployment' })
    expect(store.evidence).toHaveLength(1)
    expect(store.evidence[0]).toMatchObject({ recordedBy: null, payload: { verificationStatus: 'unverified' } })
  })

  it('answers 404 for a project of another organization and for a malformed project id', async () => {
    expectFrozenBody(await catchHttpError(() => record(input(bodies.scan()), { orgId: FOREIGN_ORG_ID })), 404, 'not_found')
    expectFrozenBody(await catchHttpError(() => record(input(bodies.scan(), { projectId: 'nope' }))), 404, 'not_found')
    expect(store.evidence).toHaveLength(0)
    expect(emitted()).toHaveLength(0)
  })

  it('refuses a baseline or task of another project and an unknown attempt', async () => {
    const foreignBaseline = await catchHttpError(() => record(input(bodies.scan(), { baselineId: UNKNOWN_ID })))
    expectFrozenBody(foreignBaseline, 422, 'foreign_reference')
    expect(detailCodes(foreignBaseline)).toEqual(['foreign_baseline'])

    const foreignTask = await catchHttpError(() => record(input(bodies.scan(), { taskId: UNKNOWN_ID })))
    expectFrozenBody(foreignTask, 422, 'foreign_reference')
    expect(detailCodes(foreignTask)).toEqual(['foreign_task'])

    store.tasks[0].deletedAt = UPDATED_AT
    expectFrozenBody(await catchHttpError(() => record(input(bodies.scan(), { taskId: taskPackage.taskId }))), 422, 'foreign_reference')
    store.tasks[0].deletedAt = null

    const unknownAttempt = await catchHttpError(() => record(input(bodies.test(), { attemptId: UNKNOWN_ID })))
    expectFrozenBody(unknownAttempt, 404, 'attempt_not_found')
    expect(store.evidence).toHaveLength(0)
  })

  it('refuses a task or attempt pinned to another baseline and an unreadable attempt list', async () => {
    const mismatch = await catchHttpError(() => record(input(bodies.test(), { baselineId: OTHER_BASELINE_ID })))
    expectFrozenBody(mismatch, 422, 'baseline_mismatch')
    expect(detailCodes(mismatch)).toEqual(['task_baseline_mismatch', 'attempt_baseline_mismatch'])

    store.tasks[0].executionAttempts = [{ broken: true }] as unknown as ExecutionAttempt[]
    const unreadable = await catchHttpError(() => record(input(bodies.test())))
    expectFrozenBody(unreadable, 409, 'reconciliation_required')
    expect(store.evidence).toHaveLength(0)
  })
})

describe('delivery_os.evidence.record: rules per kind', () => {
  it('refuses test evidence for an AC outside the baseline or outside the task', async () => {
    const outside = bodies.test()
    ;(outside.payload as { checks: Array<{ acIds: string[] }> }).checks[0].acIds.push('AC-999')
    const unknown = await catchHttpError(() => record(input(outside)))
    expectFrozenBody(unknown, 422, 'unknown_ac')
    expect(unknown.body).toMatchObject({ details: [{ path: 'payload.checks.0.acIds.1', code: 'unknown_ac' }] })

    store.tasks[0].acIds = ['AC-001']
    expectFrozenBody(await catchHttpError(() => record(input(bodies.test()))), 422, 'unknown_ac')
    expect((await record(input(bodies.test(), { taskId: undefined, attemptId: undefined }))).duplicate).toBe(false)
  })

  it('refuses a test the baseline never declared', async () => {
    const invented = bodies.test()
    const checks = (invented.payload as { checks: Array<{ testId: string; acIds: string[] }> }).checks
    checks[0].testId = 'a test the agent invented'
    checks[0].acIds = []
    const error = await catchHttpError(() => record(input(invented)))
    expectFrozenBody(error, 422, 'unknown_test_id')
    expect(store.evidence).toHaveLength(0)
  })

  it('refuses test evidence when the stored baseline no longer matches its hash', async () => {
    store.baselines[0].contentHash = SHA_B
    const error = await catchHttpError(() => record(input(bodies.test())))
    expectFrozenBody(error, 422, 'hash_mismatch')
    expect(detailCodes(error)).toEqual(['stored_content_altered'])
  })

  it('refuses a screenshot whose stored bytes do not match the declared hash', async () => {
    const forged = bodies.screenshot()
    ;(forged.payload as Row).sha256 = SHA_B
    const error = await catchHttpError(() => record(input(forged)))
    expectFrozenBody(error, 422, 'hash_mismatch')
    expect(error.body).toMatchObject({ details: [{ path: 'payload.sha256', code: 'sha256_mismatch' }] })
    expect(store.evidence).toHaveLength(0)
  })

  it('refuses a screenshot that is not an image and a file that cannot be read', async () => {
    const notImage = bodies.screenshot()
    ;(notImage.payload as Row).attachmentId = EXTRA_ATTACHMENT_ID
    const typeError = await catchHttpError(() => record(input(notImage)))
    expectFrozenBody(typeError, 422, 'hash_mismatch')
    expect(detailCodes(typeError)).toEqual(['unsupported_mime_type'])

    store.attachments[0].unreadable = true
    const unreadable = await catchHttpError(() => record(input(bodies.screenshot())))
    expectFrozenBody(unreadable, 422, 'hash_mismatch')
    expect(detailCodes(unreadable)).toEqual(['attachment_unreadable'])
  })

  it('refuses files of another organization, as a screenshot and as an extra attachment', async () => {
    const foreignShot = bodies.screenshot()
    ;(foreignShot.payload as Row).attachmentId = FOREIGN_ATTACHMENT_ID
    const shotError = await catchHttpError(() => record(input(foreignShot)))
    expectFrozenBody(shotError, 422, 'foreign_reference')
    expect(shotError.body).toMatchObject({ details: [{ path: 'payload.attachmentId', code: 'attachment_scope_mismatch' }] })

    const extraError = await catchHttpError(() => record(input(bodies.scan(), { attachmentIds: [EXTRA_ATTACHMENT_ID, FOREIGN_ATTACHMENT_ID] })))
    expectFrozenBody(extraError, 422, 'foreign_reference')
    expect(extraError.body).toMatchObject({ details: [{ path: 'attachmentIds.1', code: 'attachment_scope_mismatch' }] })
    expect(store.evidence).toHaveLength(0)
  })

  it('refuses a scan that names a lint check and stores the scan status', async () => {
    const wrong = bodies.scan()
    ;(wrong.payload as Row).checkId = 'lint'
    const error = await catchHttpError(() => record(input(wrong)))
    expectFrozenBody(error, 422, 'unknown_test_id')
    expect(detailCodes(error)).toEqual(['check_id_mismatch'])

    const failed = bodies.scan()
    ;(failed.payload as Row).status = 'failed'
    await record(input(failed))
    expect(store.evidence[0].payload).toMatchObject({ checkId: 'dependency-audit', status: 'failed', rawReportHash: SHA_B })
  })

  it('refuses a deployment without a build id, url, environment or revision', async () => {
    for (const field of ['buildId', 'url', 'environment']) {
      const incomplete = bodies.deployment()
      delete (incomplete.payload as Row)[field]
      const error = await catchHttpError(() => record(input(incomplete)))
      expectFrozenBody(error, 422, 'deployment_incomplete')
      expect(error.body).toMatchObject({ details: [{ path: `payload.${field}` }] })
    }
    const noRevision = await catchHttpError(() => record(input(bodies.deployment(), { sourceRevision: undefined })))
    expectFrozenBody(noRevision, 422, 'deployment_incomplete')
    expect(store.evidence).toHaveLength(0)
  })

  it('stores a deployment as unverified until a verification of the same build is included', async () => {
    await record(input(bodies.deployment()))
    expect(store.evidence[0].payload).toMatchObject({ verification: null, verificationStatus: 'unverified' })

    const verification = { status: 'verified', checkedAt: '2026-09-19T10:20:00.000Z', method: 'GET /build.json', observedBuildId: 'build-42' }
    const verified = bodies.deployment()
    ;(verified.payload as Row).verification = verification
    await record(input(verified))
    expect(store.evidence[1].payload).toMatchObject({ verificationStatus: 'verified' })

    const anotherBuild = bodies.deployment()
    ;(anotherBuild.payload as Row).verification = { ...verification, observedBuildId: 'build-41' }
    ;(anotherBuild.payload as Row).verificationStatus = 'verified'
    await record(input(anotherBuild))
    expect(store.evidence[2].payload).toMatchObject({ verificationStatus: 'failed' })
    expect(store.evidence).toHaveLength(3)
  })

  it('accepts a snapshot revision for wordpress-theme@1 and refuses it for react-vite@1', async () => {
    const refused = await catchHttpError(() => record(input(bodies.scan(), { sourceRevision: SNAPSHOT_REVISION })))
    expectFrozenBody(refused, 422, 'revision_kind_mismatch')
    expect(refused.body).toMatchObject({ details: [{ path: 'sourceRevision.kind', code: 'revision_kind_mismatch' }] })
    const refusedTest = await catchHttpError(() => record(input(bodies.test(), { sourceRevision: SNAPSHOT_REVISION })))
    expectFrozenBody(refusedTest, 422, 'revision_kind_mismatch')

    seed({ profileId: 'wordpress-theme' })
    const accepted = await record(input({ ...bodies.scan(), payload: { ...(bodies.scan().payload as Row), checkId: 'wpscan' } }, { sourceRevision: SNAPSHOT_REVISION }))
    expect(accepted.duplicate).toBe(false)
    const gitOnWordpress = await catchHttpError(() => record(input(bodies.deployment())))
    expectFrozenBody(gitOnWordpress, 422, 'revision_kind_mismatch')
    expect(store.evidence).toHaveLength(1)
  })

  it('permits reference material only where the profile does', async () => {
    const notPermitted = await catchHttpError(() => record(input(bodies.reference_material())))
    expectFrozenBody(notPermitted, 422, 'unsupported_evidence_kind')
    expect(detailCodes(notPermitted)).toEqual(['kind_not_permitted_for_profile'])

    const unknown = await catchHttpError(() => record(input({ kind: 'result_manifest', payload: {} })))
    expectFrozenBody(unknown, 422, 'unsupported_evidence_kind')
    expect(store.evidence).toHaveLength(0)
  })
})

describe('delivery_os.evidence.record: reference material never counts as proof', () => {
  it('does not change project status, progress or AC proof', async () => {
    seed({ profileId: 'wordpress-theme', task: { status: 'awaiting_review' } })
    const content = loadBaselineContentFixture()
    const baseline = { id: taskPackage.baselineId, projectId: taskPackage.projectId }
    const statusInput = (): Parameters<typeof deriveProjectStatus>[0] => ({
      project: { deletedAt: null, activeBaselineId: baseline.id },
      baselines: [{ id: baseline.id, acIds: content.acceptanceCriteria.map((criterion) => criterion.id) }],
      tasks: store.tasks.map((task) => ({ id: task.id, baselineId: task.baselineId, status: task.status, acIds: task.acIds, deletedAt: null })),
      evidence: store.evidence.map((row) => ({ kind: row.kind, baselineId: row.baselineId, sourceRevision: row.sourceRevision ?? null, createdAt: row.createdAt })),
      decisions: [],
    })
    const before = deriveProjectStatus(statusInput())

    await record(input(bodies.reference_material(), { taskId: taskPackage.taskId, sourceRevision: SNAPSHOT_REVISION }))
    expect(store.evidence).toHaveLength(1)
    expect(deriveProjectStatus(statusInput())).toEqual(before)

    const trace = buildTraceability({
      projectId: taskPackage.projectId,
      baseline: { ...baseline, requirements: content.requirements, acceptanceCriteria: content.acceptanceCriteria },
      tasks: store.tasks.map((task) => ({ id: task.id, projectId: task.projectId, baselineId: task.baselineId, title: task.title, status: task.status, acIds: task.acIds })),
      evidence: store.evidence.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        baselineId: row.baselineId,
        taskId: row.taskId ?? null,
        kind: row.kind,
        sourceRevision: row.sourceRevision ?? null,
        rawReportHash: row.rawReportHash ?? null,
      })),
      limit: 100,
    })
    const rows = trace.rows.filter((row) => row.evidenceId === store.evidence[0].id)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.countsAsAcEvidence === false)).toBe(true)
    expect(store.tasks[0].status).toBe('awaiting_review')
  })
})

const DEPENDANT_ID = 'f6f6f6f6-6666-4666-8666-666666666666'
const OTHER_REVISION: SourceRevision = { kind: 'git', commitSha: '1'.repeat(40) }
const AC_002_TEST = 'service catalogue AC-002: category filter narrows the list'
const TASK_EVENT = 'delivery_os.task.updated'

type ManifestCheck = (typeof manifest.checks)[number]

function manifestWith(mutate: (check: ManifestCheck) => ManifestCheck | null): Row {
  return { ...manifest, checks: manifest.checks.map(mutate).filter((check): check is ManifestCheck => check !== null) }
}

function seedResult(overrides: Row = {}): Row {
  const row: Row = {
    id: `a0a0a0a0-0000-4000-8000-${String(store.evidence.length + 1).padStart(12, '0')}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: taskPackage.projectId,
    baselineId: taskPackage.baselineId,
    taskId: taskPackage.taskId,
    attemptId: taskPackage.attemptId,
    kind: 'result_manifest',
    source: 'adapter',
    sourceRevision: GIT_REVISION,
    payload: manifest,
    payloadHash: SHA_A,
    rawReportHash: null,
    attachmentIds: [],
    recordedBy: null,
    createdAt: new Date('2026-09-19T08:30:00.000Z'),
    ...overrides,
  }
  store.evidence.push(row as unknown as DeliveryEvidence)
  return row
}

function review(payload: Row, overrides: Row = {}): Row {
  return input(
    { kind: 'review', taskId: taskPackage.taskId, sourceRevision: GIT_REVISION, payload: { summary: 'Reviewed the result', reviewer: { kind: 'human' }, ...payload } },
    overrides,
  )
}

function taskEvents(): Row[] {
  return mockEmitDeliveryOsEvent.mock.calls.filter(([id]) => id === TASK_EVENT).map(([, payload]) => payload as Row)
}

function task(): DeliveryTask {
  return store.tasks[0]
}

describe('delivery_os.evidence.record: review approves only what the system can prove', () => {
  it('moves awaiting_review to verified when every required test passed on the result revision', async () => {
    seedResult()
    const result = await record(review({ verdict: 'approved' }))
    expect(result).toEqual({
      evidenceId: expect.any(String),
      duplicate: false,
      kind: 'review',
      taskStatus: 'verified',
      taskStatusReason: null,
      taskUpdatedAt: UPDATED_AT.toISOString(),
      propagatedTaskIds: [],
    })
    expect(task()).toMatchObject({ status: 'verified', statusReason: null })
    expect(store.evidence).toHaveLength(2)
    expect(store.evidence[1]).toMatchObject({ kind: 'review', taskId: taskPackage.taskId, attemptId: null, source: 'manual', recordedBy: ACTOR_ID })
    expect(emitted()).toHaveLength(1)
    expect(emitted()[0]).toMatchObject({ kind: 'review', taskId: taskPackage.taskId, duplicate: false })
    expect(taskEvents()).toEqual([expect.objectContaining({ taskId: taskPackage.taskId, status: 'verified', statusReason: null })])
  })

  it('lets an agent approve when the proof is complete and stores who reviewed', async () => {
    seedResult()
    const result = await record(review({ verdict: 'approved', reviewer: { kind: 'agent', ref: 'reviewer-agent' } }), { sub: 'agent-runner' })
    expect(result.taskStatus).toBe('verified')
    expect(store.evidence[1]).toMatchObject({ payload: expect.objectContaining({ reviewer: { kind: 'agent', ref: 'reviewer-agent' } }), recordedBy: null })
  })

  it.each([
    ['not_run', (check: ManifestCheck) => (check.testId === AC_002_TEST ? { ...check, status: 'not_run' as const } : check)],
    ['failed', (check: ManifestCheck) => (check.testId === AC_002_TEST ? { ...check, status: 'failed' as const } : check)],
    ['missing', (check: ManifestCheck) => (check.testId === AC_002_TEST ? null : check)],
  ])('refuses approval while a required test is %s and leaves the task untouched', async (_label, mutate) => {
    seedResult({ payload: manifestWith(mutate) })
    const error = await catchHttpError(() => record(review({ verdict: 'approved' })))
    expectFrozenBody(error, 422, 'missing_required_tests')
    expect(detailCodes(error)).toEqual(['ac_unproven'])
    expect((error.body.details as Row[])[0].path).toBe('acIds.AC-002')
    expect(task()).toMatchObject({ status: 'awaiting_review', statusReason: null })
    expect(store.evidence).toHaveLength(1)
    expect(taskEvents()).toEqual([])
  })

  it('counts test evidence only on the result revision, also project-level rows', async () => {
    seedResult({ payload: manifestWith((check) => (check.testId === AC_002_TEST ? null : check)) })
    const testRow = (revision: SourceRevision, overrides: Row = {}): Row => ({
      ...seedResult({ kind: 'test', attemptId: null, sourceRevision: revision, payload: { rawReportHash: SHA_B, checks: manifest.checks.filter((check) => check.testId === AC_002_TEST).map((check) => ({ ...check, sourceRevision: revision })) }, ...overrides }),
    })
    testRow(OTHER_REVISION)
    const stillUnproven = await catchHttpError(() => record(review({ verdict: 'approved' })))
    expectFrozenBody(stillUnproven, 422, 'missing_required_tests')

    testRow(GIT_REVISION, { taskId: null, baselineId: OTHER_BASELINE_ID })
    const otherBaseline = await catchHttpError(() => record(review({ verdict: 'approved' })))
    expectFrozenBody(otherBaseline, 422, 'missing_required_tests')

    testRow(GIT_REVISION, { taskId: null })
    const result = await record(review({ verdict: 'approved' }))
    expect(result.taskStatus).toBe('verified')
  })

  it('reviews the result of the named attempt when attemptId is given', async () => {
    seedResult({
      sourceRevision: OTHER_REVISION,
      payload: { ...manifest, resultRevision: OTHER_REVISION, checks: manifest.checks.map((check) => ({ ...check, sourceRevision: OTHER_REVISION })) },
    })
    seedResult({ attemptId: UNKNOWN_ID, createdAt: new Date('2026-09-19T08:45:00.000Z') })
    const wrongAttempt = await catchHttpError(() => record(review({ verdict: 'approved' }, { attemptId: taskPackage.attemptId })))
    expectFrozenBody(wrongAttempt, 422, 'missing_required_tests')
    expect(detailCodes(wrongAttempt)).toEqual(['revision_mismatch'])

    const result = await record(review({ verdict: 'approved' }, { sourceRevision: OTHER_REVISION, attemptId: taskPackage.attemptId }))
    expect(result.taskStatus).toBe('verified')
    expect(store.evidence.at(-1)).toMatchObject({ kind: 'review', attemptId: taskPackage.attemptId })
  })

  it('answers a review that names another revision than the accepted result with revision_mismatch', async () => {
    seedResult()
    const error = await catchHttpError(() => record(review({ verdict: 'approved' }, { sourceRevision: OTHER_REVISION })))
    expectFrozenBody(error, 422, 'missing_required_tests')
    expect(detailCodes(error)).toEqual(['revision_mismatch'])
    expect(task().status).toBe('awaiting_review')
  })

  it('needs an accepted result on the pinned baseline', async () => {
    const noResult = await catchHttpError(() => record(review({ verdict: 'approved' })))
    expectFrozenBody(noResult, 422, 'missing_required_tests')
    expect(detailCodes(noResult)).toEqual(['missing_evidence'])

    seedResult({ baselineId: OTHER_BASELINE_ID })
    const otherBaseline = await catchHttpError(() => record(review({ verdict: 'changes_requested' })))
    expectFrozenBody(otherBaseline, 422, 'baseline_mismatch')
    expect(task().status).toBe('awaiting_review')
    expect(store.evidence).toHaveLength(1)
  })

  it('refuses a reviewedEvidenceId of another task and accepts one of this task', async () => {
    const result = seedResult()
    const foreign = await catchHttpError(() => record(review({ verdict: 'approved', reviewedEvidenceId: UNKNOWN_ID })))
    expectFrozenBody(foreign, 422, 'foreign_reference')
    expect(detailCodes(foreign)).toEqual(['foreign_evidence'])

    const accepted = await record(review({ verdict: 'approved', reviewedEvidenceId: result.id }))
    expect(accepted.taskStatus).toBe('verified')
  })

  it('returns dependency-blocked descendants to draft when the task is verified', async () => {
    seedResult()
    store.tasks.push(makeTask({ id: DEPENDANT_ID, status: 'blocked', statusReason: 'dependency_blocked', dependsOnTaskIds: [taskPackage.taskId], executionAttempts: [] }))
    const result = await record(review({ verdict: 'approved' }))
    expect(result.propagatedTaskIds).toEqual([DEPENDANT_ID])
    expect(store.tasks[1]).toMatchObject({ status: 'draft', statusReason: null })
    expect(taskEvents().map((event) => [event.taskId, event.status])).toEqual([[taskPackage.taskId, 'verified'], [DEPENDANT_ID, 'draft']])
  })
})

describe('delivery_os.evidence.record: review correction rounds', () => {
  it('opens correction rounds and blocks the task once the limit is reached', async () => {
    seedResult()
    store.tasks.push(makeTask({ id: DEPENDANT_ID, status: 'ready', dependsOnTaskIds: [taskPackage.taskId], executionAttempts: [] }))

    const first = await record(review({ verdict: 'changes_requested', summary: 'Round one' }))
    expect(first).toMatchObject({ taskStatus: 'changes_requested', taskStatusReason: null, propagatedTaskIds: [] })
    expect(task()).toMatchObject({ status: 'changes_requested', statusReason: null })

    task().status = 'awaiting_review'
    const second = await record(review({ verdict: 'changes_requested', summary: 'Round two' }))
    expect(second.taskStatus).toBe('changes_requested')

    task().status = 'awaiting_review'
    const third = await record(review({ verdict: 'changes_requested', summary: 'Round three' }))
    expect(third).toMatchObject({ taskStatus: 'blocked', taskStatusReason: 'correction_limit_reached', propagatedTaskIds: [DEPENDANT_ID] })
    expect(task()).toMatchObject({ status: 'blocked', statusReason: 'correction_limit_reached' })
    expect(store.tasks[1]).toMatchObject({ status: 'blocked', statusReason: 'dependency_blocked' })
    expect(store.evidence.filter((row) => row.kind === 'review')).toHaveLength(3)
    expect(taskEvents().at(-1)).toMatchObject({ taskId: DEPENDANT_ID, status: 'blocked', statusReason: 'dependency_blocked' })

    const afterLimit = await catchHttpError(() => record(review({ verdict: 'changes_requested', summary: 'Round four' })))
    expectFrozenBody(afterLimit, 409, 'invalid_transition')
    expect(detailCodes(afterLimit)).toEqual(['task_not_awaiting_review'])
  })

  it('treats the same words as a replay only while nothing happened since', async () => {
    seedResult()
    const first = await record(review({ verdict: 'changes_requested' }))
    task().status = 'awaiting_review'
    const replay = await record(review({ verdict: 'changes_requested' }))
    expect(replay).toEqual({
      evidenceId: first.evidenceId,
      duplicate: true,
      kind: 'review',
      taskStatus: 'awaiting_review',
      taskStatusReason: null,
      taskUpdatedAt: UPDATED_AT.toISOString(),
      propagatedTaskIds: [],
    })
    expect(task().status).toBe('awaiting_review')
    expect(emitted().map((event) => event.duplicate)).toEqual([false, true])

    seedResult({ createdAt: new Date('2026-09-19T12:00:00.000Z'), sourceRevision: GIT_REVISION })
    const afterNewResult = await record(review({ verdict: 'changes_requested' }))
    expect(afterNewResult.duplicate).toBe(false)
    expect(afterNewResult.taskStatus).toBe('changes_requested')
    expect(store.evidence.filter((row) => row.kind === 'review')).toHaveLength(2)
  })

  it.each(['draft', 'ready', 'executing', 'changes_requested', 'blocked', 'verified', 'cancelled'] as const)('answers 409 invalid_transition for a review while %s', async (status) => {
    seedResult()
    task().status = status
    const error = await catchHttpError(() => record(review({ verdict: 'changes_requested' })))
    expectFrozenBody(error, 409, 'invalid_transition')
    expect(detailCodes(error)).toEqual(['task_not_awaiting_review'])
    expect(task().status).toBe(status)
    expect(store.evidence).toHaveLength(1)
  })
})

describe('delivery_os.evidence.record: manual checks and reviewers', () => {
  const MANUAL_TASK = { acIds: ['AC-001', 'AC-002', 'AC-003'] }

  it('keeps a manual AC unproven until a human approves its manual check, then verifies', async () => {
    seed({ task: MANUAL_TASK })
    seedResult()
    const unproven = await catchHttpError(() => record(review({ verdict: 'approved' })))
    expectFrozenBody(unproven, 422, 'missing_required_tests')
    expect((unproven.body.details as Row[]).map((detail) => detail.path)).toEqual(['acIds.AC-003'])

    const agentVerdict = await catchHttpError(() => record(review({ verdict: 'approved', manualCheckId: 'MC-visual-001', reviewer: { kind: 'agent' } })))
    expectFrozenBody(agentVerdict, 400, 'validation_failed')
    expect(detailCodes(agentVerdict)).toEqual(['human_reviewer_required'])

    const unknownCheck = await catchHttpError(() => record(review({ verdict: 'approved', manualCheckId: 'MC-nope' })))
    expectFrozenBody(unknownCheck, 422, 'unknown_test_id')
    expect(detailCodes(unknownCheck)).toEqual(['unknown_manual_check'])

    const rejected = await record(review({ verdict: 'changes_requested', manualCheckId: 'MC-visual-001', summary: 'Spacing is off' }))
    expect(rejected).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
    const stillFailed = await catchHttpError(() => record(review({ verdict: 'approved' })))
    expectFrozenBody(stillFailed, 422, 'missing_required_tests')

    const approvedCheck = await record(review({ verdict: 'approved', manualCheckId: 'MC-visual-001', summary: 'Matches the design' }))
    expect(approvedCheck).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review', taskStatusReason: null })
    expect(taskEvents()).toEqual([])

    const verified = await record(review({ verdict: 'approved' }))
    expect(verified.taskStatus).toBe('verified')
    expect(store.evidence.filter((row) => row.kind === 'review')).toHaveLength(3)
  })

  it('does not count manual-check verdicts as correction rounds', async () => {
    seed({ task: MANUAL_TASK })
    seedResult()
    await record(review({ verdict: 'changes_requested', manualCheckId: 'MC-visual-001', summary: 'One' }))
    await record(review({ verdict: 'changes_requested', manualCheckId: 'MC-visual-001', summary: 'Two' }))
    await record(review({ verdict: 'changes_requested', manualCheckId: 'MC-visual-001', summary: 'Three' }))
    const round = await record(review({ verdict: 'changes_requested' }))
    expect(round.taskStatus).toBe('changes_requested')
  })

  it('needs a signed-in user for a human review but not for an agent review', async () => {
    seedResult()
    const noUser = await catchHttpError(() => record(review({ verdict: 'changes_requested' }), { sub: 'agent-runner' }))
    expectFrozenBody(noUser, 403, 'forbidden')
    expect(detailCodes(noUser)).toEqual(['actor_required'])
    expect(store.evidence).toHaveLength(1)

    await record(review({ verdict: 'changes_requested' }))
    task().status = 'awaiting_review'
    const replayWithoutUser = await catchHttpError(() => record(review({ verdict: 'changes_requested' }), { sub: 'agent-runner' }))
    expectFrozenBody(replayWithoutUser, 403, 'forbidden')

    const agent = await record(review({ verdict: 'changes_requested', reviewer: { kind: 'agent', ref: 'reviewer-agent' } }), { sub: 'agent-runner' })
    expect(agent.taskStatus).toBe('changes_requested')
  })

  it('refuses a review of a task outside the project', async () => {
    seedResult()
    const error = await catchHttpError(() => record(review({ verdict: 'approved' }, { taskId: UNKNOWN_ID })))
    expectFrozenBody(error, 422, 'foreign_reference')
    expect(detailCodes(error)).toEqual(['foreign_task'])
  })
})
