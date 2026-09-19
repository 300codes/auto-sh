/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DELIVERY_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { BaselineDto, ProjectDetail, TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { DecisionActions } from '../DecisionActions'
import { TasksSection } from '../TasksSection'
import type { SectionSource } from '../useProjectSections'

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
const viewedBaselineId = '33333333-3333-4333-8333-333333333333'
const decisionId = '44444444-4444-4444-8444-444444444444'
const viewedHash = 'c'.repeat(64)
const now = '2026-09-19T10:00:00.000Z'

/** The version on screen — deliberately NOT the active one. */
function viewedBaseline(): BaselineDto {
  return {
    id: viewedBaselineId,
    projectId,
    version: 3,
    contentHash: viewedHash,
    source: 'manual',
    parentBaselineId: null,
    content: {
      schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
      requirements: [],
      acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'Observable.' }],
      screens: [],
      tokens: {},
      architectureSummary: null,
      planSummary: null,
      acTestMap: {},
      manualChecks: {},
      declaredTests: [],
      attachments: [],
      resolvedComments: [],
      importedManifestHashes: [],
    },
    attachmentIds: [],
    createdBy: null,
    createdAt: now,
    isActive: false,
    decisions: [],
  }
}

function renderActions(onDecided = jest.fn()) {
  render(
    <DecisionActions
      kind="requirements"
      baseline={viewedBaseline()}
      projectUpdatedAt={now}
      onDecided={onDecided}
    />,
  )
  return onDecided
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
  surfaceRecordConflictMock.mockReset()
  surfaceRecordConflictMock.mockReturnValue(false)
})

describe('DecisionActions', () => {
  it('binds the decision to the hash and version of the VIEWED baseline, not the active one', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 201,
      result: { decisionId, activeBaselineId: null, projectUpdatedAt: '2026-09-19T11:00:00.000Z' },
    })
    const onDecided = renderActions()
    await userEvent.setup().click(screen.getByTestId('decision-approve-requirements'))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [url, init] = apiCallMock.mock.calls[0]
    expect(url).toContain(`/api/delivery_os/baselines/${viewedBaselineId}/decisions`)
    const body = JSON.parse((init as { body: string }).body)
    expect(body).toMatchObject({ kind: 'requirements', verdict: 'approved', subjectHash: viewedHash, subjectVersion: 3 })
    expect(onDecided).toHaveBeenCalledWith('2026-09-19T11:00:00.000Z', null)
  })

  it('says the baseline became active only when the response reports it', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 201,
      result: { decisionId, activeBaselineId: viewedBaselineId, projectUpdatedAt: '2026-09-19T11:00:00.000Z' },
    })
    renderActions()
    await userEvent.setup().click(screen.getByTestId('decision-approve-requirements'))
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.project.decisions.activated')
  })

  it('does not issue a rejection without a reason', async () => {
    const user = userEvent.setup()
    renderActions()
    // First click opens the reason field; second click submits.
    await user.click(screen.getByTestId('decision-reject-requirements'))
    await user.click(screen.getByTestId('decision-reject-requirements'))
    const problem = await screen.findByTestId('decision-problem-requirements')
    expect(problem.textContent).toBe('delivery_os.project.decisions.error.reasonRequired')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('sends the reason once one is given', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 201,
      result: { decisionId, activeBaselineId: null, projectUpdatedAt: '2026-09-19T11:00:00.000Z' },
    })
    const user = userEvent.setup()
    renderActions()
    await user.click(screen.getByTestId('decision-reject-requirements'))
    const field = screen.getByTestId('decision-reason-requirements')
    field.focus()
    await user.paste('The AC do not cover the empty state')
    await user.click(screen.getByTestId('decision-reject-requirements'))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const body = JSON.parse((apiCallMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toMatchObject({ verdict: 'rejected', reason: 'The AC do not cover the empty state' })
  })

  it('separates a stale subject hash from a stale project version', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 409,
      result: { error: 'Subject hash mismatch', code: 'subject_hash_mismatch', details: [] },
    })
    renderActions()
    await userEvent.setup().click(screen.getByTestId('decision-approve-requirements'))
    const problem = await screen.findByTestId('decision-problem-requirements')
    expect(problem.textContent).toBe('delivery_os.project.decisions.error.subjectHashMismatch')
    expect(surfaceRecordConflictMock).toHaveBeenCalled()
    // The record-conflict bar declined this one, so it must NOT be reported as a version conflict.
    expect(surfaceRecordConflictMock.mock.results[0].value).toBe(false)
  })

  it('hands an optimistic-lock conflict to the record-conflict bar and shows no inline message', async () => {
    surfaceRecordConflictMock.mockReturnValue(true)
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 409,
      result: { error: 'Stale project version', code: 'optimistic_lock_conflict' },
    })
    renderActions()
    await userEvent.setup().click(screen.getByTestId('decision-approve-requirements'))
    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalled())
    expect(screen.queryByTestId('decision-problem-requirements')).toBeNull()
  })

  it('names an altered stored content as an integrity failure, not as a stale page', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 422,
      result: { error: 'Stored content altered', code: 'stored_content_altered', details: [] },
    })
    renderActions()
    await userEvent.setup().click(screen.getByTestId('decision-approve-requirements'))
    const problem = await screen.findByTestId('decision-problem-requirements')
    expect(problem.textContent).toBe('delivery_os.project.decisions.error.storedContentAltered')
  })
})

describe('TasksSection — F1', () => {
  const noAttention: ProjectDetail['attention'] = { blockedTaskIds: [], reconciliationRequiredTaskIds: [] }

  function renderTasks(hasActiveBaseline: boolean | null) {
    render(
      <TasksSection
        state={{ status: 'ready', data: [] } as SectionSource<TaskDto[]>}
        attention={noAttention}
        hasActiveBaseline={hasActiveBaseline}
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRetry={() => undefined}
      />,
    )
  }

  it('does not claim the project has no baseline while the baseline state is unknown', () => {
    // `state: 'ready'` with no tasks and `hasActiveBaseline === null` — the case
    // UI-02 never covered, because its only null case short-circuited on an error.
    renderTasks(null)
    expect(screen.queryByText('delivery_os.project.sections.tasks.empty.noBaseline')).toBeNull()
    expect(screen.queryByText('delivery_os.project.sections.tasks.empty.baselineWithoutTasks')).toBeNull()
    expect(screen.getByText('delivery_os.project.sections.tasks.empty.baselineUnknown')).toBeTruthy()
  })

  it('still names the cause once the baseline state is known', () => {
    renderTasks(false)
    expect(screen.getByText('delivery_os.project.sections.tasks.empty.noBaseline')).toBeTruthy()
  })

  it('distinguishes an active baseline with no planned tasks', () => {
    renderTasks(true)
    expect(screen.getByText('delivery_os.project.sections.tasks.empty.baselineWithoutTasks')).toBeTruthy()
  })
})
