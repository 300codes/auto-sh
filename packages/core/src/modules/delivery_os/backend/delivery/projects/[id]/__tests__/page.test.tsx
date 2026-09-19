/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ExecutionWidgetContextV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { executionWidgetContextV1Schema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import DeliveryProjectDetailPage from '../page'
import { metadata } from '../page.meta'

const apiCallMock = jest.fn()
const retryLastMutationMock = jest.fn(async () => false)
const injectionMock = jest.fn()
const translate = (key: string) => key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ retryLastMutation: retryLastMutationMock }),
}))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: (props: unknown) => { injectionMock(props); return <div data-testid="execution-host" /> },
}))
jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const updatedAt = '2026-09-19T10:00:00.000Z'
const project = {
  id: projectId, name: 'Delivery test project', inputMode: 'from_brief', brief: 'Build a working example',
  targetProfileId: 'react-vite', targetProfileVersion: 1, repositoryRef: null,
  activeBaselineId: baselineId, createdAt: updatedAt, updatedAt, archivedAt: null,
  draftSpec: {}, limits: { maxParallelTasks: 2, maxCorrectionRounds: 2, attemptTimeoutMinutes: 20 }, status: 'draft',
  progress: { proven: 0, total: 0, unit: 'ac', percent: null }, taskCounts: {},
  attention: { blockedTaskIds: [], reconciliationRequiredTaskIds: [] },
}

beforeEach(() => { apiCallMock.mockReset(); injectionMock.mockClear(); retryLastMutationMock.mockClear() })

it('guards the page with the same feature as the project detail API', () => {
  expect(metadata).toMatchObject({ requireAuth: true, requireFeatures: ['delivery_os.projects.view'] })
})

it('mounts the declared contract using API data and refreshes the version after a widget mutation', async () => {
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: project })
  render(<DeliveryProjectDetailPage params={{ id: projectId }} />)
  expect(screen.getByText('delivery_os.project.loading')).toBeTruthy()
  await screen.findByRole('heading', { name: project.name })
  expect(apiCallMock).toHaveBeenCalledWith(`/api/delivery_os/projects/${projectId}`)
  const props = injectionMock.mock.calls.at(-1)?.[0] as { spotId: string; context: ExecutionWidgetContextV1 }
  expect(props.spotId).toBe('delivery_os.project.execution')
  expect(executionWidgetContextV1Schema.safeParse(props.context).success).toBe(true)
  expect(props.context).toMatchObject({ projectId, taskId: null, baselineId, updatedAt, retryLastMutation: retryLastMutationMock })
  const nextVersion = '2026-09-19T11:00:00.000Z'
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ...project, updatedAt: nextVersion } })
  await act(async () => { await props.context.refresh() })
  expect(injectionMock.mock.calls.at(-1)?.[0].context.updatedAt).toBe(nextVersion)
})

it.each([
  [404, null, 'notFound'],
  [403, null, 'loadError'],
  [200, { ...project, updatedAt: null }, 'loadError'],
  [200, { ...project, id: baselineId }, 'loadError'],
])('does not mount extensions for unusable or unauthorized project data (%s)', async (status, result, message) => {
  apiCallMock.mockResolvedValue({ ok: status === 200, status, result })
  render(<DeliveryProjectDetailPage params={{ id: projectId }} />)
  await screen.findByText(`delivery_os.project.${message}`)
  expect(screen.getByRole('button', { name: 'delivery_os.project.retry' })).toBeTruthy()
  expect(injectionMock).not.toHaveBeenCalled()
})

it('ignores a previous project request that resolves after navigation', async () => {
  let resolveFirst: (value: unknown) => void = () => undefined
  apiCallMock.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
  const view = render(<DeliveryProjectDetailPage params={{ id: projectId }} />)
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ...project, id: baselineId, name: 'New project' } })
  view.rerender(<DeliveryProjectDetailPage params={{ id: baselineId }} />)
  await screen.findByRole('heading', { name: 'New project' })
  await act(async () => { resolveFirst({ ok: true, status: 200, result: project }) })
  await waitFor(() => expect(screen.queryByRole('heading', { name: project.name })).toBeNull())
  expect(injectionMock.mock.calls.at(-1)?.[0].context.projectId).toBe(baselineId)
})
