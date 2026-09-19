/** @jest-environment jsdom */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const baselineHash = 'b'.repeat(64)
const mergedHash = 'c'.repeat(64)

const manifest = {
  schemaVersion: DELIVERY_SCHEMA_VERSIONS.planProposal,
  projectId,
  baselineId,
  baselineHash,
  manifestId: 'plan-demo-1',
  architectureSummary: 'One page, one store, no server state.',
  tasks: [{
    proposalTaskKey: 'T-1',
    title: 'Render the catalogue',
    description: 'List services with a filter.',
    acIds: ['AC-1'],
    dependsOn: [],
    allowedPaths: ['src/features/catalogue'],
  }],
  acTestMap: { 'AC-1': ['tests/catalogue.spec.ts'] },
  declaredTests: [{ testId: 'tests/catalogue.spec.ts', file: 'tests/catalogue.spec.ts' }],
  producedBy: { tool: 'claude-code', sessionRef: null },
}

function renderDialog(onImported = jest.fn()) {
  render(
    <ProposalImportDialog
      open
      variant="plan"
      onOpenChange={() => undefined}
      projectId={projectId}
      projectUpdatedAt="2026-09-19T10:00:00.000Z"
      onImported={onImported}
    />,
  )
  return onImported
}

async function pasteAndSubmit(raw: string): Promise<void> {
  const user = userEvent.setup()
  const textarea = screen.getByTestId('proposal-import-textarea')
  textarea.focus()
  await user.paste(raw)
  await user.click(screen.getByTestId('proposal-import-submit'))
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
})

describe('ProposalImportDialog — plan variant', () => {
  it('previews the baseline the plan targets before anything is sent', async () => {
    renderDialog()
    const user = userEvent.setup()
    const textarea = screen.getByTestId('proposal-import-textarea')
    textarea.focus()
    await user.paste(JSON.stringify(manifest))
    const preview = await screen.findByTestId('proposal-import-preview-baseline')
    expect(preview.textContent).toContain('delivery_os.project.import.preview.baseline')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('posts to the tasks endpoint with the plan_proposal source', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 201,
      result: {
        baselineId,
        version: 3,
        contentHash: mergedHash,
        duplicate: false,
        tasks: [{ id: taskId, proposalTaskKey: 'T-1', updatedAt: '2026-09-19T11:00:00.000Z' }],
        projectUpdatedAt: '2026-09-19T11:00:00.000Z',
      },
    })
    const onImported = renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [url, init] = apiCallMock.mock.calls[0]
    expect(url).toBe(`/api/delivery_os/projects/${projectId}/tasks`)
    expect(JSON.parse((init as { body: string }).body).source).toBe('plan_proposal')
    expect(onImported).toHaveBeenCalledWith('2026-09-19T11:00:00.000Z')
  })

  it('states that the merged baseline is not active, so the tasks are not ready to run', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 201,
      result: {
        baselineId,
        version: 3,
        contentHash: mergedHash,
        duplicate: false,
        tasks: [{ id: taskId, proposalTaskKey: 'T-1', updatedAt: '2026-09-19T11:00:00.000Z' }],
        projectUpdatedAt: '2026-09-19T11:00:00.000Z',
      },
    })
    renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.project.import.plan.created')
    // The statement lives in the copy, so the copy is what gets asserted:
    // dropping "NOT active" would leave the operator believing the tasks are
    // ready to run, and this test is the thing that notices.
    const english = JSON.parse(readFileSync(join(__dirname, '../../../i18n/en.json'), 'utf8')) as Record<string, string>
    expect(english['delivery_os.project.import.plan.created']).toContain('NOT active')
    expect(english['delivery_os.project.import.plan.duplicate']).toContain('two decisions')
  })

  it('renders every path the server named, not just a single message', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 422,
      result: {
        error: 'Unknown acceptance criteria',
        code: 'unknown_ac',
        details: [
          { path: 'tasks.0.acIds.0', code: 'unknown_ac', message: 'Unknown acceptance criterion AC-9' },
          { path: 'acTestMap.AC-3', code: 'unknown_ac', message: 'Unknown acceptance criterion AC-3' },
        ],
      },
    })
    renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    const issues = await screen.findByTestId('proposal-import-issues')
    expect(issues.textContent).toContain('tasks.0.acIds.0')
    expect(issues.textContent).toContain('acTestMap.AC-3')
    const summary = screen.getByTestId('proposal-import-server-error')
    expect(summary.textContent).toBe('delivery_os.project.import.plan.error.unknownAc')
  })

  it('names a plan written for an older baseline as a hash mismatch, not as a generic refusal', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 422,
      result: { error: 'Baseline hash mismatch', code: 'baseline_mismatch', details: [] },
    })
    renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    const summary = await screen.findByTestId('proposal-import-server-error')
    expect(summary.textContent).toBe('delivery_os.project.import.plan.error.baselineHashMismatch')
  })

  it('reports a replay as a success that still needs its two decisions', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        baselineId,
        version: 3,
        contentHash: mergedHash,
        duplicate: true,
        tasks: [{ id: taskId, proposalTaskKey: 'T-1', updatedAt: '2026-09-19T11:00:00.000Z' }],
        projectUpdatedAt: '2026-09-19T11:00:00.000Z',
      },
    })
    renderDialog()
    await pasteAndSubmit(JSON.stringify(manifest))
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.project.import.plan.duplicate')
    expect(flashMock.mock.calls[0][1]).toBe('info')
  })
})
