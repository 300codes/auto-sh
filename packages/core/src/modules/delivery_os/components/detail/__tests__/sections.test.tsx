/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { DELIVERY_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { BaselineDto, ProjectDetail, TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { RequirementsSection } from '../RequirementsSection'
import { DesignSection } from '../DesignSection'
import { TasksSection } from '../TasksSection'
import { EvidenceSection } from '../EvidenceSection'
import { resolveActiveBaseline } from '../baselineContent'
import type { SectionSource } from '../useProjectSections'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const otherTaskId = '44444444-4444-4444-8444-444444444444'
const attachmentId = '55555555-5555-4555-8555-555555555555'
const hash = 'a'.repeat(64)
const now = '2026-09-19T10:00:00.000Z'

const baselineContent = {
  schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
  requirements: [{ id: 'REQ-1', title: 'Operator can archive a project', description: 'From the list.' }],
  acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'A confirmation dialog appears.' }],
  screens: [{
    fileKey: 'file-key',
    nodeId: '12:34',
    name: 'Project list',
    viewport: { width: 1440, height: 900 },
    attachmentId,
    sha256: hash,
    capturedAt: now,
    figmaVersion: '1234567890',
  }],
  tokens: { 'color.primary': '#101010' },
  architectureSummary: null,
  planSummary: null,
  acTestMap: { 'AC-1': ['tests/list.spec.ts'] },
  manualChecks: { 'AC-1': 'MC-1' },
  declaredTests: [{ testId: 'tests/list.spec.ts', file: 'tests/list.spec.ts' }],
  attachments: [],
  resolvedComments: [],
  importedManifestHashes: [],
}

function baseline(overrides: Partial<BaselineDto> = {}): BaselineDto {
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
    ...overrides,
  }
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: taskId,
    projectId,
    baselineId,
    title: 'Build the project list',
    description: null,
    acIds: ['AC-1'],
    dependsOnTaskIds: [],
    allowedPaths: [],
    targetProfileId: 'react-vite',
    targetProfileVersion: 1,
    status: 'ready',
    statusReason: null,
    attemptNumber: 0,
    executionAttempts: [],
    attemptRegisterReadable: true,
    proposalTaskKey: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  }
}

const noAttention: ProjectDetail['attention'] = { blockedTaskIds: [], reconciliationRequiredTaskIds: [] }

function ready<TData>(data: TData): SectionSource<TData> {
  return { status: 'ready', data }
}

describe('baseline-backed sections', () => {
  it('names the missing baseline as a domain state, not as an empty list', () => {
    render(<RequirementsSection state={ready<BaselineDto[]>([])} onRetry={() => undefined} />)
    expect(screen.getByText('delivery_os.project.sections.baselines.none.title')).toBeTruthy()
    expect(screen.queryByText('delivery_os.project.sections.requirements.noRequirements')).toBeNull()
  })

  it('reports unreadable baseline content as a failure instead of showing an empty section', () => {
    render(
      <RequirementsSection
        state={ready([baseline({ content: { schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent } })])}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('delivery_os.project.sections.baselines.unreadableDescription')).toBeTruthy()
    expect(screen.queryByText('delivery_os.project.sections.baselines.none.title')).toBeNull()
  })

  it('shows the requirements with their acceptance criteria and names the baseline version', () => {
    render(<RequirementsSection state={ready([baseline()])} onRetry={() => undefined} />)
    expect(screen.getByText('Operator can archive a project')).toBeTruthy()
    expect(screen.getByText('A confirmation dialog appears.')).toBeTruthy()
    expect(screen.getByText('AC-1')).toBeTruthy()
    expect(screen.getByText('delivery_os.project.sections.baselineVersion')).toBeTruthy()
  })

  it('shows screen metadata with its Figma version and short hash, and no preview', () => {
    const { container } = render(<DesignSection state={ready([baseline()])} onRetry={() => undefined} />)
    expect(screen.getByText('Project list')).toBeTruthy()
    expect(screen.getByText('12:34')).toBeTruthy()
    expect(screen.getByText('1440×900')).toBeTruthy()
    expect(screen.getByText(hash.slice(0, 12))).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders the decision log read-only, with no approve or reject control', () => {
    const { container } = render(
      <DesignSection
        state={ready([baseline({
          decisions: [{
            id: attachmentId,
            kind: 'design',
            verdict: 'approved',
            subjectHash: hash,
            subjectVersion: 3,
            reason: null,
            actorUserId: projectId,
            decidedAt: now,
          }],
        })])}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('delivery_os.project.sections.decisions.verdict.approved')).toBeTruthy()
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('tasks section', () => {
  it('separates "no baseline" from "baseline without tasks"', () => {
    const view = render(
      <TasksSection
        state={ready<TaskDto[]>([])}
        attention={noAttention}
        hasActiveBaseline={false}
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('delivery_os.project.sections.tasks.empty.noBaseline')).toBeTruthy()
    view.rerender(
      <TasksSection
        state={ready<TaskDto[]>([])}
        attention={noAttention}
        hasActiveBaseline
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('delivery_os.project.sections.tasks.empty.baselineWithoutTasks')).toBeTruthy()
    expect(screen.queryByText('delivery_os.project.sections.tasks.empty.noBaseline')).toBeNull()
  })

  it('keeps an unreadable attempt register distinct from a task that has had no attempts', () => {
    render(
      <TasksSection
        state={ready([task(), task({ id: otherTaskId, attemptRegisterReadable: false })])}
        attention={noAttention}
        hasActiveBaseline
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByTestId(`attempt-register-empty-${taskId}`)).toBeTruthy()
    expect(screen.getByTestId(`attempt-register-unreadable-${otherTaskId}`)).toBeTruthy()
    expect(screen.queryByTestId(`attempt-register-empty-${otherTaskId}`)).toBeNull()
  })

  it('reports the attention lists with status tokens rather than a bare list', () => {
    render(
      <TasksSection
        state={ready([task({ status: 'blocked' })])}
        attention={{ blockedTaskIds: [taskId], reconciliationRequiredTaskIds: [taskId] }}
        hasActiveBaseline
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('delivery_os.project.sections.tasks.attention.blocked')).toBeTruthy()
    expect(screen.getByText('delivery_os.project.sections.tasks.attention.reconciliation')).toBeTruthy()
  })

  it('is fully controlled: selecting and deselecting both reach the host', () => {
    const onSelectTask = jest.fn()
    const view = render(
      <TasksSection
        state={ready([task()])}
        attention={noAttention}
        hasActiveBaseline
        selectedTaskId={null}
        onSelectTask={onSelectTask}
        onRetry={() => undefined}
      />,
    )
    screen.getByTestId(`delivery-task-${taskId}`).click()
    expect(onSelectTask).toHaveBeenLastCalledWith(taskId)
    view.rerender(
      <TasksSection
        state={ready([task()])}
        attention={noAttention}
        hasActiveBaseline
        selectedTaskId={taskId}
        onSelectTask={onSelectTask}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByTestId(`delivery-task-${taskId}`).getAttribute('aria-pressed')).toBe('true')
    screen.getByTestId(`delivery-task-${taskId}`).click()
    expect(onSelectTask).toHaveBeenLastCalledWith(null)
  })

  it('offers a retry when the task request failed instead of claiming there are no tasks', () => {
    const onRetry = jest.fn()
    render(
      <TasksSection
        state={{ status: 'error' }}
        attention={noAttention}
        hasActiveBaseline={null}
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('delivery_os.project.sections.tasks.loadError')).toBeTruthy()
    expect(screen.queryByText('delivery_os.project.sections.tasks.empty.noBaseline')).toBeNull()
    screen.getByRole('button', { name: 'delivery_os.project.retry' }).click()
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('evidence section', () => {
  const progressWithoutCriteria: ProjectDetail['progress'] = { proven: 0, total: 0, unit: 'ac', percent: null }

  it('renders a null percent as an em dash, never as zero percent', () => {
    render(
      <EvidenceSection
        progress={progressWithoutCriteria}
        taskCounts={{}}
        attention={noAttention}
        baselines={ready<BaselineDto[]>([])}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByTestId('delivery-evidence-percent').textContent).toBe('—')
    expect(screen.getByTestId('delivery-evidence-progress').textContent).toContain('0 / 0')
  })

  it('renders a real percent when the project has acceptance criteria', () => {
    render(
      <EvidenceSection
        progress={{ proven: 1, total: 4, unit: 'ac', percent: 25 }}
        taskCounts={{ ready: 3, verified: 1 }}
        attention={noAttention}
        baselines={ready<BaselineDto[]>([])}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByTestId('delivery-evidence-percent').textContent).toBe('25%')
  })

  it('labels the declared coverage as a plan declaration, not as an executed test', () => {
    render(
      <EvidenceSection
        progress={progressWithoutCriteria}
        taskCounts={{}}
        attention={noAttention}
        baselines={ready([baseline()])}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('delivery_os.project.sections.evidence.declaredCoverageCaveat')).toBeTruthy()
    expect(screen.getByText('delivery_os.project.sections.evidence.declaredTests')).toBeTruthy()
  })

  it('names the missing read endpoint rather than implying there is no evidence', () => {
    render(
      <EvidenceSection
        progress={progressWithoutCriteria}
        taskCounts={{}}
        attention={noAttention}
        baselines={ready([baseline()])}
        onRetry={() => undefined}
      />,
    )
    const notice = screen.getByTestId('delivery-evidence-list-unavailable')
    expect(notice.textContent).toContain('delivery_os.project.sections.evidence.listUnavailableDescription')
  })
})

describe('three empty states stay disjoint', () => {
  // Comparing whole SECTIONS would pass even if all three empty states said the
  // same thing, because the section headings differ on their own. Compare the
  // empty-state nodes themselves.
  it('uses a different message for no baseline, no tasks and no evidence endpoint', () => {
    const noBaseline = render(
      <RequirementsSection state={ready<BaselineDto[]>([])} onRetry={() => undefined} />,
    ).getByTestId('delivery-requirements-section-empty').textContent ?? ''
    const noTasks = render(
      <TasksSection
        state={ready<TaskDto[]>([])}
        attention={noAttention}
        hasActiveBaseline
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRetry={() => undefined}
      />,
    ).getByTestId('delivery-tasks-empty').textContent ?? ''
    const noEvidenceEndpoint = render(
      <EvidenceSection
        progress={{ proven: 0, total: 0, unit: 'ac', percent: null }}
        taskCounts={{}}
        attention={noAttention}
        baselines={ready([baseline()])}
        onRetry={() => undefined}
      />,
    ).getByTestId('delivery-evidence-list-unavailable').textContent ?? ''

    expect(noBaseline).toContain('delivery_os.project.sections.baselines.none.title')
    expect(noTasks).toContain('delivery_os.project.sections.tasks.empty.baselineWithoutTasks')
    expect(noEvidenceEndpoint).toContain('delivery_os.project.sections.evidence.listUnavailable')
    for (const text of [noBaseline, noTasks, noEvidenceEndpoint]) expect(text.length).toBeGreaterThan(0)
    expect(noBaseline).not.toBe(noTasks)
    expect(noTasks).not.toBe(noEvidenceEndpoint)
    expect(noBaseline).not.toBe(noEvidenceEndpoint)
  })
})

describe('resolveActiveBaseline', () => {
  it('returns three outcomes, never collapsing unreadable content into none', () => {
    expect(resolveActiveBaseline([]).kind).toBe('none')
    expect(resolveActiveBaseline([baseline({ isActive: false })]).kind).toBe('none')
    expect(resolveActiveBaseline([baseline({ content: {} })]).kind).toBe('unreadable')
    expect(resolveActiveBaseline([baseline()]).kind).toBe('ready')
  })
})
