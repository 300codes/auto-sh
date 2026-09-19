/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryReleaseCandidate, type DeliveryDecision, type DeliveryProject } from '../../data/entities'
import { assertCurrentCandidateDeployConsent, assertReportDecisionContext, candidateConsentHash, loadReportContext } from '../reportContext'
import { deployDecisionSchema, releaseDecisionSchema } from '../../data/validators'
import type { DeliveryReportResponse, ReleaseCandidate } from '../../lib/reportContracts'

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const candidateId = '33333333-3333-4333-8333-333333333333'
const evidenceId = '44444444-4444-4444-8444-444444444444'
const revision = { kind: 'git' as const, commitSha: 'a'.repeat(40) }
const candidate: ReleaseCandidate = { id: candidateId, projectId, baselineId, baselineHash: 'b'.repeat(64), version: 1, sourceRevision: revision, evidenceIds: [evidenceId], createdAt: '2026-09-19T12:00:00.000Z' }
function report(patch: Partial<DeliveryReportResponse> = {}): DeliveryReportResponse {
  return { mode: 'legacy', flow: null, baselineId, baselineHash: candidate.baselineHash, currentCandidate: candidate, decisionContextHash: 'c'.repeat(64), ...patch } as DeliveryReportResponse
}

describe('explicit release candidate preflight', () => {
  it('keeps legacy deploy and release request shapes valid', () => {
    expect(deployDecisionSchema.safeParse({ baselineId, sourceRevision: revision, verdict: 'approved' }).success).toBe(true)
    expect(releaseDecisionSchema.safeParse({ deploymentEvidenceId: evidenceId, verdict: 'approved' }).success).toBe(true)
    expect(() => assertReportDecisionContext(report({ currentCandidate: null }), {}, revision, true)).not.toThrow()
  })
  it('blocks later task C from replacing nominated B even through a legacy body', () => {
    expect(() => assertReportDecisionContext(report(), {}, { kind: 'git', commitSha: 'f'.repeat(40) }, true)).toThrow()
    expect(() => assertReportDecisionContext(report(), {}, revision, true)).not.toThrow()
  })
  it('rejects stale preflight hashes, candidate versions and baseline changes', () => {
    for (const input of [{ decisionContextHash: 'f'.repeat(64) }, { candidateId: evidenceId }, { candidateVersion: 2 }]) {
      expect(() => assertReportDecisionContext(report(), input, revision, true)).toThrow()
    }
    expect(() => assertReportDecisionContext(report({ baselineId: projectId }), {}, revision, true)).toThrow()
  })
  it('requires nomination and approved flow and returns specific stage blockers', () => {
    expect(() => assertReportDecisionContext(report({ mode: 'flow', currentCandidate: null }), {}, revision, true)).toThrow()
    try {
      assertReportDecisionContext(report({ mode: 'flow', flow: { template: null, stages: [], gate: { ok: false, blocking: [{ kind: 'decision_pending', stageId: 'scope', ref: baselineId }] } } }), {}, revision, true)
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toMatchObject({ status: 422, body: { details: [{ path: 'scope', code: 'decision_pending' }] } })
    }
  })
  it('compares both snapshot identity fields', () => {
    const sourceRevision = { kind: 'snapshot' as const, contentHash: 'e'.repeat(64), externalWorkspaceId: 'site:1' }
    const snapshot = report({ currentCandidate: { ...candidate, sourceRevision } })
    expect(() => assertReportDecisionContext(snapshot, {}, sourceRevision, true)).not.toThrow()
    expect(() => assertReportDecisionContext(snapshot, {}, { ...sourceRevision, externalWorkspaceId: 'site:2' }, true)).toThrow()
  })
  it('requires fresh consent after re-nomination or stage changes while ignoring newly recorded deployment evidence', () => {
    const current = report()
    const decision = { id: evidenceId, kind: 'deploy', verdict: 'approved', releaseCandidateId: candidateId, releaseCandidateVersion: 1, candidateContextHash: candidateConsentHash(current), decidedAt: new Date() } as DeliveryDecision
    expect(() => assertCurrentCandidateDeployConsent(current, [decision])).not.toThrow()
    expect(() => assertCurrentCandidateDeployConsent(report({ decisionContextHash: 'f'.repeat(64) }), [decision])).not.toThrow()
    expect(() => assertCurrentCandidateDeployConsent(report({ currentCandidate: { ...candidate, version: 2 } }), [decision])).toThrow()
    expect(() => assertCurrentCandidateDeployConsent(report({ flow: { template: null, stages: [], gate: { ok: true, blocking: [] } } }), [decision])).toThrow()
    expect(() => assertCurrentCandidateDeployConsent(current, [decision, { ...decision, id: baselineId, verdict: 'rejected', decidedAt: new Date(Date.now() + 1000) }])).toThrow()
  })
  it('reads latest explicit nomination with tenant and organization scope', async () => {
    jest.mocked(findWithDecryption).mockResolvedValueOnce([{ ...candidate, createdAt: new Date(candidate.createdAt) }] as never)
    const scope = { tenantId: candidateId, organizationId: evidenceId }
    const result = await loadReportContext({} as EntityManager, scope, { id: projectId } as DeliveryProject)
    expect(result.currentCandidate).toEqual(candidate)
    expect(findWithDecryption).toHaveBeenCalledWith(expect.anything(), DeliveryReleaseCandidate, { ...scope, projectId }, { orderBy: { version: 'desc' }, limit: 1 }, scope)
  })
  it('fails closed on an incomplete pinned template', async () => {
    jest.mocked(findWithDecryption).mockResolvedValueOnce([])
    await expect(loadReportContext({} as EntityManager, { tenantId: candidateId, organizationId: evidenceId }, { id: projectId, flowTemplateHash: 'd'.repeat(64) } as DeliveryProject)).rejects.toMatchObject({ status: 422 })
  })
})
