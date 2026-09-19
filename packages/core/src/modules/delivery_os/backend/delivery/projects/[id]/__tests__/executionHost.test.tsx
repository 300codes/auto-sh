/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { executionWidgetContextV1Schema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import DeliveryProjectDetailPage from '../page'

const EXECUTE_FEATURE = 'delivery_agents.execute'

/**
 * Stand-in for the EXEC-02 skeleton widget. `delivery_os` must not import
 * enterprise code — `__tests__/module-registration.test.ts` fails the build if it
 * does — so this reproduces the skeleton's DOM contract
 * (`data-testid="delivery-execution-action"` carrying `data-project-id` and
 * `data-task-id`) and is registered through the real injection loader and the
 * real `InjectionSpot`, so spot routing and ACL filtering are exercised for real.
 * The widget's own internals are proven where the widget lives.
 */
const executionWidgetModule = {
  metadata: { id: 'delivery_agents.project-execution-action', features: [EXECUTE_FEATURE] },
  moduleId: 'delivery_agents',
  key: 'delivery_agents/project-execution-action',
  Widget: ({ context }: { context: { projectId: string; taskId?: string | null } }) =>
    context.taskId
      ? (
        <div
          data-testid="delivery-execution-action"
          data-project-id={context.projectId}
          data-task-id={context.taskId}
        />
      )
      : null,
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
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ retryLastMutation }),
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

type Responses = { tasks?: unknown; tasksOk?: boolean }

function routeApiCalls({ tasks = [task(taskId), task(otherTaskId)], tasksOk = true }: Responses = {}) {
  apiCallMock.mockImplementation(async (url: string) => {
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
  apiCallMock.mockReset()
  injectionSpotSpy.mockClear()
  registeredWidgets = [executionWidgetModule]
  grantedFeatures = [EXECUTE_FEATURE]
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}`)
  routeApiCalls()
})

it('mounts the execution extension with the selected task and records it in the URL', async () => {
  await renderDetail()
  expect(injectionSpotSpy).toHaveBeenCalledWith('delivery_os.project.execution')
  expect(screen.queryByTestId('delivery-execution-action')).toBeNull()

  await act(async () => { (await screen.findByTestId(`delivery-task-${taskId}`)).click() })

  const node = await screen.findByTestId('delivery-execution-action')
  expect(node.getAttribute('data-task-id')).toBe(taskId)
  expect(node.getAttribute('data-project-id')).toBe(projectId)
  expect(new URLSearchParams(window.location.search).get('taskId')).toBe(taskId)
})

it('keeps the context valid against the frozen contract once a task is selected', async () => {
  await renderDetail()
  await act(async () => { (await screen.findByTestId(`delivery-task-${taskId}`)).click() })
  await screen.findByTestId('delivery-execution-action')

  const context = {
    schemaVersion: 'delivery_os.project.execution.v1',
    projectId,
    taskId,
    baselineId,
    updatedAt: now,
    retryLastMutation: async () => false,
    refresh: async () => undefined,
  }
  expect(executionWidgetContextV1Schema.safeParse(context).success).toBe(true)
})

it('restores the selection from the URL so a reload and a deep link keep the context', async () => {
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?taskId=${taskId}`)
  await renderDetail()
  const node = await screen.findByTestId('delivery-execution-action')
  expect(node.getAttribute('data-task-id')).toBe(taskId)
})

it('clears a selection whose task no longer exists instead of mounting a dead task id', async () => {
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?taskId=${taskId}`)
  routeApiCalls({ tasks: [task(otherTaskId)] })
  await renderDetail()
  await waitFor(() => expect(screen.queryByTestId('delivery-execution-action')).toBeNull())
  expect(new URLSearchParams(window.location.search).get('taskId')).toBeNull()
})

it('does not mount the extension when the execute feature was revoked', async () => {
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?taskId=${taskId}`)
  grantedFeatures = []
  await renderDetail()
  await screen.findByTestId(`delivery-task-${taskId}`)
  expect(screen.queryByTestId('delivery-execution-action')).toBeNull()
})

it('does not mount the extension when it is not active on this installation', async () => {
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?taskId=${taskId}`)
  registeredWidgets = []
  await renderDetail()
  await screen.findByTestId(`delivery-task-${taskId}`)
  expect(screen.queryByTestId('delivery-execution-action')).toBeNull()
})

it('keeps the extension host and the other sections mounted when the task request fails', async () => {
  routeApiCalls({ tasksOk: false })
  await renderDetail()
  await screen.findByText('delivery_os.project.sections.tasks.loadError')
  expect(screen.getByTestId('delivery-requirements-section')).toBeTruthy()
  expect(screen.getByTestId('delivery-design-section')).toBeTruthy()
  expect(screen.getByTestId('delivery-evidence-section')).toBeTruthy()
  expect(injectionSpotSpy).toHaveBeenCalledWith('delivery_os.project.execution')
})
