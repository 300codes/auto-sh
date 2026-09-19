/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { taskDtoSchema } from '../../../api/schemas'
import { loadResultManifestFixture } from '../../../lib/fixtures'
import { acceptedResultSummarySchema } from '../../../lib/resultReadContracts'
import { readAttemptRegister } from '../attemptRegister'
import { TaskExecutionPanel } from '../TaskExecutionPanel'
import { buildAttempt } from './attemptFixtures'

const apiCallMock = jest.fn()
const translate = (key: string) => key
let scopeVersion = 0
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => scopeVersion }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({ useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }) }))

const manifest = loadResultManifestFixture()
const now = '2026-09-19T10:00:00.000Z'
const evidenceId = '99999999-9999-4999-8999-999999999999'
const acceptedAttempt = buildAttempt({
  attemptId: manifest.attemptId,
  baselineId: manifest.baselineId,
  baselineHash: manifest.baselineHash,
  state: 'closed',
  resultEvidenceId: evidenceId,
  externalRunId: manifest.externalRunId,
  closedAt: now,
  outcome: 'result_accepted',
})
const task = taskDtoSchema.parse({
  id: manifest.taskId, projectId: manifest.projectId, baselineId: manifest.baselineId,
  title: 'Accepted task', description: null, acIds: ['AC-001'], dependsOnTaskIds: [], allowedPaths: [],
  targetProfileId: 'react-vite', targetProfileVersion: 1, status: 'awaiting_review', statusReason: null,
  attemptNumber: 1, executionAttempts: [acceptedAttempt], attemptRegisterReadable: true,
  proposalTaskKey: null, createdAt: now, updatedAt: now, archivedAt: null,
})
const result = acceptedResultSummarySchema.parse({
  ...manifest,
  source: 'adapter', sourceRevision: manifest.resultRevision, evidenceId, createdAt: now,
  artifactCount: manifest.artifacts.length, artifactBytes: null,
})

function panel() {
  return <TaskExecutionPanel task={task} register={readAttemptRegister(task)} taskVersion={task.updatedAt}
    canManageAttempts={false} canReconcile={false} canImportResults={false} onMutated={jest.fn()} />
}

beforeEach(() => {
  scopeVersion = 0
  apiCallMock.mockReset()
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { schemaVersion: 'delivery-result-read.v1', result } })
})

it('restores the accepted result for a view-only user across unmount and reload', async () => {
  const first = render(panel())
  await screen.findByTestId('delivery-result-summary')
  expect(screen.getByText('delivery_os.task.result.source.adapter')).toBeTruthy()
  expect(screen.getByTestId('result-usage-unknown')).toBeTruthy()
  expect(screen.queryByTestId('result-import-open')).toBeNull()
  expect(screen.getByTestId('result-provenance').textContent).toContain(evidenceId)
  first.unmount()
  render(panel())
  await screen.findByTestId('delivery-result-summary')
  expect(screen.getByTestId('result-usage-unknown')).toBeTruthy()
  expect(apiCallMock).toHaveBeenCalledTimes(2)
  expect(apiCallMock).toHaveBeenLastCalledWith(`/api/delivery_os/tasks/${task.id}/results?attemptId=${manifest.attemptId}`)
})

it('rejects an inconsistent result and lets the user retry the read', async () => {
  apiCallMock.mockResolvedValueOnce({ ok: true, status: 200, result: { schemaVersion: 'delivery-result-read.v1', result: { ...result, taskId: evidenceId } } })
  render(panel())
  await screen.findByRole('alert')
  expect(screen.queryByTestId('delivery-result-summary')).toBeNull()
  await act(async () => { screen.getByRole('button', { name: 'delivery_os.task.retry' }).click() })
  await screen.findByTestId('delivery-result-summary')
})

it('hides prior-scope evidence immediately and ignores a delayed prior-scope response', async () => {
  let finishOldRequest: (value: unknown) => void = () => undefined
  apiCallMock.mockImplementationOnce(() => new Promise((resolve) => { finishOldRequest = resolve }))
  const view = render(panel())
  await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
  scopeVersion = 1
  apiCallMock.mockResolvedValue({ ok: false, status: 404, result: null })
  view.rerender(panel())
  expect(screen.queryByTestId('delivery-result-summary')).toBeNull()
  await screen.findByRole('alert')
  await act(async () => { finishOldRequest({ ok: true, status: 200, result: { schemaVersion: 'delivery-result-read.v1', result } }) })
  expect(screen.queryByTestId('delivery-result-summary')).toBeNull()
})

it('does not treat a missing referenced evidence as an empty successful result', async () => {
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { schemaVersion: 'delivery-result-read.v1', result: null } })
  render(panel())
  await screen.findByRole('alert')
  expect(screen.queryByText('delivery_os.task.result.read.empty')).toBeNull()
})
