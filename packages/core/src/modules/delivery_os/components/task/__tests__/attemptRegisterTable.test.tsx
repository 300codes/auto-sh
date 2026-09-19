/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { AttemptState } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { AttemptRegisterTable } from '../AttemptRegisterTable'
import { readAttemptRegister } from '../attemptRegister'
import { buildAttempt } from './attemptFixtures'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const ATTEMPT_STATES: readonly AttemptState[] = [
  'reserved',
  'claimed',
  'result_received',
  'cancel_requested',
  'reconciliation_required',
  'closed',
]

const OUTCOMES = ['result_accepted', 'cancelled', 'not_started', 'stopped'] as const

function attemptId(index: number): string {
  return `3${String(index).repeat(7)}-1111-4111-8111-111111111111`
}

function renderRegister(attempts: ReturnType<typeof buildAttempt>[], readable = true) {
  render(<AttemptRegisterTable register={readAttemptRegister({ executionAttempts: attempts, attemptRegisterReadable: readable })} />)
}

describe('AttemptRegisterTable', () => {
  it('names every attempt state instead of printing the raw enum value', () => {
    renderRegister(ATTEMPT_STATES.map((state, index) => buildAttempt({
      attemptId: attemptId(index + 1),
      state,
      reservedAt: `2026-09-19T1${index}:00:00.000Z`,
    })))
    ATTEMPT_STATES.forEach((state) => {
      expect(screen.getByText(`delivery_os.task.attempts.state.${state}`)).toBeTruthy()
    })
  })

  it('names every recorded outcome and says so explicitly when none was recorded', () => {
    renderRegister([
      ...OUTCOMES.map((outcome, index) => buildAttempt({
        attemptId: attemptId(index + 1),
        state: 'closed',
        closedAt: '2026-09-19T11:00:00.000Z',
        reservedAt: `2026-09-19T1${index}:00:00.000Z`,
        outcome,
      })),
      buildAttempt({ attemptId: attemptId(5), reservedAt: '2026-09-19T15:00:00.000Z' }),
    ])
    OUTCOMES.forEach((outcome) => {
      expect(screen.getByText(`delivery_os.task.attempts.outcome.${outcome}`)).toBeTruthy()
    })
    expect(screen.getByTestId(`attempt-outcome-${attemptId(5)}`).textContent).toBe('delivery_os.task.attempts.outcome.none')
  })

  it('marks a requested stop as unconfirmed rather than as a completed cancellation', () => {
    const stopping = buildAttempt({ state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed' })
    renderRegister([stopping])
    expect(screen.getByTestId(`attempt-stop-unconfirmed-${stopping.attemptId}`).textContent)
      .toBe('delivery_os.task.attempts.stopConfirmation.stop_unconfirmed')
    expect(screen.queryByText('delivery_os.task.attempts.outcome.cancelled')).toBeNull()
  })

  it('says an open attempt is still open instead of leaving the closed column blank', () => {
    const running = buildAttempt({ state: 'claimed', claimedAt: '2026-09-19T10:05:00.000Z' })
    renderRegister([running])
    expect(screen.getByTestId(`attempt-closed-${running.attemptId}`).textContent)
      .toBe('delivery_os.task.attempts.stillRunning')
    expect(screen.getByTestId(`attempt-active-${running.attemptId}`)).toBeTruthy()
  })

  it('keeps an unreadable register apart from a task with no attempts', () => {
    const { unmount } = render(
      <AttemptRegisterTable register={readAttemptRegister({ executionAttempts: [], attemptRegisterReadable: false })} />,
    )
    expect(screen.getByTestId('attempt-register-unreadable')).toBeTruthy()
    expect(screen.queryByTestId('attempt-register-empty')).toBeNull()
    unmount()
    renderRegister([], true)
    expect(screen.getByTestId('attempt-register-empty')).toBeTruthy()
    expect(screen.queryByTestId('attempt-register-unreadable')).toBeNull()
  })
})
