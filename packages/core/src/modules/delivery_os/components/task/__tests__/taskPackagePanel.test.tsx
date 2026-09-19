/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { loadTaskPackageFixture } from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import { TaskPackagePanel } from '../TaskPackagePanel'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const apiCallMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }))

const taskPackage = loadTaskPackageFixture()

function renderPanel(attemptId: string | null) {
  render(<TaskPackagePanel taskId={taskPackage.taskId} attemptId={attemptId} />)
}

beforeEach(() => {
  apiCallMock.mockReset()
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('TaskPackagePanel', () => {
  it('names the reservation as the missing precondition instead of showing an empty panel', () => {
    renderPanel(null)
    expect(screen.getByTestId('task-package-no-attempt').textContent).toBe('delivery_os.task.package.noAttempt')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('shows what the exported package pins: baseline, revision, profile, criteria and allowed paths', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: taskPackage })
    renderPanel(taskPackage.attemptId)
    await screen.findByTestId('task-package-facts')
    expect(screen.getByText(taskPackage.baselineId)).toBeTruthy()
    expect(screen.getByText(`${taskPackage.targetProfileId}@${taskPackage.targetProfileVersion}`)).toBeTruthy()
    expect(screen.getByText(taskPackage.allowedPaths.join(', '))).toBeTruthy()
  })

  it('keeps the download available when the environment exposes no clipboard', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: taskPackage })
    renderPanel(taskPackage.attemptId)
    await screen.findByTestId('task-package-facts')
    fireEvent.click(screen.getByTestId('task-package-copy'))
    expect((await screen.findByTestId('task-package-copy-problem')).textContent)
      .toBe('delivery_os.task.package.error.clipboardUnavailable')
    expect(screen.getByTestId('task-package-download')).toBeTruthy()
    expect(screen.queryByTestId('task-package-copied')).toBeNull()
  })

  it('names a refused clipboard as a refusal, not as a silent success', async () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: jest.fn(async () => { throw new Error('[internal] denied') }) },
      configurable: true,
    })
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: taskPackage })
    renderPanel(taskPackage.attemptId)
    await screen.findByTestId('task-package-facts')
    fireEvent.click(screen.getByTestId('task-package-copy'))
    expect((await screen.findByTestId('task-package-copy-problem')).textContent)
      .toBe('delivery_os.task.package.error.clipboardRefused')
  })

  it('confirms a successful copy with the whole package', async () => {
    const writeText = jest.fn(async () => undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true })
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: taskPackage })
    renderPanel(taskPackage.attemptId)
    await screen.findByTestId('task-package-facts')
    fireEvent.click(screen.getByTestId('task-package-copy'))
    await waitFor(() => expect(screen.getByTestId('task-package-copied')).toBeTruthy())
    expect(JSON.parse(writeText.mock.calls[0][0] as unknown as string)).toMatchObject({ attemptId: taskPackage.attemptId })
  })

  it.each([
    ['attempt_cancelled', 'delivery_os.task.package.error.attemptCancelled'],
    ['attempt_closed', 'delivery_os.task.package.error.attemptClosed'],
    ['reconciliation_required', 'delivery_os.task.package.error.reconciliationRequired'],
  ])('keeps the refusal %s apart from the others', async (code, key) => {
    apiCallMock.mockResolvedValue({ ok: false, status: 409, result: { error: 'refused', code, details: [] } })
    renderPanel(taskPackage.attemptId)
    expect((await screen.findByTestId('task-package-error')).textContent).toBe(key)
  })
})
