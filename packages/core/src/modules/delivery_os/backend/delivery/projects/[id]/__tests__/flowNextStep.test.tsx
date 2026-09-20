/** @jest-environment jsdom */
import * as React from 'react'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { act, render, screen } from '@testing-library/react'
import { flowStatusV1Schema, type FlowStatusV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DeliveryProjectDetailClient } from '../DeliveryProjectDetailClient'

const apiCallMock = jest.fn()
const runMutation = jest.fn(async ({ operation }: { operation: () => Promise<void> }) => { await operation() })
const retryLastMutation = async () => false
let grantedFeatures: string[] = []

const translate = (key: string, a?: unknown, b?: unknown) => {
  const params = (typeof a === 'object' && a !== null ? a : typeof b === 'object' && b !== null ? b : null) as Record<string, unknown> | null
  return params ? `${key}|${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(',')}` : key
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation, retryLastMutation }),
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures }, isLoading: false, isReady: true, refresh: async () => {} }),
}))
jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  loadInjectionWidgetsForSpot: async () => [],
  getInjectionRegistryVersion: () => 1,
  subscribeToInjectionRegistryChanges: () => () => undefined,
}))
jest.mock('@open-mercato/core/modules/delivery_os/components/intake/BriefWizard', () => ({
  BriefWizard: () => <div data-testid="delivery-intake-wizard" />,
}))
jest.mock('@open-mercato/core/modules/delivery_os/components/stages/StageReview', () => ({
  StageReview: ({ stage }: { stage: { stageId: string } }) => <div data-testid={`delivery-stage-review-${stage.stageId}`} />,
}))

const flowFixture = flowStatusV1Schema.parse(JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../../../../lib/fixtures/flow/flow-status.v1.json'),
  'utf8',
)))
const projectId = flowFixture.projectId
const taskId = '33333333-3333-4333-8333-333333333333'
const now = '2026-09-19T10:00:00.000Z'

const project = {
  id: projectId,
  name: 'Flow header project',
  inputMode: 'from_brief',
  brief: 'Client pasted this request',
  targetProfileId: 'react-vite',
  targetProfileVersion: 1,
  repositoryRef: null,
  activeBaselineId: null,
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

const task = {
  id: taskId,
  projectId,
  baselineId: '22222222-2222-4222-8222-222222222222',
  title: 'Build the header',
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

function routeApiCalls(flow: FlowStatusV1): void {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/flow')) return { ok: true, status: 200, result: flow }
    if (url.endsWith('/tasks')) return { ok: true, status: 200, result: { items: [task], total: 1 } }
    if (url.endsWith('/baselines')) return { ok: true, status: 200, result: { items: [], total: 0 } }
    return { ok: true, status: 200, result: project }
  })
}

async function renderDetail(flow: FlowStatusV1 = flowFixture): Promise<void> {
  routeApiCalls(flow)
  render(<DeliveryProjectDetailClient params={{ id: projectId }} />)
  await screen.findByRole('heading', { name: project.name })
  await screen.findByTestId('delivery-flow-next-step')
}

function tab(key: string): HTMLElement {
  return screen.getByRole('tab', { name: new RegExp(`delivery_os\\.project\\.tabs\\.${key}`) })
}

beforeEach(() => {
  apiCallMock.mockReset()
  runMutation.mockClear()
  grantedFeatures = ['delivery_os.flow.manage', 'delivery_os.projects.manage']
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}`)
})

it('names the single next step and keeps its action reachable', async () => {
  await renderDetail()
  expect(screen.getByText('delivery_os.flow.nextStep.heading|action=delivery_os.flow.nextAction.approve_stage')).toBeTruthy()
  const action = screen.getByRole('button', { name: 'delivery_os.flow.nextAction.approve_stage' })
  expect(action.hasAttribute('disabled')).toBe(false)
  await act(async () => { action.click() })
  expect(screen.getByTestId('delivery-stage-review-key_visual')).toBeTruthy()
})

it('reads every blocker as a sentence that names its stage and opens it', async () => {
  await renderDetail()
  const blockers = screen.getByTestId('delivery-flow-blockers')
  expect(blockers.textContent).toContain('delivery_os.flow.blockers.atStage|reason=delivery_os.flow.blocker.decision_pending,stage=delivery_os.flow.stage.key_visual')
  const missingArtifact = screen.getByRole('button', { name: /blocker\.artifact_missing/ })
  await act(async () => { missingArtifact.click() })
  expect(screen.getByTestId('delivery-stage-review-design_system_ui')).toBeTruthy()
})

it('explains in prose why there is nothing to do instead of offering a dead button', async () => {
  await renderDetail({ ...flowFixture, blockers: [], nextAction: { kind: 'none', stageId: null } })
  expect(screen.getByRole('button', { name: 'delivery_os.flow.nextAction.none' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('delivery_os.flow.nextStep.disabled.none')).toBeTruthy()
  expect(screen.queryByTestId('delivery-flow-blockers')).toBeNull()
})

it('explains a missing flow permission instead of letting the operator press pin', async () => {
  grantedFeatures = ['delivery_os.projects.manage']
  await renderDetail({ ...flowFixture, template: null, nextAction: { kind: 'pin_template', stageId: null } })
  expect(screen.getByRole('button', { name: 'delivery_os.flow.nextAction.pin_template' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('delivery_os.flow.nextStep.disabled.noFlowPermission')).toBeTruthy()
  expect(runMutation).not.toHaveBeenCalled()
})

it('demotes the flow admin actions out of the primary row', async () => {
  await renderDetail({ ...flowFixture, template: null, nextAction: { kind: 'approve_stage', stageId: 'key_visual' } })
  const dropdown = screen.getByRole('button', { name: /delivery_os\.flow\.secondaryActions/ })
  await act(async () => { dropdown.click() })
  expect(screen.getByText('delivery_os.flow.nextAction.pin_template')).toBeTruthy()
  expect(screen.getByText('delivery_os.flow.materialize')).toBeTruthy()
})

it('sends the dispatch step to the tasks tab', async () => {
  await renderDetail({ ...flowFixture, blockers: [], nextAction: { kind: 'dispatch', stageId: null } })
  expect(tab('process').getAttribute('aria-selected')).toBe('true')
  await act(async () => { screen.getByRole('button', { name: 'delivery_os.flow.nextAction.dispatch' }).click() })
  expect(tab('tasks').getAttribute('aria-selected')).toBe('true')
})

it('opens the process tab on the stage a ?stage= deep link names', async () => {
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?stage=ux`)
  await renderDetail()
  expect(tab('process').getAttribute('aria-selected')).toBe('true')
  expect(screen.getByTestId('delivery-stage-review-ux')).toBeTruthy()
})

it('opens the tasks tab for a ?taskId= deep link', async () => {
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?taskId=${taskId}`)
  await renderDetail()
  expect(tab('tasks').getAttribute('aria-selected')).toBe('true')
  expect(await screen.findByTestId(`delivery-task-${taskId}`)).toBeTruthy()
})

it('opens the baseline tab for a ?baselineId= deep link', async () => {
  window.history.replaceState({}, '', `/backend/delivery/projects/${projectId}?baselineId=22222222-2222-4222-8222-222222222222`)
  await renderDetail()
  expect(tab('baseline').getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByTestId('delivery-project-overview')).toBeNull()
})
