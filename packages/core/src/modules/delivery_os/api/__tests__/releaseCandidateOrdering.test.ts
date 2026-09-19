/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('./routeTestKit').findMock)

import type { EntityManager } from '@mikro-orm/postgresql'
import type { DeliveryProject } from '../../data/entities'
import { loadReportContext } from '../../commands/reportContext'
import { BASELINE_ID, ORG_ID, PROJECT_ID, TENANT_ID } from '../../commands/__tests__/baselineTestKit'
import { em, resetRouteState, routeState } from './routeTestKit'

beforeEach(resetRouteState)

it('selects the newest scoped candidate when two nominations are stored in creation order', async () => {
  const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
  const candidate = {
    ...scope, projectId: PROJECT_ID, baselineId: BASELINE_ID, baselineHash: 'a'.repeat(64),
    sourceRevision: { kind: 'git', commitSha: 'b'.repeat(40) },
    evidenceIds: ['11111111-1111-4111-8111-111111111111'], createdAt: new Date('2026-09-19T12:00:00.000Z'),
  }
  routeState.store.candidates.push(
    { ...candidate, id: '22222222-2222-4222-8222-222222222222', version: 1 },
    { ...candidate, id: '33333333-3333-4333-8333-333333333333', version: 2 },
    { ...candidate, id: '44444444-4444-4444-8444-444444444444', version: 3, organizationId: '55555555-5555-4555-8555-555555555555' },
  )
  const report = await loadReportContext(em as unknown as EntityManager, scope, { id: PROJECT_ID } as DeliveryProject)
  expect(report.currentCandidate).toMatchObject({ id: '33333333-3333-4333-8333-333333333333', version: 2 })
})
