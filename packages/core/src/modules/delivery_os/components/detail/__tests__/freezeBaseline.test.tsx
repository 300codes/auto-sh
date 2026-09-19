/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FreezeBaselineAction } from '../FreezeBaselineAction'

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

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const hash = 'a'.repeat(64)

function freezeResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 201,
    result: {
      baselineId,
      version: 2,
      contentHash: hash,
      duplicate: false,
      openCommentIds: [],
      projectUpdatedAt: '2026-09-19T11:00:00.000Z',
      ...overrides,
    },
  }
}

async function clickFreeze(): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByTestId('delivery-freeze-baseline'))
}

function renderAction(onFrozen = jest.fn()) {
  render(<FreezeBaselineAction projectId={projectId} projectUpdatedAt="2026-09-19T10:00:00.000Z" onFrozen={onFrozen} />)
  return onFrozen
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
})

describe('FreezeBaselineAction', () => {
  it('reports a clean freeze without claiming anything about comments', async () => {
    apiCallMock.mockResolvedValue(freezeResponse())
    const onFrozen = renderAction()
    await clickFreeze()
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.project.freeze.created')
    expect(onFrozen).toHaveBeenCalledWith('2026-09-19T11:00:00.000Z')
  })

  it('says how many unresolved comments the snapshot left behind instead of reporting a clean freeze', async () => {
    apiCallMock.mockResolvedValue(freezeResponse({ openCommentIds: ['C-1', 'C-2'] }))
    renderAction()
    await clickFreeze()
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.project.freeze.createdWithOpenComments')
    expect(flashMock.mock.calls[0][1]).toBe('warning')
  })

  it('names identical content as a duplicate rather than as a new version', async () => {
    apiCallMock.mockResolvedValue({ ...freezeResponse({ duplicate: true }), status: 200 })
    renderAction()
    await clickFreeze()
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.project.freeze.duplicate')
  })

  it('names a byte mismatch as a render that does not match its declaration, never as a write error', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 422,
      result: { error: 'Attachment bytes do not match', code: 'attachment_hash_mismatch', details: [] },
    })
    renderAction()
    await clickFreeze()
    const problem = await screen.findByTestId('freeze-baseline-problem')
    expect(problem.textContent).toBe('delivery_os.project.freeze.error.renderMismatch')
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('keeps a missing render separate from a byte mismatch', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 422,
      result: { error: 'No stored render', code: 'missing_render', details: [] },
    })
    renderAction()
    await clickFreeze()
    const problem = await screen.findByTestId('freeze-baseline-problem')
    expect(problem.textContent).toBe('delivery_os.project.freeze.error.missingRender')
  })
})
