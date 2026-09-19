/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { TaskReviewAction } from '../TaskReviewAction'
import { recordEvidenceSchema } from '../../../data/validators'
import type { AcceptedResultSummary } from '../../../lib/resultReadContracts'

const mockApi = jest.fn()
const mockConflict = jest.fn()
let mockForm: {
  entityId: string
  initialValues: Record<string, unknown>
  disableOptimisticLock?: boolean
  onSubmit: (values: Record<string, unknown>) => Promise<void>
}
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApi(...args) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: (...args: unknown[]) => mockConflict(...args) }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: (props: typeof mockForm) => { mockForm = props; return <div data-testid="guarded-review-form" /> } }))

const now = '2026-09-19T12:00:00.000Z'
const next = '2026-09-19T12:01:00.000Z'
const uuid = (last: string) => `11111111-1111-4111-8111-11111111111${last}`
const result: AcceptedResultSummary = {
  projectId: uuid('1'), taskId: uuid('2'), attemptId: uuid('3'), baselineId: uuid('4'), evidenceId: uuid('5'),
  baselineHash: 'a'.repeat(64), sourceRevision: { kind: 'git', commitSha: 'b'.repeat(40) }, source: 'adapter',
  createdAt: now, externalRunId: 'run-1', checks: [], findings: [], changedPaths: [], artifactCount: 0, artifactBytes: null,
  usage: { source: 'runner', values: 'unknown' },
}
const values = { verdict: 'changes_requested', summary: '  Fix the reviewed spacing  ', manualCheckId: '' }
function setup() {
  const onMutated = jest.fn()
  render(<TaskReviewAction result={result} taskUpdatedAt={now} onMutated={onMutated} />)
  fireEvent.click(screen.getByTestId('task-review-open'))
  return onMutated
}
beforeEach(() => { mockApi.mockReset(); mockConflict.mockReset() })

test('delegates guards and the task optimistic version to CrudForm and posts the published review payload', async () => {
  mockApi.mockResolvedValue({ ok: true, status: 201, result: { evidenceId: uuid('6'), duplicate: false, taskStatus: 'changes_requested', taskStatusReason: null, taskUpdatedAt: next } })
  const onMutated = setup()
  expect(mockForm.entityId).toBe('delivery_os.task_review')
  expect(mockForm.initialValues).toMatchObject({ id: result.taskId, updatedAt: now })
  expect(mockForm.disableOptimisticLock).not.toBe(true)
  await act(async () => mockForm.onSubmit(values))
  const [url, options] = mockApi.mock.calls[0]
  expect(url).toBe(`/api/delivery_os/projects/${result.projectId}/evidence`)
  expect(options.method).toBe('POST')
  const payload = recordEvidenceSchema.parse(JSON.parse(options.body))
  expect(payload).toMatchObject({ kind: 'review', baselineId: result.baselineId, taskId: result.taskId, attemptId: result.attemptId,
    sourceRevision: result.sourceRevision, payload: { verdict: 'changes_requested', summary: 'Fix the reviewed spacing', reviewedEvidenceId: result.evidenceId, reviewer: { kind: 'human' } } })
  expect(onMutated).toHaveBeenCalledWith(next)
  expect(screen.queryByTestId('guarded-review-form')).toBeNull()
})

test('records a named manual check without pretending it advanced task state', async () => {
  mockApi.mockResolvedValue({ ok: true, status: 201, result: { evidenceId: uuid('6'), duplicate: false } })
  const onMutated = setup()
  await act(async () => mockForm.onSubmit({ ...values, verdict: 'approved', manualCheckId: ' check-1 ' }))
  expect(recordEvidenceSchema.parse(JSON.parse(mockApi.mock.calls[0][1].body))).toMatchObject({ payload: { manualCheckId: 'check-1', verdict: 'approved' } })
  expect(onMutated).toHaveBeenCalledWith(now)
})

test.each([409, 422, 500])('keeps review open and never announces success after HTTP %s', async (status) => {
  mockApi.mockResolvedValue({ ok: false, status, result: { code: status === 409 ? 'optimistic_lock_conflict' : 'missing_required_tests', details: [] } })
  mockConflict.mockReturnValue(status === 409)
  const onMutated = setup()
  await act(async () => { await expect(mockForm.onSubmit(values)).rejects.toBeDefined() })
  expect(mockConflict).toHaveBeenCalledWith(expect.objectContaining({ status }), expect.any(Function))
  expect(onMutated).not.toHaveBeenCalled()
  expect(screen.getByTestId('guarded-review-form')).toBeTruthy()
})

test('does not send a blank review or accept an unreadable success response', async () => {
  const onMutated = setup()
  await act(async () => { await expect(mockForm.onSubmit({ ...values, summary: ' ' })).rejects.toBeDefined() })
  expect(mockApi).not.toHaveBeenCalled()
  mockApi.mockResolvedValue({ ok: true, status: 200, result: {} })
  await act(async () => { await expect(mockForm.onSubmit(values)).rejects.toBeDefined() })
  expect(onMutated).not.toHaveBeenCalled()
  expect(screen.getByTestId('guarded-review-form')).toBeTruthy()
})


test('refuses a final-review response that omits the task version', async () => {
  mockApi.mockResolvedValue({ ok: true, status: 201, result: { evidenceId: uuid('6'), duplicate: false } })
  const onMutated = setup()
  await act(async () => { await expect(mockForm.onSubmit(values)).rejects.toBeDefined() })
  expect(onMutated).not.toHaveBeenCalled()
  expect(screen.getByTestId('guarded-review-form')).toBeTruthy()
})
