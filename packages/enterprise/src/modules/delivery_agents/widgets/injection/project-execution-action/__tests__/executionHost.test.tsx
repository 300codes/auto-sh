/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { DeliveryProjectDetailClient as DeliveryProjectDetailPage } from '@open-mercato/core/modules/delivery_os/backend/delivery/projects/[id]/DeliveryProjectDetailClient'
import ProjectExecutionActionWidget from '../widget.client'

jest.mock('@open-mercato/core/modules/delivery_os/components/detail/ProjectOverview', () => ({ ProjectOverview: () => null }))

const EXECUTE_FEATURE = 'delivery_agents.execute'

const executionWidgetModule = {
  metadata: { id: 'delivery_agents.project-execution-action', features: [EXECUTE_FEATURE] },
  moduleId: 'delivery_agents',
  key: 'delivery_agents/project-execution-action',
  Widget: ProjectExecutionActionWidget,
}

let registeredWidgets: unknown[] = []
let grantedFeatures: string[] = []
const apiCallMock = jest.fn()
const injectionSpotSpy = jest.fn()
// Stable identity: the host rebuilds its fetch callback whenever this changes, so a
// fresh function per render would re-fire the project request on every render.
const retryLastMutation = async () => false

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args), withScopedApiRequestHeaders: (headers: unknown, operation: () => Promise<unknown>) => { headersMock(headers); return operation() } }))
const headersMock = jest.fn()
const mutationMock = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ retryLastMutation, runMutation: async (input: { operation: () => Promise<unknown> }) => { mutationMock(input); return input.operation() } }),
}))
jest.mock('@open-mercato/ui/backend/forms', () => ({ FormHeader: ({ title }: { title: string }) => <h1>{title}</h1> }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures }, isLoading: false, isReady: true, refresh: async () => {} }),
}))
jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  loadInjectionWidgetsForSpot: async (spotId: string) => {
    injectionSpotSpy(spotId)
    return registeredWidgets
  },
  getInjectionRegistryVersion: () => 1,
  subscribeToInjectionRegistryChanges: () => () => undefined,
}))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const otherTaskId = '44444444-4444-4444-8444-444444444444'
const now = '2026-09-19T10:00:00.000Z'

const project = {
  id: projectId,
  name: 'Execution host project',
  inputMode: 'from_brief',
  brief: null,
  targetProfileId: 'react-vite',
  targetProfileVersion: 1,
  repositoryRef: null,
  activeBaselineId: baselineId,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  draftSpec: {},
  limits: { maxParallelTasks: 2, maxCorrectionRounds: 2, attemptTimeoutMinutes: 20 },
  status: 'planning',
  progress: { proven: 0, total: 0, unit: 'ac', percent: null },
  taskCounts: {},
  attention: { blockedTaskIds: [], reconciliationRequiredTaskIds: [] },
}

function task(id: string) {
  return {
    id,
    projectId,
    baselineId,
    title: `Task ${id.slice(0, 4)}`,
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
  }
}

type Responses = { tasks?: unknown; tasksOk?: boolean; detail?: unknown }

function routeApiCalls({ tasks = [task(taskId), task(otherTaskId)], tasksOk = true, detail = task(taskId) }: Responses = {}) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.endsWith(`/tasks/${taskId}`)) return { ok: true, status: 200, result: detail }
    if (url.endsWith('/baselines')) return { ok: true, status: 200, result: { items: [], total: 0 } }
    if (url.endsWith('/tasks')) {
      return tasksOk
        ? { ok: true, status: 200, result: { items: tasks, total: (tasks as unknown[]).length } }
        : { ok: false, status: 500, result: null }
    }
    return { ok: true, status: 200, result: project }
  })
}

async function renderDetail(): Promise<void> {
  render(<DeliveryProjectDetailPage params={{ id: projectId }} />)
  await screen.findByRole('heading', { name: project.name })
}

beforeEach(() => {
  headersMock.mockClear()
  mutationMock.mockClear()
  apiCallMock.mockReset()
  injectionSpotSpy.mockClear()
  registeredWidgets = [executionWidgetModule]
  grantedFeatures = [EXECUTE_FEATURE]
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}`)
  routeApiCalls()
})

const attemptId = '55555555-5555-4555-8555-555555555555'
const taskVersion = '2026-09-19T10:01:00.000Z'
function attempt(state = 'claimed') {
  return {
    attemptId, idempotencyKey: 'test-execution', payloadHash: 'a'.repeat(64), mode: 'automatic', state,
    baselineId, baselineHash: 'b'.repeat(64), baseRevision: { kind: 'git', commitSha: 'c'.repeat(40) },
    baseCommit: 'c'.repeat(40), reservedAt: now, claimedAt: now, workerRef: null, externalRunId: null,
    workflowRef: null, workflowStepId: null, dispatchedAt: null, cancellationRequestedAt: state === 'cancel_requested' ? now : null,
    stopConfirmation: state === 'cancel_requested' ? 'stop_unconfirmed' : null, reconciliation: null,
    resultEvidenceId: null, completionDelivery: null, lastDeliveryError: null, closedAt: null, outcome: null,
  }
}

it('executes through the real injected widget, refetches, cancels with the task version, and restores cancellation after remount', async () => {
  let attempts: ReturnType<typeof attempt>[] = []
  apiCallMock.mockImplementation(async (url: string, options?: { method?: string }) => {
    if (options?.method === 'POST') {
      attempts = [attempt(url.endsWith('/cancel') ? 'cancel_requested' : 'claimed')]
      return { ok: true, status: 202, result: { attemptId, state: 'reserved' } }
    }
    const currentTask = { ...task(taskId), updatedAt: taskVersion, executionAttempts: attempts }
    if (url.endsWith('/baselines')) return { ok: true, status: 200, result: { items: [], total: 0 } }
    if (url.endsWith('/tasks')) return { ok: true, status: 200, result: { items: [currentTask], total: 1 } }
    if (url.endsWith(`/tasks/${taskId}`)) return { ok: true, status: 200, result: currentTask }
    return { ok: true, status: 200, result: project }
  })
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?taskId=${taskId}`)
  const rendered = render(<DeliveryProjectDetailPage params={{ id: projectId }} />)
  const execute = await screen.findByRole('button', { name: 'delivery_agents.widget.execute.ariaLabel' })
  await waitFor(() => expect((execute as HTMLButtonElement).disabled).toBe(false))
  await act(async () => { execute.click(); execute.click() })
  const cancel = await screen.findByRole('button', { name: 'delivery_agents.widget.cancel.ariaLabel' })
  expect(headersMock).toHaveBeenLastCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': taskVersion })
  expect(mutationMock.mock.calls[0][0].context).toMatchObject({ resourceKind: 'delivery_os.task', resourceId: taskId, retryLastMutation })
  await act(async () => { cancel.click() })
  expect(await screen.findByText('delivery_agents.widget.cancel.cancelling')).toBeTruthy()
  rendered.unmount()
  render(<DeliveryProjectDetailPage params={{ id: projectId }} />)
  const restored = await screen.findByRole('button', { name: 'delivery_agents.widget.cancel.ariaLabel' })
  expect((restored as HTMLButtonElement).disabled).toBe(true)
  expect(apiCallMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2)
})


it.each([
  ['unreadable register', { ...task(taskId), attemptRegisterReadable: false }],
  ['foreign project', { ...task(taskId), projectId: otherTaskId }],
  ['foreign task', task(otherTaskId)],
])('does not execute with %s', async (_label, detail) => {
  routeApiCalls({ detail })
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?taskId=${taskId}`)
  await renderDetail()
  const execute = await screen.findByRole('button', { name: 'delivery_agents.widget.execute.ariaLabel' })
  await waitFor(() => expect(screen.queryByText('delivery_os.task.loading')).toBeNull())
  expect((execute as HTMLButtonElement).disabled).toBe(true)
  expect(mutationMock).not.toHaveBeenCalled()
})

it('reads the register after an uncertain execute response instead of posting again', async () => {
  let saved = false
  apiCallMock.mockImplementation(async (url: string, options?: { method?: string }) => {
    if (options?.method === 'POST') { saved = true; throw new Error('Connection interrupted') }
    const currentTask = { ...task(taskId), executionAttempts: saved ? [attempt()] : [] }
    if (url.endsWith('/baselines')) return { ok: true, status: 200, result: { items: [], total: 0 } }
    if (url.endsWith('/tasks')) return { ok: true, status: 200, result: { items: [currentTask], total: 1 } }
    if (url.endsWith(`/tasks/${taskId}`)) return { ok: true, status: 200, result: currentTask }
    return { ok: true, status: 200, result: project }
  })
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?taskId=${taskId}`)
  await renderDetail()
  const execute = await screen.findByRole('button', { name: 'delivery_agents.widget.execute.ariaLabel' })
  await waitFor(() => expect((execute as HTMLButtonElement).disabled).toBe(false))
  await act(async () => { execute.click() })
  expect(await screen.findByRole('button', { name: 'delivery_agents.widget.cancel.ariaLabel' })).toBeTruthy()
  expect(apiCallMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})
