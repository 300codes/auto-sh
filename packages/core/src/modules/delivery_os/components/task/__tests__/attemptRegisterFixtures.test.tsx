/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import {
  loadAttemptRegisterFixture,
  type AttemptRegisterFixtureName,
} from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import { AttemptRegisterTable } from '../AttemptRegisterTable'
import { readAttemptRegister } from '../attemptRegister'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const NAMES: readonly AttemptRegisterFixtureName[] = ['active', 'stop-unconfirmed', 'reconciliation-required', 'unreadable']

function renderFixture(name: AttemptRegisterFixtureName) {
  const fixture = loadAttemptRegisterFixture(name)
  render(
    <AttemptRegisterTable
      register={readAttemptRegister(
        { executionAttempts: fixture.executionAttempts, attemptRegisterReadable: fixture.attemptRegisterReadable },
        new Date('2026-09-19T12:00:00.000Z'),
      )}
    />,
  )
  return fixture
}

describe('attempt-register fixtures', () => {
  it.each(NAMES)('%s loads and declares its own readability', (name) => {
    const fixture = loadAttemptRegisterFixture(name)
    expect(fixture.description.length).toBeGreaterThan(0)
    expect(fixture.attemptRegisterReadable).toBe(name !== 'unreadable')
  })

  it('renders the active run as active and still open', () => {
    const fixture = renderFixture('active')
    const attemptId = fixture.executionAttempts[0].attemptId
    expect(screen.getByTestId(`attempt-active-${attemptId}`)).toBeTruthy()
    expect(screen.getByTestId(`attempt-closed-${attemptId}`).textContent).toBe('delivery_os.task.attempts.stillRunning')
  })

  it('renders a requested stop as unconfirmed while the attempt is still active', () => {
    const fixture = renderFixture('stop-unconfirmed')
    const attemptId = fixture.executionAttempts[0].attemptId
    expect(screen.getByTestId(`attempt-stop-unconfirmed-${attemptId}`)).toBeTruthy()
    expect(screen.getByTestId(`attempt-active-${attemptId}`)).toBeTruthy()
    expect(screen.getByTestId(`attempt-outcome-${attemptId}`).textContent)
      .toBe('delivery_os.task.attempts.outcome.none')
  })

  it('renders an unresolved attempt after a closed one, and marks only the unresolved one', () => {
    const fixture = renderFixture('reconciliation-required')
    const [closed, unresolved] = fixture.executionAttempts
    expect(screen.getByTestId(`attempt-outcome-${closed.attemptId}`).textContent)
      .toBe('delivery_os.task.attempts.outcome.result_accepted')
    expect(screen.getByTestId(`attempt-reconciliation-${unresolved.attemptId}`)).toBeTruthy()
    expect(screen.queryByTestId(`attempt-reconciliation-${closed.attemptId}`)).toBeNull()
  })

  it('renders the unreadable register as unreadable, never as a task with no attempts', () => {
    renderFixture('unreadable')
    expect(screen.getByTestId('attempt-register-unreadable')).toBeTruthy()
    expect(screen.queryByTestId('attempt-register-empty')).toBeNull()
  })
})
