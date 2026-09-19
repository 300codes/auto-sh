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
import { DeliveryProject } from '../../data/entities'
import type { DecisionCommandResult } from '../decisions'
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
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(store, entity).find((row) => matches(row, where)) ?? null,
  )
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(store, entity).filter((row) => matches(row, where)),
  )
  store = { ...emptyStore(), projects: [makeProject()], baselines: [makeBaseline()] }
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

  it('answers a clear 422 for deploy and release kinds until OSS-05', async () => {
    for (const kind of ['deploy', 'release']) {
      const error = await catchHttpError(() => decide({ kind }))
      expectFrozenBody(error, 422, 'unsupported_evidence_kind')
      expect(detailCodes(error)).toEqual(['decision_kind_not_supported'])
    }
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
