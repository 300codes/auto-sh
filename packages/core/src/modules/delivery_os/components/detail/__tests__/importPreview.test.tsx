/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DELIVERY_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { ProposalImportDialog, type ProposalImportVariant } from '../ProposalImportDialog'

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

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const baselineHash = 'b'.repeat(64)

const requirementsManifest = {
  schemaVersion: DELIVERY_SCHEMA_VERSIONS.requirementsProposal,
  projectId,
  manifestId: 'req-demo-1',
  requirements: [{ id: 'REQ-1', title: 'Operator reviews before importing' }],
  acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'The preview lists the requirement.' }],
  questions: [],
  risks: [],
  producedBy: { tool: 'claude-code', sessionRef: null },
}

const planManifest = {
  schemaVersion: DELIVERY_SCHEMA_VERSIONS.planProposal,
  projectId,
  baselineId,
  baselineHash,
  manifestId: 'plan-demo-1',
  architectureSummary: 'One page, one store.',
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

function renderDialog(variant: ProposalImportVariant = 'requirements') {
  render(
    <ProposalImportDialog
      open
      variant={variant}
      onOpenChange={() => undefined}
      projectId={projectId}
      projectUpdatedAt="2026-09-19T10:00:00.000Z"
      onImported={() => undefined}
    />,
  )
}

async function paste(raw: string): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'ui.sectionHeader.expand' }))
  const textarea = screen.getByTestId('proposal-import-textarea')
  textarea.focus()
  await user.paste(raw)
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('proposal import shows a readable preview instead of a payload', () => {
  it('offers a file and an empty state, and keeps the raw manifest behind a disclosure', () => {
    renderDialog()
    expect(screen.getByTestId('proposal-import-file')).toBeTruthy()
    expect(screen.getByTestId('proposal-import-idle')).toBeTruthy()
    // The default path must not be a JSON textarea: it exists only inside the
    // collapsed technical disclosure, so it is not in the document until asked for.
    expect(screen.queryByTestId('proposal-import-textarea')).toBeNull()
  })

  it('renders the requirements a manifest carries, with their acceptance criteria, before anything is sent', async () => {
    renderDialog()
    await paste(JSON.stringify(requirementsManifest))
    const preview = await screen.findByTestId('proposal-import-preview-requirements')
    expect(preview.textContent).toContain('Operator reviews before importing')
    expect(preview.textContent).toContain('The preview lists the requirement.')
    expect(screen.queryByTestId('proposal-import-idle')).toBeNull()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('renders the tasks a plan carries and the baseline it targets', async () => {
    renderDialog('plan')
    await paste(JSON.stringify(planManifest))
    const tasks = await screen.findByTestId('proposal-import-preview-tasks')
    expect(tasks.textContent).toContain('Render the catalogue')
    expect(tasks.textContent).toContain('List services with a filter.')
    expect(screen.getByTestId('proposal-import-preview-baseline').textContent)
      .toContain(baselineHash.slice(0, 12))
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('names a truncated paste in prose rather than dumping a parser error', async () => {
    renderDialog()
    await paste('{ "schemaVersion": "delivery.requirem')
    const problem = await screen.findByTestId('proposal-import-problem')
    expect(problem.textContent).toBe('delivery_os.project.import.error.notJson')
    expect(screen.queryByTestId('proposal-import-issues')).toBeNull()
    expect(screen.queryByTestId('proposal-import-preview')).toBeNull()
  })

  it('names the failing field once, with a prose lead, for a manifest that misses the contract', async () => {
    renderDialog()
    await paste(JSON.stringify({ ...requirementsManifest, schemaVersion: 'delivery.requirements-proposal/v2' }))
    const issues = await screen.findAllByTestId('proposal-import-issues')
    expect(issues).toHaveLength(1)
    expect(issues[0].textContent).toContain('schemaVersion')
    expect(issues[0].textContent).toContain('delivery_os.project.import.error.schema')
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})
