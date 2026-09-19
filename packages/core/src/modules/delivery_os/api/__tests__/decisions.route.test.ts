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
import '@open-mercato/core/modules/delivery_os/commands'
import { POST, metadata, openApi } from '../baselines/[id]/decisions/route'
import {
  BASELINE_ID,
  FOREIGN_ORG_ID,
  STALE_UPDATED_AT,
  UPDATED_AT,
  makeBaseline,
  makeProject,
  type Row,
} from '../../commands/__tests__/baselineTestKit'
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

const path = `/baselines/${BASELINE_ID}/decisions`

function decisionBody(overrides: Row = {}): Row {
  const [baseline] = routeState.store.baselines
  return {
    kind: 'requirements',
    verdict: 'approved',
    subjectHash: baseline.contentHash,
    subjectVersion: baseline.version,
    ...overrides,
  }
}

function decide(overrides: Row = {}, lock: string | Date | null = UPDATED_AT): Promise<Response> {
  return POST(apiRequest('POST', path, { body: decisionBody(overrides), lock }), routeParams(BASELINE_ID))
}

beforeEach(() => {
  resetRouteState()
  routeState.store.projects.push(makeProject() as unknown as Row)
  routeState.store.baselines.push(makeBaseline() as unknown as Row)
})

describe('delivery_os baseline decisions route', () => {
  it('lets only baselines.approve through the declarative guard', () => {
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.projects.manage'])).toBe(false)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.baselines.approve'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ALL_FEATURES)).toBe(true)
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    expect((await decide()).status).toBe(401)
    expect(routeState.store.decisions).toHaveLength(0)
  })

  it('records a decision: 201 { decisionId, activeBaselineId, projectUpdatedAt }', async () => {
    const response = await decide()
    const body = await readBody(response)
    expect(response.status).toBe(201)
    expect(Object.keys(body).sort()).toEqual(['activeBaselineId', 'decisionId', 'projectUpdatedAt'])
    expect(body.activeBaselineId).toBeNull()
    expect(routeState.store.decisions).toHaveLength(1)
  })

  it('activates the baseline once requirements and design are approved', async () => {
    const first = await readBody(await decide())
    const project = routeState.store.projects[0]
    const second = await decide({ kind: 'design' }, String(first.projectUpdatedAt ?? (project.updatedAt as Date).toISOString()))
    expect(second.status).toBe(201)
    expect((await readBody(second)).activeBaselineId).toBe(BASELINE_ID)
    expect(project.activeBaselineId).toBe(BASELINE_ID)
  })

  it('answers 428 without the project version and the platform 409 for a stale one', async () => {
    await expectFrozenError(await decide({}, null), 428, 'optimistic_lock_required')
    const stale = await decide({}, STALE_UPDATED_AT)
    expect(stale.status).toBe(409)
    expect((await readBody(stale)).code).toBe('optimistic_lock_conflict')
    expect(routeState.store.decisions).toHaveLength(0)
  })

  it('answers 409 subject_hash_mismatch, 422 reason_required and 400 for a malformed body', async () => {
    const mismatch = await expectFrozenError(await decide({ subjectHash: 'a'.repeat(64) }), 409, 'subject_hash_mismatch')
    expect(detailCodesOf(mismatch)).toContain('subject_hash_mismatch')
    await expectFrozenError(await decide({ verdict: 'rejected' }), 422, 'reason_required')
    await expectFrozenError(await decide({ kind: 'vibes' }), 400, 'validation_failed')
    expect(routeState.store.decisions).toHaveLength(0)
  })

  it('answers 404 for a second tenant, a second organization and a malformed id', async () => {
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await decide(), 404, 'not_found')
    }
    signInAs({})
    const malformed = await POST(apiRequest('POST', path, { body: decisionBody(), lock: UPDATED_AT }), routeParams('nope'))
    await expectFrozenError(malformed, 404, 'not_found')
  })
})
