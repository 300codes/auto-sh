/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { projectDetailSchema } from '../../../api/schemas'
import { DEFAULT_DELIVERY_LIMITS, deliveryReportV1Schema } from '../../../lib/contracts'
import fixture from '../../../lib/fixtures/delivery-report.v1.json'
import { useDeliveryReport } from '../useDeliveryReport'

const mockApiCall = jest.fn()
let mockScope = 0
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApiCall(...args) }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => mockScope }))

const projectId = fixture.projectId
const otherProjectId = '99999999-9999-4999-8999-999999999999'
const project = projectDetailSchema.parse({
  id: projectId, name: 'Test project', inputMode: 'brief', brief: null,
  targetProfileId: fixture.targetProfile.id, targetProfileVersion: fixture.targetProfile.version,
  repositoryRef: null, activeBaselineId: fixture.baselineId, createdAt: null,
  updatedAt: '2026-09-19T10:00:00.000Z', archivedAt: null, draftSpec: {},
  limits: DEFAULT_DELIVERY_LIMITS, status: 'in_progress', progress: fixture.progress,
  taskCounts: {}, attention: { blockedTaskIds: [], reconciliationRequiredTaskIds: [] },
})

function report() {
  const value = deliveryReportV1Schema.parse(fixture)
  value.decisions = [{ ...value.decisions[1], sourceRevision: value.revision, appliesToRevision: true }]
  return value
}
function response(result: unknown, status = 200) { return { ok: status < 400, status, result } }
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void
  const promise = new Promise<ReturnType<typeof response>>((finish) => { resolve = finish })
  return { promise, resolve }
}
async function flush() { await act(async () => { await Promise.resolve() }) }
async function advance(time: number) { await act(async () => { jest.advanceTimersByTime(time) }) }
function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

beforeEach(() => {
  jest.useFakeTimers()
  mockScope = 0
  mockApiCall.mockReset()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  mockApiCall.mockImplementation((url: string) => Promise.resolve(response(url.includes('/report?') ? report() : project)))
})
afterEach(() => { jest.useRealTimers() })

describe('useDeliveryReport', () => {
  it('waits five seconds after a successful read, stops after verified deployment, and cleans up', async () => {
    const { result, unmount } = renderHook(() => useDeliveryReport(projectId, ''))
    await flush()
    expect(result.current.state.status).toBe('ready')
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    await advance(4999)
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    const verified = report()
    verified.deployment.status = 'verified'
    verified.deployment.verificationStatus = 'verified'
    mockApiCall.mockImplementation((url: string) => Promise.resolve(response(url.includes('/report?') ? verified : project)))
    await advance(1)
    expect(mockApiCall).toHaveBeenCalledTimes(4)
    await advance(60000)
    expect(mockApiCall).toHaveBeenCalledTimes(4)
    unmount()
    visibility('visible')
    await advance(60000)
    expect(mockApiCall).toHaveBeenCalledTimes(4)
  })

  it('stops polling after later deploy rejection', async () => {
    const { result } = renderHook(() => useDeliveryReport(projectId, ''))
    await flush()
    const rejected = report()
    rejected.decisions.push({ ...rejected.decisions[0], id: '88888888-8888-4888-8888-888888888889', verdict: 'rejected', decidedAt: '2026-09-20T10:00:00.000Z' })
    mockApiCall.mockImplementation((url: string) => Promise.resolve(response(url.includes('/report?') ? rejected : project)))
    await advance(5000)
    expect(result.current.state.snapshot?.report.decisions).toHaveLength(2)
    await advance(60000)
    expect(mockApiCall).toHaveBeenCalledTimes(4)
  })

  it('cancels an active polling timer on unmount and ignores a pending unmounted request', async () => {
    const first = renderHook(() => useDeliveryReport(projectId, ''))
    await flush()
    first.unmount()
    await advance(60000)
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    const pending = deferred()
    mockApiCall.mockReturnValueOnce(pending.promise)
    const second = renderHook(() => useDeliveryReport(projectId, ''))
    second.unmount()
    await act(async () => { pending.resolve(response(project)) })
    visibility('visible')
    await advance(60000)
    expect(mockApiCall).toHaveBeenCalledTimes(3)
  })

  it('coalesces refresh requests and never overlaps pending reads', async () => {
    const pending = deferred()
    mockApiCall.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useDeliveryReport(projectId, ''))
    act(() => { void result.current.refresh(); void result.current.refresh() })
    await advance(20000)
    expect(mockApiCall).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(response(project)) })
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    await advance(5000)
    expect(mockApiCall).toHaveBeenCalledTimes(4)
  })

  it('ignores a hidden late response and refetches immediately when visible', async () => {
    const pending = deferred()
    mockApiCall.mockResolvedValueOnce(response(project)).mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useDeliveryReport(projectId, ''))
    await flush()
    visibility('hidden')
    await act(async () => { pending.resolve(response(report())) })
    expect(result.current.state.snapshot).toBeNull()
    await advance(60000)
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    visibility('visible')
    await flush()
    expect(mockApiCall).toHaveBeenCalledTimes(4)
    expect(result.current.state.snapshot?.report.projectId).toBe(projectId)
  })

  it('waits for an invisible in-flight read to settle before restarting on visibility', async () => {
    const pending = deferred()
    mockApiCall.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useDeliveryReport(projectId, ''))
    visibility('hidden')
    visibility('visible')
    expect(mockApiCall).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(response(project)) })
    expect(mockApiCall).toHaveBeenCalledTimes(3)
    expect(result.current.state.status).toBe('ready')
  })

  it('clears scope-sensitive data immediately and ignores the previous scope response', async () => {
    const pending = deferred()
    const { result, rerender } = renderHook(() => useDeliveryReport(projectId, ''))
    await flush()
    mockApiCall.mockResolvedValueOnce(response(project)).mockReturnValueOnce(pending.promise)
    act(() => { void result.current.refresh() })
    await flush()
    mockScope = 1
    mockApiCall.mockReturnValueOnce(new Promise(() => {}))
    rerender()
    expect(result.current.state.snapshot).toBeNull()
    await act(async () => { pending.resolve(response(report())) })
    expect(result.current.state.snapshot).toBeNull()
  })

  it('ignores a previous project response after navigation', async () => {
    const pending = deferred()
    mockApiCall.mockReturnValueOnce(pending.promise)
    const { result, rerender } = renderHook(({ id }) => useDeliveryReport(id, ''), { initialProps: { id: projectId } })
    mockApiCall.mockReturnValueOnce(new Promise(() => {}))
    rerender({ id: otherProjectId })
    await act(async () => { pending.resolve(response(project)) })
    expect(result.current.state.snapshot).toBeNull()
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403, 404])('clears the last report and terminates retries on HTTP %s', async (status) => {
    const { result } = renderHook(() => useDeliveryReport(projectId, ''))
    await flush()
    mockApiCall.mockResolvedValueOnce(response({}, status))
    await advance(5000)
    expect(result.current.state.snapshot).toBeNull()
    expect(result.current.state.status).toBe(status === 404 ? 'notFound' : 'forbidden')
    visibility('hidden')
    visibility('visible')
    await advance(120000)
    expect(mockApiCall).toHaveBeenCalledTimes(3)
  })

  it('retains a stale report with 10/20/40/60-second backoff and resets it on success', async () => {
    const { result } = renderHook(() => useDeliveryReport(projectId, ''))
    await flush()
    mockApiCall.mockResolvedValue(response({}, 503))
    await advance(5000)
    expect(result.current.state.stale).toBe(true)
    expect(result.current.state.snapshot).not.toBeNull()
    for (const delay of [10000, 20000, 40000, 60000]) {
      const count = mockApiCall.mock.calls.length
      await advance(delay - 1)
      expect(mockApiCall).toHaveBeenCalledTimes(count)
      await advance(1)
      expect(mockApiCall).toHaveBeenCalledTimes(count + 1)
    }
    mockApiCall.mockImplementation((url: string) => Promise.resolve(response(url.includes('/report?') ? report() : project)))
    await advance(60000)
    expect(result.current.state.stale).toBe(false)
    mockApiCall.mockResolvedValue(response({}, 503))
    await advance(5000)
    const count = mockApiCall.mock.calls.length
    await advance(10000)
    expect(mockApiCall).toHaveBeenCalledTimes(count + 1)
  })

  it('pins history exactly and does not poll or fall back from a historical 404', async () => {
    const history = new URLSearchParams({ baselineId: fixture.baselineId, revision: `git:${fixture.revision.commitSha}` }).toString()
    const { result } = renderHook(() => useDeliveryReport(projectId, history))
    await flush()
    expect(result.current.historical).toBe(true)
    expect(mockApiCall.mock.calls[1][0]).toContain(`revision=git%3A${fixture.revision.commitSha}`)
    await advance(60000)
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    mockApiCall.mockResolvedValueOnce(response(project)).mockResolvedValueOnce(response({}, 404))
    await act(async () => { await result.current.refresh() })
    expect(result.current.state.status).toBe('notFound')
    expect(result.current.state.snapshot).toBeNull()
    expect(mockApiCall).toHaveBeenCalledTimes(4)
  })

  it('rejects an incomplete history link without reading current data', async () => {
    const { result } = renderHook(() => useDeliveryReport(projectId, `baselineId=${fixture.baselineId}`))
    await flush()
    expect(result.current.state.status).toBe('invalid')
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('requires historical snapshot workspace identity to match the response', async () => {
    const snapshot = report()
    snapshot.revision = { kind: 'snapshot', contentHash: 'a'.repeat(64), externalWorkspaceId: 'workspace:other' }
    const history = new URLSearchParams({ baselineId: fixture.baselineId, revision: `snapshot:${'a'.repeat(64)}:workspace:expected` }).toString()
    mockApiCall.mockResolvedValueOnce(response(project)).mockResolvedValueOnce(response(snapshot))
    const { result } = renderHook(() => useDeliveryReport(projectId, history))
    await flush()
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.snapshot).toBeNull()
    expect(mockApiCall.mock.calls[1][0]).toContain('workspace%3Aexpected')
  })

  it('reports no baseline separately without requesting a report', async () => {
    mockApiCall.mockResolvedValueOnce(response({ ...project, activeBaselineId: null }))
    const { result } = renderHook(() => useDeliveryReport(projectId, ''))
    await flush()
    expect(result.current.state.status).toBe('noBaseline')
    expect(mockApiCall).toHaveBeenCalledTimes(1)
    await advance(60000)
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })
})
