/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DELIVERY_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { ProposalImportDialog } from '../ProposalImportDialog'

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
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...(args as [])),
}))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const hash = 'a'.repeat(64)

const manifest = {
  schemaVersion: DELIVERY_SCHEMA_VERSIONS.requirementsProposal,
  projectId,
  manifestId: 'req-demo-1',
  requirements: [{ id: 'REQ-1', title: 'Operator imports a proposal' }],
  acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'Baseline v1 appears.' }],
  questions: [],
  risks: [],
  producedBy: { tool: 'claude-code', sessionRef: null },
}

function onImportedSpy() {
  return jest.fn()
}

/**
 * The raw manifest lives behind the dialog's technical disclosure now — the
 * default path is the file drop and the rendered preview — so a test that pastes
 * a payload has to open that disclosure first, exactly as an operator would.
 */
async function revealRawManifest(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'ui.sectionHeader.expand' }))
  return screen.getByTestId('proposal-import-textarea')
}

async function pasteAndSubmit(raw: string): Promise<void> {
  const user = userEvent.setup()
  // `paste` instead of `type`: a JSON body typed character by character is
  // thousands of events and tells us nothing the paste does not.
  const textarea = await revealRawManifest(user)
  textarea.focus()
  await user.paste(raw)
  await user.click(screen.getByTestId('proposal-import-submit'))
}

function renderDialog(onImported = onImportedSpy()) {
  render(
    <ProposalImportDialog
      open
      onOpenChange={() => undefined}
      projectId={projectId}
      projectUpdatedAt="2026-09-19T10:00:00.000Z"
      onImported={onImported}
    />,
  )
  return onImported
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
  surfaceRecordConflictMock.mockReset()
  surfaceRecordConflictMock.mockReturnValue(false)
})

describe('ProposalImportDialog', () => {
  it('treats a 200 replay as a success and a 409 name collision as a hard failure, with different messages', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { baselineId, version: 4, contentHash: hash, duplicate: true, openCommentIds: [], projectUpdatedAt: '2026-09-19T11:00:00.000Z' },
    })
    const onImported = renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.project.import.requirements.duplicate')
    expect(onImported).toHaveBeenCalledWith('2026-09-19T11:00:00.000Z')
    expect(screen.queryByTestId('proposal-import-server-error')).toBeNull()
  })

  it('names an idempotency conflict as a manifest-name collision instead of a generic write error', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 409,
      result: { error: 'Manifest already imported with different content', code: 'idempotency_conflict', details: [] },
    })
    renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    const problem = await screen.findByTestId('proposal-import-server-error')
    expect(problem.textContent).toBe('delivery_os.project.import.error.idempotencyConflict')
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('reports a created baseline with its version', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 201,
      result: { baselineId, version: 1, contentHash: hash, duplicate: false, openCommentIds: [], projectUpdatedAt: '2026-09-19T11:00:00.000Z' },
    })
    renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.project.import.requirements.created')
  })

  it('refuses a manifest produced for another project without issuing the request', async () => {
    renderDialog()
    await pasteAndSubmit(JSON.stringify({ ...manifest, projectId: '99999999-9999-4999-8999-999999999999' }))
    const problem = await screen.findByTestId('proposal-import-problem')
    expect(problem.textContent).toBe('delivery_os.project.import.error.foreignProject')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('lists the failing field paths for a manifest that does not satisfy the contract', async () => {
    renderDialog()
    await pasteAndSubmit(JSON.stringify({ ...manifest, schemaVersion: 'delivery.requirements-proposal/v2' }))
    const issues = await screen.findByTestId('proposal-import-issues')
    expect(issues.textContent).toContain('schemaVersion')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('routes an optimistic-lock conflict to the record-conflict bar rather than into the dialog', async () => {
    surfaceRecordConflictMock.mockReturnValue(true)
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 409,
      result: { error: 'Stale project version', code: 'optimistic_lock_conflict' },
    })
    renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalled())
    expect(screen.queryByTestId('proposal-import-server-error')).toBeNull()
  })
})
