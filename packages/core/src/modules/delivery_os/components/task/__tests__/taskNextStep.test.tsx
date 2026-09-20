/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { MAX_EXECUTION_ATTEMPTS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { readAttemptRegister } from '../attemptRegister'
import { readTaskNextStep, readTaskProgress, type TaskNextStepInput } from '../nextStep'
import { TaskNextStep } from '../TaskNextStep'
import { buildAttempt } from './attemptFixtures'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

function input(overrides: Partial<TaskNextStepInput> = {}): TaskNextStepInput {
  return {
    status: 'ready',
    statusReason: null,
    archivedAt: null,
    attemptNumber: 0,
    register: readAttemptRegister({ executionAttempts: [], attemptRegisterReadable: true }),
    hasAcceptedResult: false,
    canManageAttempts: true,
    canImportResults: true,
    canReconcile: true,
    ...overrides,
  }
}

function withAttempts(attempts: ReturnType<typeof buildAttempt>[], readable = true) {
  return readAttemptRegister({ executionAttempts: attempts, attemptRegisterReadable: readable })
}

describe('readTaskNextStep', () => {
  it('offers the reservation for a task that has no run yet', () => {
    expect(readTaskNextStep(input())).toMatchObject({ kind: 'reserve', blocker: null })
  })

  it('offers the result import while an attempt is live, and names the attempt', () => {
    const live = buildAttempt({ state: 'claimed' })
    const step = readTaskNextStep(input({ status: 'executing', register: withAttempts([live]), attemptNumber: 1 }))
    expect(step).toMatchObject({ kind: 'import', blocker: null, attemptId: live.attemptId, attemptNumber: 1 })
  })

  it('puts an unresolved attempt ahead of every other step, because it blocks them', () => {
    const stuck = buildAttempt({ state: 'reconciliation_required' })
    const step = readTaskNextStep(input({ status: 'blocked', statusReason: 'reconciliation_required', register: withAttempts([stuck]), attemptNumber: 1 }))
    expect(step).toMatchObject({ kind: 'reconcile', blocker: null, attemptId: stuck.attemptId })
  })

  it('treats an unconfirmed stop as unresolved rather than as a closed run', () => {
    const stopping = buildAttempt({ state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed' })
    expect(readTaskNextStep(input({ status: 'executing', register: withAttempts([stopping]) })).kind).toBe('reconcile')
  })

  it('asks for the review once the task waits for a verdict, and says why it cannot yet', () => {
    expect(readTaskNextStep(input({ status: 'awaiting_review', hasAcceptedResult: true })))
      .toMatchObject({ kind: 'review', blocker: null })
    expect(readTaskNextStep(input({ status: 'awaiting_review', hasAcceptedResult: false })))
      .toMatchObject({ kind: 'review', blocker: 'result_unreadable' })
  })

  it('names the missing feature instead of hiding the step', () => {
    expect(readTaskNextStep(input({ canManageAttempts: false }))).toMatchObject({ kind: 'reserve', blocker: 'missing_feature' })
    expect(readTaskNextStep(input({ status: 'awaiting_review', canImportResults: false })))
      .toMatchObject({ kind: 'review', blocker: 'missing_feature' })
  })

  it('refuses to offer a step while the register is unreadable', () => {
    expect(readTaskNextStep(input({ register: withAttempts([], false) })))
      .toMatchObject({ kind: 'unknown_history', blocker: 'unreadable_register' })
  })

  it('states the attempt limit rather than offering a reservation that must fail', () => {
    expect(readTaskNextStep(input({ attemptNumber: MAX_EXECUTION_ATTEMPTS })))
      .toMatchObject({ kind: 'reserve', blocker: 'attempt_limit' })
  })

  it('reports a verified, cancelled or archived task as settled', () => {
    expect(readTaskNextStep(input({ status: 'verified' })).kind).toBe('settled')
    expect(readTaskNextStep(input({ status: 'cancelled' })).kind).toBe('settled')
    expect(readTaskNextStep(input({ archivedAt: '2026-09-19T10:00:00.000Z' })))
      .toMatchObject({ kind: 'settled', blocker: 'archived' })
  })

  it('says a draft task cannot start instead of offering a reservation', () => {
    expect(readTaskNextStep(input({ status: 'draft' }))).toMatchObject({ kind: 'prepare', blocker: 'not_reservable' })
  })
})

describe('readTaskProgress', () => {
  it('marks the step the task is on and keeps the ones behind it completed', () => {
    const state = input({ status: 'awaiting_review', hasAcceptedResult: true })
    const progress = readTaskProgress(state, readTaskNextStep(state))
    expect(progress.map((entry) => entry.state)).toEqual(['completed', 'completed', 'completed', 'active', 'pending'])
  })

  it('reports every step of a verified task as done', () => {
    const state = input({ status: 'verified' })
    expect(readTaskProgress(state, readTaskNextStep(state)).every((entry) => entry.state === 'completed')).toBe(true)
  })
})

describe('TaskNextStep', () => {
  function renderStep(state: TaskNextStepInput, onAction?: () => void) {
    const step = readTaskNextStep(state)
    render(<TaskNextStep step={step} progress={readTaskProgress(state, step)} onAction={onAction} />)
  }

  it('names the action for the available step', () => {
    renderStep(input(), jest.fn())
    expect(screen.getByTestId('task-next-step').getAttribute('data-next-step')).toBe('reserve')
    expect(screen.getByRole('button', { name: 'delivery_os.task.next.action.reserve' })).toBeTruthy()
  })

  it('explains an unavailable step in prose and refuses to offer it', () => {
    renderStep(input({ canManageAttempts: false }))
    const action = screen.getByRole('button', { name: 'delivery_os.task.next.action.reserve' }) as HTMLButtonElement
    expect(action.disabled).toBe(true)
    expect(screen.getByText('delivery_os.task.next.blocker.missing_feature')).toBeTruthy()
  })

  it('reports a settled task without pretending there is a step to take', () => {
    renderStep(input({ status: 'verified' }))
    expect(screen.getByTestId('task-next-step-settled')).toBeTruthy()
    expect(screen.queryByTestId('task-next-step')).toBeNull()
  })
})
