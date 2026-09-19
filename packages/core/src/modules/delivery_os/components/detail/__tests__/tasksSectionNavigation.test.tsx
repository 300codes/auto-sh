/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { ProjectDetail, TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { buildAttempt } from '@open-mercato/core/modules/delivery_os/components/task/__tests__/attemptFixtures'
import { TasksSection } from '../TasksSection'
import type { SectionSource } from '../useProjectSections'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const otherTaskId = '44444444-4444-4444-8444-444444444444'
const now = '2026-09-19T10:00:00.000Z'

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

function renderTasks(tasks: TaskDto[], onSelectTask = jest.fn()) {
  render(
    <TasksSection
      state={ready(tasks)}
      attention={noAttention}
      hasActiveBaseline
      selectedTaskId={null}
      onSelectTask={onSelectTask}
      onRetry={() => undefined}
    />,
  )
  return onSelectTask
}

describe('TasksSection — attempt marker and task link', () => {
  it('links every row to its task detail without touching the selection contract', () => {
    const onSelectTask = renderTasks([task()])
    const link = screen.getByTestId(`delivery-task-open-${taskId}`)
    expect(link.getAttribute('href')).toBe(`/backend/delivery/projects/${projectId}/tasks/${taskId}`)
    // F1 of the UI-03 review: the row must still select AND deselect through the host.
    screen.getByTestId(`delivery-task-${taskId}`).click()
    expect(onSelectTask).toHaveBeenLastCalledWith(taskId)
  })

  it('marks a task that has a running attempt and leaves an idle task unmarked', () => {
    renderTasks([
      task({ executionAttempts: [buildAttempt({ state: 'claimed' })], attemptNumber: 1 }),
      task({ id: otherTaskId }),
    ])
    expect(screen.getByTestId(`task-active-attempt-${taskId}`).textContent)
      .toContain('delivery_os.project.sections.tasks.attempts.active')
    expect(screen.queryByTestId(`task-active-attempt-${otherTaskId}`)).toBeNull()
  })

  it('does not claim an attempt is running when the register could not be read', () => {
    renderTasks([task({
      executionAttempts: [buildAttempt({ state: 'claimed' })],
      attemptRegisterReadable: false,
      attemptNumber: 1,
    })])
    expect(screen.queryByTestId(`task-active-attempt-${taskId}`)).toBeNull()
    expect(screen.getByTestId(`attempt-register-unreadable-${taskId}`)).toBeTruthy()
  })

  it('keeps the three empty-state branches of the section untouched', () => {
    render(
      <TasksSection
        state={ready<TaskDto[]>([])}
        attention={noAttention}
        hasActiveBaseline={null}
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRetry={() => undefined}
      />,
    )
    expect(screen.getByText('delivery_os.project.sections.tasks.empty.baselineUnknown')).toBeTruthy()
    expect(screen.queryByTestId(`delivery-task-open-${taskId}`)).toBeNull()
  })
})
