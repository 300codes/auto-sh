/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn(async () => []) }))
jest.mock('../reportQueries', () => ({ createDeliveryOsReportQueries: jest.fn() }))
jest.mock('../shared', () => ({ lockScopedProjectTasks: jest.fn(async () => []) }))
jest.mock('../reportContext', () => ({ ...jest.requireActual('../reportContext'), loadReportContext: jest.fn() }))
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DeliveryProject } from '../../data/entities'
import type { DeliveryReportResponse } from '../../lib/reportContracts'
import { assertPublicationGate } from '../publicationGate'
import { loadReportContext, candidateConsentHash } from '../reportContext'
import { createDeliveryOsReportQueries } from '../reportQueries'
import { lockScopedProjectTasks } from '../shared'

const scope = { tenantId: 'tenant', organizationId: 'organization' }
const project = { id: 'project', activeBaselineId: 'baseline' } as DeliveryProject
const revision = { kind: 'git' as const, commitSha: 'a'.repeat(40) }
const em = {} as EntityManager
const candidate = { id: 'candidate', version: 1, projectId: 'project', baselineId: 'baseline', baselineHash: 'b'.repeat(64), sourceRevision: revision, evidenceIds: ['evidence'], createdAt: '2026-09-19T12:00:00.000Z' }
const report = { currentCandidate: candidate, mode: 'legacy', flow: null, baselineId: 'baseline', baselineHash: candidate.baselineHash, gates: { publishable: { ok: true, blocking: [] } } } as unknown as DeliveryReportResponse
const buildReport = jest.fn(async () => report)
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(loadReportContext).mockResolvedValue({ mode: 'legacy', flow: null, currentCandidate: candidate })
  jest.mocked(createDeliveryOsReportQueries).mockReturnValue({ buildReport })
  jest.mocked(findWithDecryption).mockResolvedValue([])
})
it('preserves legacy evidence recording before explicit nomination', async () => {
  jest.mocked(loadReportContext).mockResolvedValue({ mode: 'legacy', flow: null, currentCandidate: null })
  await expect(assertPublicationGate(em, scope, project, 'baseline', revision)).resolves.toBeUndefined()
  expect(buildReport).not.toHaveBeenCalled()
})
it('rejects deployment of a different revision without relying on UI', async () => {
  await expect(assertPublicationGate(em, scope, project, 'baseline', { kind: 'git', commitSha: 'c'.repeat(40) })).rejects.toMatchObject({ status: 409, body: { code: 'candidate_stale' } })
  expect(lockScopedProjectTasks).toHaveBeenCalledWith(em, 'project', scope)
  expect(createDeliveryOsReportQueries).toHaveBeenCalledWith(em, true)
})
it('requires consent bound to the nomination', async () => {
  await expect(assertPublicationGate(em, scope, project, 'baseline', revision)).rejects.toMatchObject({ status: 422, body: { code: 'deploy_decision_missing' } })
})
it('accepts current candidate with current consent under the task lock', async () => {
  jest.mocked(findWithDecryption).mockResolvedValue([{ id: 'decision', kind: 'deploy', verdict: 'approved', releaseCandidateId: 'candidate', releaseCandidateVersion: 1, candidateContextHash: candidateConsentHash(report), decidedAt: new Date() }] as never)
  await expect(assertPublicationGate(em, scope, project, 'baseline', revision)).resolves.toBeUndefined()
})
