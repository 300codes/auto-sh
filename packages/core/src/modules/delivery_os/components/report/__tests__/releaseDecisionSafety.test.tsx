/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { projectDetailSchema } from '../../../api/schemas'
import { DEFAULT_DELIVERY_LIMITS } from '../../../lib/contracts'
import { deliveryReportResponseSchema } from '../../../lib/reportContracts'
import fixture from '../../../lib/fixtures/delivery-report.v1.json'
import { decisionBlocker, decisionFingerprint } from '../decisionInput'
import { useReleaseDecision } from '../useReleaseDecision'
import type { ReportSnapshot } from '../useDeliveryReport'

const mockApi = jest.fn()
let mockRetry: (() => Promise<unknown>) | undefined
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApi(...args), withScopedApiRequestHeaders: (_headers: unknown, operation: () => Promise<unknown>) => operation() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({ useGuardedMutation: () => ({
  runMutation: ({ operation }: { operation: () => Promise<unknown> }) => { mockRetry = operation; return operation() },
  retryLastMutation: async () => { try { await mockRetry?.(); return true } catch { return false } },
}) }))

function snapshot(): ReportSnapshot {
  const project = projectDetailSchema.parse({ id: fixture.projectId, name: 'Project', inputMode: 'brief', brief: null,
    targetProfileId: fixture.targetProfile.id, targetProfileVersion: fixture.targetProfile.version, repositoryRef: null,
    activeBaselineId: fixture.baselineId, createdAt: null, updatedAt: '2026-09-19T10:00:00.000Z', archivedAt: null,
    draftSpec: {}, limits: DEFAULT_DELIVERY_LIMITS, status: 'in_progress', progress: fixture.progress, taskCounts: {},
    attention: { blockedTaskIds: [], reconciliationRequiredTaskIds: [] } })
  const report = deliveryReportResponseSchema.parse({ ...fixture, mode: 'legacy', flow: null,
    candidateDecisions: { deployDecisionId: null, releaseDecisionId: null },
    projectUpdatedAt: project.updatedAt, decisionContextHash: 'a'.repeat(64),
    currentCandidate: { id: '22222222-2222-4222-8222-222222222222', version: 1, projectId: project.id,
      baselineId: fixture.baselineId, baselineHash: fixture.baselineHash, sourceRevision: fixture.revision,
      evidenceIds: ['33333333-3333-4333-8333-333333333333'], createdAt: project.updatedAt },
    gates: { publishable: { ok: true, blocking: [] }, releasable: { ok: true, blocking: [] } } })
  return { project, report, readAt: project.updatedAt! }
}
beforeEach(() => { mockApi.mockReset(); mockRetry = undefined })

it('requires a nominated matching candidate and flow gate, even with green v1', () => {
  const value = snapshot()
  expect(decisionBlocker(value, 'deploy', 'approved')).toBeNull()
  value.report.currentCandidate = null
  expect(decisionBlocker(value, 'deploy', 'approved')).toBe('candidateRequired')
  value.report.currentCandidate = snapshot().report.currentCandidate
  value.report.mode = 'flow'
  expect(decisionBlocker(value, 'deploy', 'approved')).toBe('flowBlocked')
  value.project.status = 'archived'
  expect(decisionBlocker(value, 'deploy', 'rejected')).toBe('readonly')
})

it('fingerprints evidence changes even without a project version change', () => {
  const before = snapshot()
  const after = snapshot()
  after.report.decisionContextHash = 'b'.repeat(64)
  expect(after.project.updatedAt).toBe(before.project.updatedAt)
  expect(decisionFingerprint(after)).not.toBe(decisionFingerprint(before))
})

it('blocks stale submit and injected retry until explicit review', async () => {
  const original = snapshot()
  const fresh = snapshot()
  fresh.report.decisionContextHash = 'b'.repeat(64)
  const refresh = jest.fn().mockResolvedValue(fresh)
  const { result } = renderHook(() => useReleaseDecision({ snapshot: original, kind: 'deploy', verdict: 'approved', refresh, onSaved: jest.fn() }))
  await act(async () => { await result.current.submit('') })
  expect(result.current.problem).toBe('contextChanged')
  expect(mockApi).not.toHaveBeenCalled()
  await act(async () => { await mockRetry?.().catch(() => undefined) })
  expect(mockApi).not.toHaveBeenCalled()
})

it('refreshes history after ambiguous POST and prevents replay, including injected retry', async () => {
  const value = snapshot()
  const refresh = jest.fn().mockResolvedValue(value)
  mockApi.mockRejectedValue(new Error('network'))
  const { result } = renderHook(() => useReleaseDecision({ snapshot: value, kind: 'deploy', verdict: 'approved', refresh, onSaved: jest.fn() }))
  await act(async () => { await result.current.submit(''); await result.current.submit('') })
  await act(async () => { await mockRetry?.().catch(() => undefined) })
  expect(mockApi).toHaveBeenCalledTimes(1)
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(result.current.problem).toBe('ambiguous')
  expect(result.current.locked).toBe(true)
})

it('requires rejection reason and sends candidate plus fingerprint only to decision endpoint', async () => {
  const value = snapshot()
  const refresh = jest.fn().mockResolvedValue(value)
  const onSaved = jest.fn()
  mockApi.mockResolvedValue({ ok: true, status: 201, result: { decisionId: '44444444-4444-4444-8444-444444444444', projectUpdatedAt: '2026-09-19T11:00:00.000Z' } })
  const { result } = renderHook(() => useReleaseDecision({ snapshot: value, kind: 'deploy', verdict: 'rejected', refresh, onSaved }))
  await act(async () => { await result.current.submit(' ') })
  expect(mockApi).not.toHaveBeenCalled()
  await act(async () => { await result.current.submit('Please correct evidence') })
  expect(mockApi.mock.calls[0][0]).toMatch(/\/deploy-decisions$/)
  expect(JSON.parse(mockApi.mock.calls[0][1].body)).toMatchObject({ verdict: 'rejected', candidateId: value.report.currentCandidate!.id, decisionContextHash: value.report.decisionContextHash })
  expect(onSaved).toHaveBeenCalledTimes(1)
})

it.each([
  [409, 'contextChanged', true],
  [422, 'serverBlocked', false],
  [428, 'lockRequired', false],
])('handles %i without reporting success', async (status, problem, locked) => {
  const value = snapshot()
  const onSaved = jest.fn()
  mockApi.mockResolvedValue({ ok: false, status, result: { code: 'decision_context_stale', details: [{ path: 'test:T1', code: 'failed' }] } })
  const { result } = renderHook(() => useReleaseDecision({ snapshot: value, kind: 'deploy', verdict: 'approved', refresh: async () => value, onSaved }))
  await act(async () => { await result.current.submit('') })
  expect(result.current.problem).toBe(problem)
  expect(result.current.locked).toBe(locked)
  expect(onSaved).not.toHaveBeenCalled()
})

it('requires a verified deployment for approval but permits reasoned rejection', () => {
  const value = snapshot()
  value.report.deployment.evidenceId = '33333333-3333-4333-8333-333333333333'
  value.report.deployment.status = 'unverified'
  expect(decisionBlocker(value, 'release', 'approved')).toBe('deploymentRequired')
  expect(decisionBlocker(value, 'release', 'rejected')).toBeNull()
  value.report.deployment.status = 'verified'
  expect(decisionBlocker(value, 'release', 'approved')).toBe('gateBlocked')
})

it('rejects a changed candidate revision even if the preview is green', () => {
  const value = snapshot()
  value.report.revision = { kind: 'git', commitSha: 'c'.repeat(40) }
  expect(decisionBlocker(value, 'deploy', 'approved')).toBe('candidateRequired')
})

it('prevents a pending preflight from writing after scope unmount', async () => {
  const value = snapshot()
  let resolve!: (snapshot: ReportSnapshot) => void
  const refresh = () => new Promise<ReportSnapshot>((done) => { resolve = done })
  const { result, unmount } = renderHook(() => useReleaseDecision({ snapshot: value, kind: 'deploy', verdict: 'approved', refresh, onSaved: jest.fn() }))
  let submission!: Promise<void>
  act(() => { submission = result.current.submit('') })
  unmount()
  await act(async () => { resolve(value); await submission })
  expect(mockApi).not.toHaveBeenCalled()
})
