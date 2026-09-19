/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReserveAttemptAction } from '../ReserveAttemptAction'
import { TaskExecutionPanel } from '../TaskExecutionPanel'
import { readAttemptRegister } from '../attemptRegister'
import { buildAttempt } from './attemptFixtures'

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

const taskId = '33333333-3333-4333-8333-333333333333'
const attemptId = '31111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const hash = 'a'.repeat(64)
const commitSha = 'f'.repeat(40)
const now = '2026-09-19T10:00:00.000Z'

function reserveResponse(status: number) {
  return {
    ok: true,
    status,
    result: {
      attemptId,
      taskId,
      baselineId,
      baselineHash: hash,
      taskUpdatedAt: '2026-09-19T11:00:00.000Z',
      packageUrl: `/api/delivery_os/tasks/${taskId}/package?attemptId=${attemptId}`,
    },
  }
}

function refusal(code: string, status = 409) {
  return { ok: false, status, result: { error: 'refused', code, details: [] } }
}

function renderAction(overrides: Partial<React.ComponentProps<typeof ReserveAttemptAction>> = {}) {
  const onReserved = jest.fn()
  render(
    <ReserveAttemptAction
      taskId={taskId}
      targetProfileId="react-vite"
      targetProfileVersion={1}
      attemptNumber={0}
      activeAttemptNumber={null}
      taskUpdatedAt={now}
      onReserved={onReserved}
      {...overrides}
    />,
  )
  return onReserved
}

async function submitWithCommit(): Promise<void> {
  const user = userEvent.setup()
  await user.type(screen.getByTestId('reserve-commit-sha'), commitSha)
  await user.click(screen.getByTestId('reserve-attempt-submit'))
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
  surfaceRecordConflictMock.mockReset()
  surfaceRecordConflictMock.mockReturnValue(false)
})

describe('ReserveAttemptAction — five disjoint outcomes', () => {
  it('reports 201 as a new attempt and hands the new task version back', async () => {
    apiCallMock.mockResolvedValue(reserveResponse(201))
    const onReserved = renderAction()
    await submitWithCommit()
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.task.reserve.created')
    expect(onReserved).toHaveBeenCalledWith(expect.objectContaining({ attemptId, taskUpdatedAt: '2026-09-19T11:00:00.000Z' }))
  })

  it('presents 200 as a success naming the existing attempt, never as a failure', async () => {
    apiCallMock.mockResolvedValue(reserveResponse(200))
    const onReserved = renderAction()
    await submitWithCommit()
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.task.reserve.existing')
    expect(flashMock.mock.calls[0][1]).toBe('info')
    expect(screen.queryByTestId('reserve-attempt-problem')).toBeNull()
    expect(onReserved).toHaveBeenCalled()
  })

  it('names an active attempt apart from an exhausted limit', async () => {
    apiCallMock.mockResolvedValue(refusal('attempt_active'))
    renderAction({ activeAttemptNumber: 2 })
    await submitWithCommit()
    expect((await screen.findByTestId('reserve-attempt-problem')).textContent)
      .toBe('delivery_os.task.reserve.error.attemptActive')

    apiCallMock.mockResolvedValue(refusal('attempt_limit_reached'))
    await userEvent.setup().click(screen.getByTestId('reserve-attempt-submit'))
    await waitFor(() => expect(screen.getByTestId('reserve-attempt-problem').textContent)
      .toBe('delivery_os.task.reserve.error.attemptLimitReached'))
  })

  it('routes a stale task version through the shared conflict bar rather than an inline message', async () => {
    apiCallMock.mockResolvedValue(refusal('optimistic_lock_conflict'))
    surfaceRecordConflictMock.mockReturnValue(true)
    renderAction()
    await submitWithCommit()
    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalled())
    expect(screen.queryByTestId('reserve-attempt-problem')).toBeNull()
    expect(flashMock).not.toHaveBeenCalled()
  })

  it.each([
    ['task_not_ready', 'delivery_os.task.reserve.error.taskNotReady'],
    ['dependency_not_verified', 'delivery_os.task.reserve.error.dependencyNotVerified'],
    ['idempotency_conflict', 'delivery_os.task.reserve.error.idempotencyConflict'],
  ])('names %s with its own sentence instead of a generic write failure', async (code, key) => {
    apiCallMock.mockResolvedValue(refusal(code))
    renderAction()
    await submitWithCommit()
    expect((await screen.findByTestId('reserve-attempt-problem')).textContent).toBe(key)
  })
})

describe('ReserveAttemptAction — revision and request shape', () => {
  it('refuses locally and names the field when the commit is missing, without issuing a request', async () => {
    renderAction()
    await userEvent.setup().click(screen.getByTestId('reserve-attempt-submit'))
    expect((await screen.findByTestId('reserve-attempt-problem')).textContent)
      .toBe('delivery_os.task.reserve.error.commitSha')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('sends the idempotency key, the optimistic-lock-guarded call and the manual mode', async () => {
    apiCallMock.mockResolvedValue(reserveResponse(201))
    renderAction()
    await submitWithCommit()
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [path, init] = apiCallMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(path).toBe(`/api/delivery_os/tasks/${taskId}/attempts`)
    expect(init.headers['idempotency-key']).toMatch(/^[\x21-\x7E]{1,200}$/)
    expect(JSON.parse(init.body)).toEqual({ mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha } })
  })

  it('collects a snapshot revision when the profile requires one', () => {
    renderAction({ targetProfileId: 'wordpress-theme' })
    expect(screen.getByTestId('reserve-content-hash')).toBeTruthy()
    expect(screen.getByTestId('reserve-workspace-id')).toBeTruthy()
    expect(screen.queryByTestId('reserve-commit-sha')).toBeNull()
  })

  it('states that the revision kind is unknown rather than guessing one', () => {
    renderAction({ targetProfileId: 'no-such-profile' })
    expect(screen.getByTestId('reserve-attempt-problem').textContent)
      .toBe('delivery_os.task.reserve.error.unknownTargetProfile')
    expect(screen.queryByTestId('reserve-attempt-submit')).toBeNull()
  })
})

describe('TaskExecutionPanel gating', () => {
  const task = {
    id: taskId,
    projectId: '11111111-1111-4111-8111-111111111111',
    baselineId,
    title: 'Build the request form',
    description: null,
    acIds: ['AC-1'],
    dependsOnTaskIds: [],
    allowedPaths: [],
    targetProfileId: 'react-vite',
    targetProfileVersion: 1,
    status: 'ready' as const,
    statusReason: null,
    attemptNumber: 0,
    executionAttempts: [],
    attemptRegisterReadable: true,
    proposalTaskKey: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }

  function renderPanel(canManageAttempts: boolean, attempts = task.executionAttempts) {
    render(
      <TaskExecutionPanel
        task={{ ...task, executionAttempts: attempts }}
        register={readAttemptRegister({ executionAttempts: attempts, attemptRegisterReadable: true })}
        taskVersion={now}
        canManageAttempts={canManageAttempts}
        canReconcile={false}
        canImportResults={false}
        onMutated={jest.fn()}
      />,
    )
  }

  it('does not render the reservation or the package export without delivery_os.attempts.manage', () => {
    renderPanel(false)
    expect(screen.queryByTestId('delivery-reserve-attempt')).toBeNull()
    expect(screen.queryByTestId('delivery-task-package')).toBeNull()
    expect(screen.getByTestId('delivery-attempt-register')).toBeTruthy()
  })

  it('renders both once the feature is granted and names the missing reservation in the package panel', () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: null })
    renderPanel(true)
    expect(screen.getByTestId('delivery-reserve-attempt')).toBeTruthy()
    expect(screen.getByTestId('task-package-no-attempt').textContent).toBe('delivery_os.task.package.noAttempt')
  })

  it('exports the package of the attempt the register reports as active', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 404, result: { error: 'gone', code: 'attempt_not_found', details: [] } })
    renderPanel(true, [buildAttempt({ state: 'claimed' })])
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith(
      `/api/delivery_os/tasks/${taskId}/package?attemptId=${attemptId}`,
    ))
  })
})
