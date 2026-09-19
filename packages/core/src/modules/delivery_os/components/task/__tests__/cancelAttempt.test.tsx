/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import englishMessages from '@open-mercato/core/modules/delivery_os/i18n/en.json'
import { loadAttemptRegisterFixture } from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import { CancelAttemptAction } from '../CancelAttemptAction'
import { TaskExecutionPanel } from '../TaskExecutionPanel'
import { readAttemptRegister } from '../attemptRegister'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const apiCallMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))
const flashMock = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))

const messages = englishMessages as Record<string, string>
const taskId = '33333333-3333-4333-8333-333333333333'
const now = '2026-09-19T10:00:00.000Z'
const stopUnconfirmed = loadAttemptRegisterFixture('stop-unconfirmed')
const active = loadAttemptRegisterFixture('active')

function cancelResponse() {
  return {
    ok: true,
    status: 200,
    result: {
      attemptId: active.executionAttempts[0].attemptId,
      state: 'cancel_requested',
      stopConfirmation: 'stop_unconfirmed',
      taskStatus: 'executing',
      taskUpdatedAt: '2026-09-19T12:00:00.000Z',
    },
  }
}

function refusal(code: string) {
  return { ok: false, status: 409, result: { error: 'refused', code, details: [] } }
}

function renderAction() {
  const onRequested = jest.fn()
  render(
    <CancelAttemptAction
      taskId={taskId}
      attemptId={active.executionAttempts[0].attemptId}
      attemptNumber={1}
      taskUpdatedAt={now}
      onRequested={onRequested}
    />,
  )
  return onRequested
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
})

describe('CancelAttemptAction', () => {
  it('reports a requested stop that is NOT confirmed, never a completed cancellation', async () => {
    apiCallMock.mockResolvedValue(cancelResponse())
    const onRequested = renderAction()
    fireEvent.click(screen.getByTestId('cancel-attempt-submit'))
    await screen.findByTestId('cancel-attempt-stop-unconfirmed')
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.task.cancel.requested')
    expect(onRequested).toHaveBeenCalledWith('2026-09-19T12:00:00.000Z')
  })

  it('keeps the English copy saying the stop is not confirmed and points at reconciliation', () => {
    const copy = messages['delivery_os.task.cancel.stopUnconfirmed']
    expect(copy).toContain('NOT confirmed')
    expect(copy).toContain('Reconcile it')
    expect(messages['delivery_os.task.cancel.requested']).toContain('NOT confirmed')
    expect(copy.toLowerCase()).not.toContain('was cancelled')
  })

  it.each([
    ['attempt_not_active', 'delivery_os.task.cancel.error.attemptNotActive'],
    ['attempt_closed', 'delivery_os.task.cancel.error.attemptClosed'],
  ])('keeps %s apart from the other refusal', async (code, key) => {
    apiCallMock.mockResolvedValue(refusal(code))
    renderAction()
    fireEvent.click(screen.getByTestId('cancel-attempt-submit'))
    expect((await screen.findByTestId('cancel-attempt-problem')).textContent).toBe(key)
    expect(screen.queryByTestId('cancel-attempt-stop-unconfirmed')).toBeNull()
  })

  it('sends the optional reason only when one was written', async () => {
    apiCallMock.mockResolvedValue(cancelResponse())
    renderAction()
    fireEvent.click(screen.getByTestId('cancel-attempt-submit'))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(JSON.parse((apiCallMock.mock.calls[0][1] as { body: string }).body)).toEqual({})

    apiCallMock.mockClear()
    fireEvent.change(screen.getByTestId('cancel-attempt-reason'), { target: { value: 'The session host went away.' } })
    fireEvent.click(screen.getByTestId('cancel-attempt-submit'))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(JSON.parse((apiCallMock.mock.calls[0][1] as { body: string }).body))
      .toEqual({ reason: 'The session host went away.' })
  })
})

describe('TaskExecutionPanel — the stop does not open the reconciliation', () => {
  const task = {
    id: taskId,
    projectId: '11111111-1111-4111-8111-111111111111',
    baselineId: '44444444-4444-4444-8444-444444444444',
    title: 'Build the request form',
    description: null,
    acIds: ['AC-1'],
    dependsOnTaskIds: [],
    allowedPaths: [],
    targetProfileId: 'react-vite',
    targetProfileVersion: 1,
    status: 'executing' as const,
    statusReason: null,
    attemptNumber: 1,
    executionAttempts: active.executionAttempts,
    attemptRegisterReadable: true,
    proposalTaskKey: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }

  function renderPanel(canReconcile = true) {
    render(
      <TaskExecutionPanel
        task={task}
        register={readAttemptRegister({ executionAttempts: active.executionAttempts, attemptRegisterReadable: true })}
        taskVersion={now}
        canManageAttempts
        canReconcile={canReconcile}
        canImportResults={false}
        onMutated={jest.fn()}
      />,
    )
  }

  it('leaves the reconciliation dialog closed after a stop request — the operator usually cannot state the outcome yet', async () => {
    apiCallMock.mockResolvedValue(cancelResponse())
    renderPanel()
    expect(screen.queryByTestId('reconcile-attempt-dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('cancel-attempt-submit'))
    await screen.findByTestId('cancel-attempt-stop-unconfirmed')
    expect(screen.queryByTestId('reconcile-attempt-dialog')).toBeNull()
  })

  it('exposes reconciliation as the way to close the attempt, on the row that owns it', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId(`reconcile-open-${active.executionAttempts[0].attemptId}`))
    expect(screen.getByTestId('reconcile-attempt-dialog')).toBeTruthy()
  })

  it('hides the reconciliation entirely without delivery_os.attempts.reconcile', () => {
    renderPanel(false)
    expect(screen.queryByTestId(`reconcile-open-${active.executionAttempts[0].attemptId}`)).toBeNull()
  })
})

describe('overlapping runs', () => {
  it('shows both registers as simultaneously active, because their windows overlap', () => {
    const first = readAttemptRegister(
      { executionAttempts: active.executionAttempts, attemptRegisterReadable: true },
      new Date('2026-09-19T12:00:00.000Z'),
    )
    const second = readAttemptRegister(
      { executionAttempts: stopUnconfirmed.executionAttempts, attemptRegisterReadable: true },
      new Date('2026-09-19T12:00:00.000Z'),
    )
    if (first.kind !== 'entries' || second.kind !== 'entries') throw new Error('[internal] expected entries')
    expect(first.activeEntry).not.toBeNull()
    expect(second.activeEntry).not.toBeNull()
    expect(first.entries[0].interval.start).toBeLessThan(second.entries[0].interval.end)
    expect(second.entries[0].interval.start).toBeLessThan(first.entries[0].interval.end)
  })
})
