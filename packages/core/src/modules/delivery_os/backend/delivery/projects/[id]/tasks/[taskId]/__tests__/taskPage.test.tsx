/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { buildAttempt } from '@open-mercato/core/modules/delivery_os/components/task/__tests__/attemptFixtures'
import DeliveryTaskDetailPage from '../page'
import { metadata } from '../page.meta'

const translate = (key: string) => key
const apiCallMock = jest.fn()
let grantedFeatures: string[] = []

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures }, isLoading: false, isReady: true, refresh: async () => {} }),
}))
jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const now = '2026-09-19T10:00:00.000Z'

function taskDto(overrides: Record<string, unknown> = {}) {
  return {
    id: taskId,
    projectId,
    baselineId,
    title: 'Build the request form',
    description: null,
    acIds: ['AC-3'],
    dependsOnTaskIds: [],
    allowedPaths: ['src/features/request'],
    targetProfileId: 'react-vite',
    targetProfileVersion: 1,
    status: 'ready',
    statusReason: null,
    attemptNumber: 0,
    executionAttempts: [],
    attemptRegisterReadable: true,
    proposalTaskKey: 'T-2',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  apiCallMock.mockReset()
  grantedFeatures = ['delivery_os.projects.view']
})

it('guards the route with the read feature, keeps it off the navigation and names the task breadcrumb', () => {
  expect(metadata).toMatchObject({ requireAuth: true, requireFeatures: ['delivery_os.projects.view'], navHidden: true })
  const breadcrumb = metadata.breadcrumb ?? []
  expect(breadcrumb).toHaveLength(3)
  expect(breadcrumb[0].href).toBe('/backend/delivery/projects')
  expect(breadcrumb[2].labelKey).toBe('delivery_os.task.title')
})

it('renders the task contract and its attempt register from the task API', async () => {
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: taskDto() })
  render(<DeliveryTaskDetailPage params={{ id: projectId, taskId }} />)
  expect(screen.getByText('delivery_os.task.loading')).toBeTruthy()
  await screen.findByRole('heading', { name: 'Build the request form' })
  expect(apiCallMock).toHaveBeenCalledWith(`/api/delivery_os/tasks/${taskId}`)
  expect(screen.getByTestId('delivery-task-allowed-paths').textContent).toBe('src/features/request')
  expect(screen.getByTestId('attempt-register-empty')).toBeTruthy()
})

it('links back to the project with the task preselected, since the breadcrumb cannot carry the project id', async () => {
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: taskDto() })
  render(<DeliveryTaskDetailPage params={{ id: projectId, taskId }} />)
  const back = await screen.findByText('delivery_os.task.backToProject')
  expect(back.closest('a')?.getAttribute('href')).toBe(`/backend/delivery/projects/${projectId}?taskId=${taskId}`)
})

it('reads a task whose register is unreadable without claiming it never ran', async () => {
  apiCallMock.mockResolvedValue({
    ok: true,
    status: 200,
    result: taskDto({ executionAttempts: [], attemptRegisterReadable: false, status: 'executing' }),
  })
  render(<DeliveryTaskDetailPage params={{ id: projectId, taskId }} />)
  await screen.findByTestId('attempt-register-unreadable')
  expect(screen.queryByTestId('attempt-register-empty')).toBeNull()
})

it('renders recorded attempts with their timestamps', async () => {
  apiCallMock.mockResolvedValue({
    ok: true,
    status: 200,
    result: taskDto({
      status: 'executing',
      attemptNumber: 1,
      executionAttempts: [buildAttempt({ state: 'claimed', claimedAt: '2026-09-19T10:05:00.000Z' })],
    }),
  })
  render(<DeliveryTaskDetailPage params={{ id: projectId, taskId }} />)
  const row = await screen.findByTestId('attempt-row-31111111-1111-4111-8111-111111111111')
  expect(row).toBeTruthy()
  expect(screen.getByText('delivery_os.task.attempts.state.claimed')).toBeTruthy()
})

it.each([
  [404, null, 'notFound'],
  [403, null, 'loadError'],
  [200, taskDto({ id: baselineId }), 'loadError'],
])('states why the task is unusable instead of rendering an empty detail (%s)', async (status, result, message) => {
  apiCallMock.mockResolvedValue({ ok: status === 200, status, result })
  render(<DeliveryTaskDetailPage params={{ id: projectId, taskId }} />)
  await screen.findByText(`delivery_os.task.${message}`)
  expect(screen.getByRole('button', { name: 'delivery_os.task.retry' })).toBeTruthy()
})
