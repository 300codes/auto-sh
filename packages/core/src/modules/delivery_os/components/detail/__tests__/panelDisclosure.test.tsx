/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DELIVERY_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { DesignSection } from '../DesignSection'
import { ScreenComments } from '../ScreenComments'
import { DesignManifestImport } from '../DesignManifestImport'
import { loadDesignManifestFixture } from '../../../lib/fixtures'
import { DESIGN_IMPORT_SCHEMA_VERSION, designImportScreenKey, type DesignImportSession } from '../../../lib/designImportContracts'
import type { SectionSource } from '../useProjectSections'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const apiCallMock = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: () => <div data-testid="session-create-form" /> }))

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

const baselineContent = {
  schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
  requirements: [{ id: 'REQ-1', title: 'A requirement' }],
  acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'Something observable.' }],
  screens: [{
    fileKey: 'file-key',
    nodeId: '12:34',
    name: 'Project list',
    viewport: { width: 1440, height: 900 },
    attachmentId,
    sha256: hash,
    capturedAt: now,
  }],
  tokens: { 'color.primary': '#101010' },
  architectureSummary: null,
  planSummary: null,
  acTestMap: { 'AC-1': ['tests/list.spec.ts'] },
  manualChecks: {},
  declaredTests: [{ testId: 'tests/list.spec.ts', file: 'tests/list.spec.ts' }],
  attachments: [],
  resolvedComments: [],
  importedManifestHashes: [],
}

function baseline(): BaselineDto {
  return {
    id: baselineId,
    projectId,
    version: 3,
    contentHash: hash,
    source: 'manual',
    parentBaselineId: null,
    content: baselineContent,
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

function expandFirstCollapsed(): Promise<void> {
  return act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'ui.sectionHeader.expand' })[0])
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('progressive disclosure keeps the technical detail out of the reading flow', () => {
  it('collapses the design tokens and reveals them on request, with the screen metadata always visible', async () => {
    render(<DesignSection state={ready([baseline()])} onRetry={() => undefined} />)
    expect(screen.getByText('12:34')).toBeTruthy()
    expect(screen.queryByText('color.primary')).toBeNull()
    await expandFirstCollapsed()
    expect(screen.getByText('color.primary')).toBeTruthy()
  })

  it('shows open notes and hides resolved ones until the operator asks for them', async () => {
    const draft = {
      requirements: [],
      acceptanceCriteria: [],
      questions: [],
      risks: [],
      adr: [],
      screens: [{ ...baselineContent.screens[0] }],
      tokens: {},
      architectureSummary: null,
      planSummary: null,
      acTestMap: {},
      manualChecks: {},
      declaredTests: [],
      attachments: [],
      comments: [
        { id: 'C-1', screenAttachmentId: attachmentId, anchor: null, body: 'Still open', status: 'open', resolution: null },
        { id: 'C-2', screenAttachmentId: attachmentId, anchor: null, body: 'Already handled', status: 'resolved', resolution: 'Reworked' },
      ],
    }
    render(
      <ScreenComments
        projectId={projectId}
        projectUpdatedAt={now}
        draft={draft as never}
        screenAttachmentId={attachmentId}
        onSaved={() => undefined}
      />,
    )
    expect(screen.getByText('Still open')).toBeTruthy()
    expect(screen.queryByText('Already handled')).toBeNull()
    await expandFirstCollapsed()
    expect(screen.getByTestId(`screen-comments-resolved-${attachmentId}`).textContent).toContain('Already handled')
  })

  it('opens the design-import panel collapsed and states its status in the header', async () => {
    const manifest = loadDesignManifestFixture()
    manifest.screens = manifest.screens.slice(0, 1)
    const session: DesignImportSession = {
      schemaVersion: DESIGN_IMPORT_SCHEMA_VERSION,
      id: '77777777-7777-4777-8777-777777777777',
      projectId,
      manifestHash: 'c'.repeat(64),
      manifest,
      progress: { screens: [{ key: designImportScreenKey(manifest.screens[0]), screen: null, errorCode: null }], selectedKeys: [] },
      status: 'partial',
      createdAt: now,
      updatedAt: '2026-09-19T11:00:00.000Z',
    }
    apiCallMock.mockImplementation(async () => ({ ok: true, result: { schemaVersion: DESIGN_IMPORT_SCHEMA_VERSION, items: [session] } }))
    render(
      <DesignManifestImport
        projectId={projectId}
        projectUpdatedAt="2026-09-19T09:00:00.000Z"
        canManage
        onChanged={async () => undefined}
      />,
    )
    expect(await screen.findByText('delivery_os.designImport.status.partial')).toBeTruthy()
    expect(screen.queryByTestId('design-import-progress')).toBeNull()
    expect(screen.queryByTestId('session-create-form')).toBeNull()
    await expandFirstCollapsed()
    expect(await screen.findByTestId('design-import-progress')).toBeTruthy()
    expect(screen.getByTestId('session-create-form')).toBeTruthy()
  })
})
