/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DELIVERY_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { DesignSection } from '../DesignSection'
import { ScreenComments } from '../ScreenComments'
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

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const attachmentId = '55555555-5555-4555-8555-555555555555'
const hash = 'a'.repeat(64)
const now = '2026-09-19T10:00:00.000Z'

const screenRef = {
  fileKey: '5wOkFtN959W4MFmgRuaU8S',
  nodeId: '3:2',
  name: 'Service list',
  viewport: { width: 1440, height: 1024 },
  attachmentId,
  sha256: hash,
  capturedAt: now,
}

function baseline(): BaselineDto {
  return {
    id: baselineId,
    projectId,
    version: 2,
    contentHash: hash,
    source: 'manual',
    parentBaselineId: null,
    content: {
      schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
      requirements: [{ id: 'REQ-1', title: 'A requirement' }],
      acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'Something observable.' }],
      screens: [screenRef],
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
    isActive: true,
    decisions: [],
  }
}

function ready<TData>(data: TData): SectionSource<TData> {
  return { status: 'ready', data }
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('DesignSection render preview', () => {
  it('shows the render alongside the metadata, lazily', () => {
    render(<DesignSection state={ready([baseline()])} onRetry={() => undefined} />)
    const image = screen.getByTestId(`screen-preview-${attachmentId}`) as HTMLImageElement
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('src')).toContain(`/api/attachments/image/${attachmentId}`)
  })

  it('names a render that fails to load and keeps the metadata visible', async () => {
    render(<DesignSection state={ready([baseline()])} onRetry={() => undefined} />)
    fireEvent.error(screen.getByTestId(`screen-preview-${attachmentId}`))
    expect(await screen.findByTestId(`screen-preview-unavailable-${attachmentId}`)).toBeTruthy()
    expect(screen.queryByTestId(`screen-preview-${attachmentId}`)).toBeNull()
    // The metadata is what the baseline actually stores; losing the image must
    // not take the sha256 and the node id down with it.
    expect(screen.getByText('3:2')).toBeTruthy()
    expect(screen.getByText('1440×1024')).toBeTruthy()
  })
})

describe('ScreenComments draft cycle', () => {
  const draft = {
    requirements: [],
    acceptanceCriteria: [],
    questions: [],
    risks: [],
    adr: [],
    screens: [screenRef],
    tokens: {},
    architectureSummary: null,
    planSummary: null,
    acTestMap: {},
    manualChecks: {},
    declaredTests: [],
    attachments: [],
    comments: [],
  }

  function renderComments(onSaved = jest.fn()) {
    render(
      <ScreenComments
        projectId={projectId}
        projectUpdatedAt={now}
        draft={draft as never}
        screenAttachmentId={attachmentId}
        onSaved={onSaved}
      />,
    )
    return onSaved
  }

  async function typeAndAdd(text: string): Promise<void> {
    const user = userEvent.setup()
    const field = screen.getByTestId(`screen-comment-body-${attachmentId}`)
    field.focus()
    await user.paste(text)
    await user.click(screen.getByTestId(`screen-comment-add-${attachmentId}`))
  }

  it('refuses to write when the stored draft cannot be parsed, so unknown fields are never erased', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        id: projectId,
        name: 'Demo',
        inputMode: 'from_brief',
        brief: null,
        targetProfileId: 'react-vite',
        targetProfileVersion: 1,
        repositoryRef: null,
        activeBaselineId: baselineId,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        draftSpec: { requirements: 'not an array' },
        limits: { maxParallelTasks: 2, maxCorrectionRounds: 2, attemptTimeoutMinutes: 30 },
        status: 'draft',
        progress: { proven: 0, total: 1, unit: 'ac', percent: 0 },
        taskCounts: {},
        attention: { blockedTaskIds: [], reconciliationRequiredTaskIds: [] },
      },
    })
    renderComments()
    await typeAndAdd('Tighten the spacing')
    const problem = await screen.findByTestId('screen-comment-problem')
    expect(problem.textContent).toBe('delivery_os.project.draft.unparsable')
    // One call: the read. No PUT followed it.
    expect(apiCallMock).toHaveBeenCalledTimes(1)
    expect(apiCallMock.mock.calls.every((call) => (call[1] as { method?: string } | undefined)?.method !== 'PUT')).toBe(true)
  })

  it('requires a comment body before issuing any request', async () => {
    renderComments()
    await userEvent.setup().click(screen.getByTestId(`screen-comment-add-${attachmentId}`))
    const problem = await screen.findByTestId('screen-comment-problem')
    expect(problem.textContent).toBe('delivery_os.project.comments.error.bodyRequired')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('sends the whole draft back with the new comment appended', async () => {
    apiCallMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: {
          id: projectId,
          name: 'Demo',
          inputMode: 'from_brief',
          brief: null,
          targetProfileId: 'react-vite',
          targetProfileVersion: 1,
          repositoryRef: null,
          activeBaselineId: baselineId,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          draftSpec: draft,
          limits: { maxParallelTasks: 2, maxCorrectionRounds: 2, attemptTimeoutMinutes: 30 },
          status: 'draft',
          progress: { proven: 0, total: 1, unit: 'ac', percent: 0 },
          taskCounts: {},
          attention: { blockedTaskIds: [], reconciliationRequiredTaskIds: [] },
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, result: { ok: true, updatedAt: '2026-09-19T11:00:00.000Z' } })
    const onSaved = renderComments()
    await typeAndAdd('Tighten the spacing')
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('2026-09-19T11:00:00.000Z'))
    const put = apiCallMock.mock.calls[1]
    expect((put[1] as { method: string }).method).toBe('PUT')
    const body = JSON.parse((put[1] as { body: string }).body)
    expect(body.draftSpec.comments).toHaveLength(1)
    expect(body.draftSpec.comments[0]).toMatchObject({ screenAttachmentId: attachmentId, status: 'open', anchor: null })
    // The screen already in the draft has to survive the replacement.
    expect(body.draftSpec.screens).toHaveLength(1)
  })
})
