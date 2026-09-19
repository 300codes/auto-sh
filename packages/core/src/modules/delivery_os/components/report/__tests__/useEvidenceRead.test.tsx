/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useEvidenceDetail, useEvidenceList } from '../useEvidenceRead'
const mockApiCall = jest.fn()
let mockScope = 0
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApiCall(...args) }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => mockScope }))
const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const evidenceId = '33333333-3333-4333-8333-333333333333'
const detail = { schemaVersion: 'delivery-evidence-read.v1', id: evidenceId, projectId, baselineId, taskId: null, attemptId: null, kind: 'review', source: 'manual', sourceRevision: null, rawReportHash: null, createdAt: '2026-09-19T10:00:00.000Z', payload: { verdict: 'approved' }, attachments: [], attachmentsTruncated: false }
async function flush() { await act(async () => { await Promise.resolve() }) }
beforeEach(() => { mockApiCall.mockReset(); mockScope = 0 })
it('clears old organization data synchronously and ignores a late response', async () => {
  let resolve!: (value: unknown) => void
  mockApiCall.mockImplementationOnce(() => new Promise((finish) => { resolve = finish })).mockResolvedValue({ ok: true, result: detail })
  const hook = renderHook(() => useEvidenceDetail(projectId, evidenceId))
  mockScope = 1; hook.rerender(); expect(hook.result.current.data).toBeNull()
  await flush(); expect(hook.result.current.data).toEqual(detail)
  await act(async () => resolve({ ok: false, status: 404 }))
  expect(hook.result.current.status).toBe('ready')
})
it('rejects mismatched project responses', async () => {
  mockApiCall.mockResolvedValue({ ok: true, result: { ...detail, projectId: baselineId } })
  const hook = renderHook(() => useEvidenceDetail(projectId, evidenceId)); await flush()
  expect(hook.result.current.status).toBe('error'); expect(hook.result.current.data).toBeNull()
})
it.each([[404, 'notFound'], [403, 'forbidden'], [500, 'error']])('distinguishes HTTP %s from empty evidence', async (status, expected) => {
  mockApiCall.mockResolvedValue({ ok: false, status })
  const hook = renderHook(() => useEvidenceList(projectId, baselineId, null, 'baseline', 0)); await flush()
  expect(hook.result.current.status).toBe(expected)
})
it('accepts an explicit empty revisionless group', async () => {
  mockApiCall.mockResolvedValue({ ok: true, result: { schemaVersion: 'delivery-evidence-read.v1', group: 'baseline', items: [], nextOffset: null } })
  const hook = renderHook(() => useEvidenceList(projectId, baselineId, null, 'baseline', 0)); await flush()
  expect(hook.result.current.status).toBe('ready'); expect(hook.result.current.data?.items).toEqual([])
})
