/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { loadResultManifestFixture } from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import { ResultImportDialog } from '../ResultImportDialog'

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
const surfaceRecordConflictMock = jest.fn(() => false)
jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))

const manifest = loadResultManifestFixture()
const now = '2026-09-19T10:00:00.000Z'

function acceptResponse(duplicate: boolean) {
  return {
    ok: true,
    status: duplicate ? 200 : 201,
    result: {
      evidenceId: '55555555-5555-4555-8555-555555555555',
      duplicate,
      taskStatus: 'awaiting_review',
      taskUpdatedAt: '2026-09-19T11:00:00.000Z',
    },
  }
}

function refusal(code: string, status = 409, details: unknown[] = []) {
  return { ok: false, status, result: { error: 'refused', code, details } }
}

function renderDialog(attemptId: string | null = manifest.attemptId) {
  const onImported = jest.fn()
  render(
    <ResultImportDialog
      open
      onOpenChange={jest.fn()}
      taskId={manifest.taskId}
      attemptId={attemptId}
      taskUpdatedAt={now}
      onImported={onImported}
    />,
  )
  return onImported
}

function paste(value: unknown): void {
  fireEvent.change(screen.getByTestId('result-import-textarea'), { target: { value: JSON.stringify(value) } })
}

function submit(): void {
  fireEvent.click(screen.getByTestId('result-import-submit'))
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
  surfaceRecordConflictMock.mockReset()
  surfaceRecordConflictMock.mockReturnValue(false)
})

describe('ResultImportDialog — outcomes', () => {
  it('reports 201 as an accepted result and hands back the manifest plus the new task version', async () => {
    apiCallMock.mockResolvedValue(acceptResponse(false))
    const onImported = renderDialog()
    paste(manifest)
    submit()
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.task.result.accepted')
    expect(onImported).toHaveBeenCalledWith({ manifest, taskUpdatedAt: '2026-09-19T11:00:00.000Z', duplicate: false })
  })

  it('presents a replay as a success that wrote no second evidence', async () => {
    apiCallMock.mockResolvedValue(acceptResponse(true))
    renderDialog()
    paste(manifest)
    submit()
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.task.result.duplicate')
    expect(flashMock.mock.calls[0][1]).toBe('info')
    expect(screen.queryByTestId('result-import-server-error')).toBeNull()
  })

  it.each([
    ['result_conflict', 'delivery_os.task.result.error.resultConflict'],
    ['attempt_not_active', 'delivery_os.task.result.error.attemptNotActive'],
    ['path_not_allowed', 'delivery_os.task.result.error.pathNotAllowed'],
    ['unknown_test_id', 'delivery_os.task.result.error.unknownTestId'],
    ['baseline_mismatch', 'delivery_os.task.result.error.baselineMismatch'],
    ['correction_limit_reached', 'delivery_os.task.result.error.correctionLimitReached'],
  ])('keeps %s apart from every other refusal', async (code, key) => {
    apiCallMock.mockResolvedValue(refusal(code, code === 'path_not_allowed' ? 422 : 409))
    renderDialog()
    paste(manifest)
    submit()
    expect((await screen.findByTestId('result-import-server-error')).textContent).toBe(key)
  })

  it('routes a stale task version through the shared conflict bar', async () => {
    apiCallMock.mockResolvedValue(refusal('optimistic_lock_conflict'))
    surfaceRecordConflictMock.mockReturnValue(true)
    renderDialog()
    paste(manifest)
    submit()
    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalled())
    expect(screen.queryByTestId('result-import-server-error')).toBeNull()
  })

  it('renders every path the server named, not just the first', async () => {
    apiCallMock.mockResolvedValue(refusal('path_not_allowed', 422, [
      { path: 'changedPaths.1', code: 'outside_allowed_paths', message: 'package.json is outside the allowed paths' },
      { path: 'changedPaths.2', code: 'outside_allowed_paths', message: '.github/workflows/deploy.yml is outside the allowed paths' },
    ]))
    renderDialog()
    paste(manifest)
    submit()
    await screen.findByTestId('result-import-issues')
    const issues = screen.getAllByTestId('result-import-issue')
    expect(issues).toHaveLength(2)
    expect(issues[0].textContent).toContain('changedPaths.1')
    expect(issues[1].textContent).toContain('changedPaths.2')
  })
})

describe('ResultImportDialog — refusals before the request', () => {
  it('names the missing reservation instead of posting a result with no attempt', () => {
    renderDialog(null)
    paste(manifest)
    submit()
    expect(screen.getByTestId('result-import-problem').textContent).toBe('delivery_os.task.result.error.noAttempt')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('names a manifest produced for another attempt while the paste is still on screen', () => {
    renderDialog('99999999-9999-4999-8999-999999999999')
    paste(manifest)
    submit()
    expect(screen.getByTestId('result-import-problem').textContent)
      .toBe('delivery_os.task.result.error.foreignAttempt')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('lists the failing fields of a manifest that does not satisfy the contract', () => {
    renderDialog()
    paste({ ...manifest, taskId: 'not-a-uuid' })
    submit()
    expect(screen.getByTestId('result-import-issues')).toBeTruthy()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('previews what the manifest states before anything is sent', () => {
    renderDialog()
    paste(manifest)
    expect(screen.getByTestId('delivery-result-summary')).toBeTruthy()
    expect(screen.getByTestId('result-check-count-passed').textContent).toBe('delivery_os.task.result.checks.passed')
  })

  it('submits on Cmd/Ctrl+Enter, as every dialog in this product does', async () => {
    apiCallMock.mockResolvedValue(acceptResponse(false))
    renderDialog()
    paste(manifest)
    fireEvent.keyDown(screen.getByTestId('result-import-textarea'), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [path, init] = apiCallMock.mock.calls[0] as [string, { body: string }]
    expect(path).toBe(`/api/delivery_os/tasks/${manifest.taskId}/results`)
    expect(JSON.parse(init.body)).toEqual({ attemptId: manifest.attemptId, manifest })
  })
})
