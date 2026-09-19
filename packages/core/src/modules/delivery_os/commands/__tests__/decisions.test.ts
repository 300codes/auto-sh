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
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DeliveryEvidence, DeliveryProject } from '../../data/entities'
import type { SourceRevision } from '../../lib/contracts'
import type { DecisionCommandResult } from '../decisions'
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
  makeBaseline,
  makeHarness,
  makeProject,
  matches,
  PROJECT_ID,
  rowsFor,
  STALE_UPDATED_AT,
  TENANT_ID,
  ORG_ID,
  type Row,
  type Store,
} from './baselineTestKit'

let store: Store
let evidence: Row[]

const record = getHandler<DecisionCommandResult>('delivery_os.decisions.record')

function headersFor(project: DeliveryProject): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: project.updatedAt.toISOString() }
}

function decisionInput(overrides: Row = {}): Row {
  const [baseline] = store.baselines
  return {
    baselineId: baseline.id,
    kind: 'requirements',
    verdict: 'approved',
    subjectHash: baseline.contentHash,
    subjectVersion: baseline.version,
    ...overrides,
  }
}

function decide(overrides: Row = {}): Promise<DecisionCommandResult> {
  const { ctx } = makeHarness(store, { headers: headersFor(store.projects[0]) })
  return Promise.resolve(record.execute(decisionInput(overrides), ctx))
}

beforeEach(() => {
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  const rows = (entity: unknown): Row[] => (entity === DeliveryEvidence ? evidence : rowsFor(store, entity))
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rows(entity).find((row) => matches(row, where)) ?? null,
  )
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rows(entity).filter((row) => matches(row, where)),
  )
  store = { ...emptyStore(), projects: [makeProject()], baselines: [makeBaseline()] }
  evidence = []
})

describe('delivery_os.decisions.record', () => {
  it('appends a hash-bound decision under the project lock and leaves the active baseline unset', async () => {
    const { ctx, em } = makeHarness(store, { headers: headersFor(store.projects[0]) })
    const before = store.projects[0].updatedAt
    const result = await record.execute(decisionInput(), ctx)

    expect(result).toMatchObject({ activeBaselineId: null, activeBaselineChanged: false, kind: 'requirements' })
    expect(store.decisions).toHaveLength(1)
    expect(store.decisions[0]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      subjectType: 'baseline',
      subjectId: BASELINE_ID,
      subjectHash: store.baselines[0].contentHash,
      subjectVersion: 1,
      verdict: 'approved',
      actorUserId: ACTOR_ID,
      reason: null,
    })
    expect(store.projects[0].activeBaselineId).toBeNull()
    expect(store.projects[0].updatedAt.getTime()).toBeGreaterThan(before.getTime())
    expect(result.projectUpdatedAt).toBe(store.projects[0].updatedAt.toISOString())
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
    const lockedLoad = mockFindOneWithDecryption.mock.calls.find(
      ([, entity, , options]) => entity === DeliveryProject && options !== undefined,
    )
    expect(lockedLoad?.[3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(em.transactional).toHaveBeenCalledTimes(1)
  })

  it('sets the active baseline and emits one event only when both kinds are approved', async () => {
    await decide({ kind: 'requirements' })
    const result = await decide({ kind: 'design' })

    expect(result).toMatchObject({ activeBaselineId: BASELINE_ID, activeBaselineChanged: true })
    expect(store.projects[0].activeBaselineId).toBe(BASELINE_ID)
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledWith(
      'delivery_os.baseline.approved',
      {
        projectId: PROJECT_ID,
        baselineId: BASELINE_ID,
        version: 1,
        contentHash: store.baselines[0].contentHash,
        activeBaselineId: BASELINE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      },
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )

    await decide({ kind: 'design' })
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
  })

  it('clears the active baseline when a later reject voids the approval and emits nothing', async () => {
    await decide({ kind: 'requirements' })
    await decide({ kind: 'design' })
    mockEmitDeliveryOsEvent.mockClear()

    const result = await decide({ kind: 'design', verdict: 'rejected', reason: 'Wrong breakpoint' })
    expect(result).toMatchObject({ activeBaselineId: null, activeBaselineChanged: true })
    expect(store.projects[0].activeBaselineId).toBeNull()
    expect(store.decisions).toHaveLength(3)
    expect(store.decisions[2].reason).toBe('Wrong breakpoint')
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()

    const again = await decide({ kind: 'design' })
    expect(again.activeBaselineId).toBe(BASELINE_ID)
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps another active baseline when this one is rejected', async () => {
    const otherActive = '7c7c7c7c-7777-4777-8777-777777777777'
    store.projects[0].activeBaselineId = otherActive
    const result = await decide({ verdict: 'rejected', reason: 'Scope is incomplete' })
    expect(result).toMatchObject({ activeBaselineId: otherActive, activeBaselineChanged: false })
  })

  it('does not move the project back to an older baseline while a newer one is active', async () => {
    const newerId = '7c7c7c7c-7777-4777-8777-777777777777'
    store.baselines.push(makeBaseline(undefined, { id: newerId, version: 2, contentHash: 'e'.repeat(64) }))
    store.projects[0].activeBaselineId = newerId
    await decide({ kind: 'requirements' })
    const result = await decide({ kind: 'design' })

    expect(result).toMatchObject({ activeBaselineId: newerId, activeBaselineChanged: false })
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('replaces an older active baseline once the newer one has both approvals', async () => {
    const olderId = '7c7c7c7c-7777-4777-8777-777777777777'
    store.baselines[0].version = 2
    store.baselines.push(makeBaseline(undefined, { id: olderId, version: 1, contentHash: 'e'.repeat(64) }))
    store.projects[0].activeBaselineId = olderId
    await decide({ kind: 'requirements' })
    const result = await decide({ kind: 'design' })

    expect(result).toMatchObject({ activeBaselineId: BASELINE_ID, activeBaselineChanged: true })
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
  })

  it('emits the approval event before the index side effects so a failing indexer cannot lose it', async () => {
    await decide({ kind: 'requirements' })
    const { ctx } = makeHarness(store, { headers: headersFor(store.projects[0]) })
    const dataEngine = ctx.container.resolve('dataEngine') as { markOrmEntityChange: jest.Mock }
    dataEngine.markOrmEntityChange.mockImplementation(() => {
      throw new Error('[internal] indexer is down')
    })
    await expect(record.execute(decisionInput({ kind: 'design' }), ctx)).rejects.toThrow('indexer is down')
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
  })

  it('orders decisions strictly so a same-millisecond pair cannot tie', async () => {
    await decide({ kind: 'requirements' })
    await decide({ kind: 'requirements', verdict: 'rejected', reason: 'Changed my mind' })
    await decide({ kind: 'requirements' })
    const times = store.decisions.map((decision) => decision.decidedAt.getTime())
    expect(times[1]).toBeGreaterThan(times[0])
    expect(times[2]).toBeGreaterThan(times[1])
  })

  it('lets the second of two concurrent contradictory writers lose with the platform 409', async () => {
    const sharedHeaders = headersFor(store.projects[0])
    const first = makeHarness(store, { headers: sharedHeaders })
    const second = makeHarness(store, { headers: sharedHeaders })
    await record.execute(decisionInput({ kind: 'design' }), first.ctx)
    const error = await catchHttpError(() =>
      record.execute(decisionInput({ kind: 'design', verdict: 'rejected', reason: 'No' }), second.ctx),
    )
    expect(error.status).toBe(409)
    expect(error.body.code).toBe('optimistic_lock_conflict')
    expect(store.decisions).toHaveLength(1)
  })

  it('answers the platform 409 for a stale project even when the lock is switched off', async () => {
    const previous = process.env.OM_OPTIMISTIC_LOCK
    process.env.OM_OPTIMISTIC_LOCK = 'off'
    try {
      const { ctx } = makeHarness(store, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } })
      const error = await catchHttpError(() => record.execute(decisionInput(), ctx))
      expect(error.status).toBe(409)
      expect(error.body).toMatchObject({ code: 'optimistic_lock_conflict', expectedUpdatedAt: STALE_UPDATED_AT })
    } finally {
      if (previous === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = previous
    }
    expect(store.decisions).toHaveLength(0)
  })

  it('answers 409 subject_hash_mismatch for another hash or version', async () => {
    const hash = await catchHttpError(() => decide({ subjectHash: 'f'.repeat(64) }))
    expectFrozenBody(hash, 409, 'subject_hash_mismatch')
    expect(detailCodes(hash)).toEqual(['subject_hash_mismatch'])

    const version = await catchHttpError(() => decide({ subjectVersion: 2 }))
    expectFrozenBody(version, 409, 'subject_hash_mismatch')
    expect(detailCodes(version)).toEqual(['subject_version_mismatch'])
    expect(store.decisions).toHaveLength(0)
  })

  it('refuses to approve stored content that no longer matches its hash but still allows a reject', async () => {
    store.baselines[0].content = { ...store.baselines[0].content, planSummary: 'tampered' }
    expectFrozenBody(await catchHttpError(() => decide()), 422, 'hash_mismatch')
    const rejected = await decide({ verdict: 'rejected', reason: 'Content was altered' })
    expect(rejected.verdict).toBe('rejected')
  })

  it('answers 422 reason_required for a reject without a reason', async () => {
    expectFrozenBody(await catchHttpError(() => decide({ verdict: 'rejected' })), 422, 'reason_required')
    expectFrozenBody(await catchHttpError(() => decide({ verdict: 'rejected', reason: '   ' })), 422, 'reason_required')
  })

  it('answers a clear 422 for the release kind until R21', async () => {
    const error = await catchHttpError(() => decide({ kind: 'release' }))
    expectFrozenBody(error, 422, 'unsupported_evidence_kind')
    expect(detailCodes(error)).toEqual(['decision_kind_not_supported'])
    expectFrozenBody(await catchHttpError(() => decide({ kind: 'scope' })), 400, 'validation_failed')
  })

  it('requires the lock header and a signed-in user', async () => {
    const noHeader = await catchHttpError(() => record.execute(decisionInput(), makeHarness(store).ctx))
    expectFrozenBody(noHeader, 428, 'optimistic_lock_required')

    const garbage = makeHarness(store, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: 'not-a-date' } })
    const invalid = await catchHttpError(() => record.execute(decisionInput(), garbage.ctx))
    expectFrozenBody(invalid, 400, 'validation_failed')
    expect(detailCodes(invalid)).toEqual(['optimistic_lock_invalid'])
    expect(store.decisions).toHaveLength(0)

    const apiKey = makeHarness(store, { headers: headersFor(store.projects[0]), sub: 'api-key' })
    const noActor = await catchHttpError(() => record.execute(decisionInput(), apiKey.ctx))
    expectFrozenBody(noActor, 403, 'forbidden')
    expect(detailCodes(noActor)).toEqual(['actor_required'])
  })

  it('answers 404 for a baseline of another organization and for an archived project', async () => {
    const foreign = makeHarness(store, { orgId: FOREIGN_ORG_ID, headers: headersFor(store.projects[0]) })
    expectFrozenBody(await catchHttpError(() => record.execute(decisionInput(), foreign.ctx)), 404, 'not_found')

    store.projects[0].deletedAt = new Date()
    expectFrozenBody(await catchHttpError(() => decide()), 404, 'not_found')
    expect(store.decisions).toHaveLength(0)
  })

  it('runs no query after the decision is persisted', async () => {
    const { ctx, em } = makeHarness(store, { headers: headersFor(store.projects[0]) })
    await record.execute(decisionInput(), ctx)
    const lastQuery = Math.max(
      ...mockFindWithDecryption.mock.invocationCallOrder,
      ...mockFindOneWithDecryption.mock.invocationCallOrder,
    )
    expect(lastQuery).toBeLessThan(em.persist.mock.invocationCallOrder[0])
  })

  it('registers no update or delete command for decisions', () => {
    expect(commandRegistry.get('delivery_os.decisions.update')).toBeFalsy()
    expect(commandRegistry.get('delivery_os.decisions.delete')).toBeFalsy()
  })
})

const REVISION: SourceRevision = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const OTHER_REVISION: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }
const RAW_HASH = 'd'.repeat(64)
let evidenceSeq = 0

function evidenceRow(kind: string, payload: unknown, overrides: Row = {}): Row {
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
    ...overrides,
  }
}

function testRow(statuses: { ac001?: string; ac002?: string } = {}): Row {
  const content = store.baselines[0].content as { acTestMap: Record<string, string[]> }
  const check = (testId: string, status: string) => ({
    checkId: 'unit-tests',
    testId,
    status,
    sourceRevision: REVISION,
    acIds: [],
    rawReportHash: RAW_HASH,
  })
  return evidenceRow('test', {
    rawReportHash: RAW_HASH,
    checks: [check(content.acTestMap['AC-001'][0], statuses.ac001 ?? 'passed'), check(content.acTestMap['AC-002'][0], statuses.ac002 ?? 'passed')],
  })
}

function scanRow(status = 'passed'): Row {
  return evidenceRow('scan', { checkId: 'dependency-audit', scanner: 'npm audit', status, rawReportHash: RAW_HASH })
}

function reportQueries() {
  return createDeliveryOsReportQueries(makeHarness(store).em as never)
}

function deployInput(overrides: Row = {}): Row {
  return { kind: 'deploy', projectId: PROJECT_ID, baselineId: BASELINE_ID, sourceRevision: REVISION, verdict: 'approved', ...overrides }
}

function deploy(overrides: Row = {}, options: { headers?: Record<string, string>; orgId?: string } = {}): Promise<DecisionCommandResult> {
  const { ctx } = makeHarness(store, {
    headers: options.headers ?? headersFor(store.projects[0]),
    orgId: options.orgId,
    services: { deliveryOsReportQueries: reportQueries() },
  })
  return Promise.resolve(record.execute(deployInput(overrides), ctx))
}

function blockerPaths(error: Awaited<ReturnType<typeof catchHttpError>>): string[] {
  return (error.body.details as Array<{ path: string; code: string }>).map((detail) => `${detail.path}=${detail.code}`)
}

describe('delivery_os.decisions.record — deploy (publish consent)', () => {
  beforeEach(() => {
    store.projects[0].activeBaselineId = BASELINE_ID
  })

  it('records an approved deploy decision on a green report and the next report applies it to that revision only', async () => {
    evidence.push(testRow(), scanRow())
    const before = store.projects[0].updatedAt
    const result = await deploy()

    expect(result).toMatchObject({ kind: 'deploy', verdict: 'approved', baselineId: BASELINE_ID, activeBaselineChanged: false })
    expect(store.decisions).toHaveLength(1)
    expect(store.decisions[0]).toMatchObject({
      kind: 'deploy',
      subjectType: 'baseline',
      subjectId: BASELINE_ID,
      subjectHash: store.baselines[0].contentHash,
      subjectVersion: 1,
      sourceRevision: REVISION,
      verdict: 'approved',
      actorUserId: ACTOR_ID,
    })
    expect(store.projects[0].updatedAt.getTime()).toBeGreaterThan(before.getTime())
    expect(result.projectUpdatedAt).toBe(store.projects[0].updatedAt.toISOString())
    expect(store.projects[0].activeBaselineId).toBe(BASELINE_ID)
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()

    store.decisions[0].id = result.decisionId
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
    const onRevision = await reportQueries().buildReport(scope, PROJECT_ID, { revision: REVISION })
    expect(onRevision.decisions).toEqual([expect.objectContaining({ kind: 'deploy', appliesToRevision: true })])
    const onOther = await reportQueries().buildReport(scope, PROJECT_ID, { revision: OTHER_REVISION })
    expect(onOther.decisions).toEqual([expect.objectContaining({ kind: 'deploy', appliesToRevision: false })])
  })

  it('refuses an approval with 422 report_not_green naming a failed and a not_run AC', async () => {
    evidence.push(testRow({ ac001: 'failed', ac002: 'skipped' }), scanRow())
    const error = await catchHttpError(() => deploy())
    expectFrozenBody(error, 422, 'report_not_green')
    expect(blockerPaths(error)).toEqual(expect.arrayContaining(['ac:AC-001=failed', 'ac:AC-002=not_run']))
    expect(store.decisions).toHaveLength(0)
  })

  it('refuses an approval when the required scan is missing', async () => {
    evidence.push(testRow())
    const error = await catchHttpError(() => deploy())
    expectFrozenBody(error, 422, 'report_not_green')
    expect(blockerPaths(error)).toEqual(['scan:dependency-audit=missing'])
  })

  it('refuses an approval on a revision without any result and a null revision as invalid input', async () => {
    evidence.push(testRow(), scanRow())
    const error = await catchHttpError(() => deploy({ sourceRevision: OTHER_REVISION }))
    expectFrozenBody(error, 422, 'report_not_green')
    expect(blockerPaths(error)).toEqual(
      expect.arrayContaining(['ac:AC-001=missing', 'ac:AC-002=missing', 'scan:dependency-audit=missing']),
    )
    expectFrozenBody(await catchHttpError(() => deploy({ sourceRevision: null })), 400, 'validation_failed')
    expect(store.decisions).toHaveLength(0)
  })

  it('always allows a reject with a reason, even on a red report, and requires the reason', async () => {
    expectFrozenBody(await catchHttpError(() => deploy({ verdict: 'rejected' })), 422, 'reason_required')
    const result = await deploy({ verdict: 'rejected', reason: 'Preview shows a broken layout' })
    expect(result.verdict).toBe('rejected')
    expect(store.decisions[0]).toMatchObject({ kind: 'deploy', verdict: 'rejected', reason: 'Preview shows a broken layout', sourceRevision: REVISION })
  })

  it('answers 422 baseline_not_active for a baseline that is not the active one', async () => {
    evidence.push(testRow(), scanRow())
    store.projects[0].activeBaselineId = null
    const inactive = await catchHttpError(() => deploy())
    expectFrozenBody(inactive, 422, 'baseline_not_active')
    const reject = await catchHttpError(() => deploy({ verdict: 'rejected', reason: 'No' }))
    expectFrozenBody(reject, 422, 'baseline_not_active')
    store.projects[0].activeBaselineId = '7c7c7c7c-7777-4777-8777-777777777777'
    expectFrozenBody(await catchHttpError(() => deploy()), 422, 'baseline_not_active')
    expect(store.decisions).toHaveLength(0)
  })

  it('answers 422 invalid_revision for a snapshot revision on a git profile', async () => {
    const snapshot = { kind: 'snapshot', contentHash: 'c'.repeat(64), externalWorkspaceId: 'wp:1' }
    const error = await catchHttpError(() => deploy({ sourceRevision: snapshot, verdict: 'rejected', reason: 'x' }))
    expectFrozenBody(error, 422, 'invalid_revision')
    expect(detailCodes(error)).toEqual(['revision_kind_mismatch'])
  })

  it('answers 409 for a stale project version, 428 without the header and 404 for another organization', async () => {
    evidence.push(testRow(), scanRow())
    const stale = await catchHttpError(() => deploy({}, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } }))
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('optimistic_lock_conflict')
    expectFrozenBody(await catchHttpError(() => deploy({}, { headers: {} })), 428, 'optimistic_lock_required')
    expectFrozenBody(await catchHttpError(() => deploy({}, { orgId: FOREIGN_ORG_ID })), 404, 'not_found')
    expect(store.decisions).toHaveLength(0)
  })

  it('keeps every deploy decision append-only and strictly ordered', async () => {
    evidence.push(testRow(), scanRow())
    await deploy()
    await deploy({ verdict: 'rejected', reason: 'Wait for the copy fix' })
    expect(store.decisions.map((decision) => decision.verdict)).toEqual(['approved', 'rejected'])
    expect(store.decisions[1].decidedAt.getTime()).toBeGreaterThan(store.decisions[0].decidedAt.getTime())
  })
})
