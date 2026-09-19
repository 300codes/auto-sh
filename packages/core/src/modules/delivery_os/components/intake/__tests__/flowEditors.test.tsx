/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { BriefWizard } from '../BriefWizard'
import { StageReview } from '../../stages/StageReview'
import { loadIntakeFixture, loadStageArtifactFixture, loadFlowStatusFixture } from '../../../lib/fixtures/flow'
import type { IntakeResponse } from '../../../lib/contracts'

const read = jest.fn()
const write = jest.fn()
const headers = jest.fn()
const translate = (key: string) => key
let forms: Record<string, { initialValues: Record<string, unknown>; onSubmit: (values: Record<string, unknown>) => Promise<void> }> = {}
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => read(...args), apiCallOrThrow: (...args: unknown[]) => write(...args), withScopedApiRequestHeaders: (value: unknown, operation: () => Promise<unknown>) => { headers(value); return operation() } }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: (props: { entityId?: string; initialValues: Record<string, unknown>; onSubmit: (values: Record<string, unknown>) => Promise<void> }) => { forms[props.entityId ?? 'form'] = props; return <div data-testid={`form-${props.entityId}`} /> } }))
const now = '2026-09-19T10:00:00.000Z'
const actorId = '99999999-9999-4999-8999-999999999999'
const onChanged = jest.fn(async () => undefined)
const intake = loadIntakeFixture()
const response: IntakeResponse = { intake, updatedAt: now, targetProfile: { profileId: 'wordpress-theme', profileVersion: 1 } }

beforeEach(() => { forms = {}; read.mockReset(); write.mockReset(); headers.mockClear(); write.mockResolvedValue({ ok: true, result: {} }); onChanged.mockClear() })

it('saves the intake version, retains unanswered questions and resumes the stored step after remount', async () => {
  read.mockResolvedValue({ ok: true, result: response })
  const view = render(<BriefWizard projectId={intake.projectId} projectUpdatedAt="2026-09-19T09:00:00.000Z" actorUserId={actorId} canManage canImport={false} onChanged={onChanged} />)
  await screen.findByTestId('delivery-brief-wizard')
  const form = forms['delivery_os:intake']
  await act(async () => { await form.onSubmit({ ...form.initialValues, businessGoal: 'New business goal', step: intake.step }) })
  expect(headers).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': now })
  const payload = JSON.parse(write.mock.calls[0][1].body)
  expect(payload.brief.businessGoal).toBe('New business goal')
  expect(payload.questions).toHaveLength(intake.questions.length)
  expect(payload).not.toHaveProperty('proposals')
  view.unmount()
  render(<BriefWizard projectId={intake.projectId} projectUpdatedAt={now} actorUserId={actorId} canManage canImport={false} onChanged={onChanged} />)
  await screen.findByTestId('delivery-brief-wizard')
  expect(forms['delivery_os:intake'].initialValues.step).toBe(intake.step)
  expect(write).toHaveBeenCalledTimes(1)
})

function seedStage() {
  const flow = loadFlowStatusFixture()
  const stage = flow.stages[0]
  const content = loadStageArtifactFixture('scope')
  const artifact = { artifactId: stage.currentArtifact!.artifactId, projectId: flow.projectId, stageId: 'scope', version: 1, contentHash: stage.currentArtifact!.contentHash, source: 'manual', content: content.content, dependsOn: [], attachmentIds: [], templateHash: flow.template!.hash, createdBy: actorId, createdAt: now }
  read.mockImplementation(async (url: string) => ({ ok: true, result: { items: url.includes('/artifacts') ? [artifact, { ...artifact, artifactId: actorId, version: 0 + 2 }] : [], total: url.includes('/artifacts') ? 2 : 0 } }))
  return { flow, stage, artifact }
}

it('requires client proof and submits a hash-bound decision with a replay-stable body after a timeout', async () => {
  const { flow, stage } = seedStage()
  render(<StageReview projectId={flow.projectId} stage={stage} updatedAt={now} canManage={false} canApprove onChanged={onChanged} />)
  await screen.findByTestId('delivery-stage-scope')
  await act(async () => { screen.getByRole('button', { name: 'delivery_os.flow.recordDecision' }).click() })
  const form = forms['delivery_os:project']
  await expect(form.onSubmit({ verdict: 'approved' })).rejects.toBeDefined()
  expect(write).not.toHaveBeenCalled()
  const decision = { verdict: 'approved', approverName: 'Client reviewer', evidenceKind: 'email', evidenceReference: 'Approval message 123' }
  write.mockRejectedValueOnce(new Error('Connection lost'))
  await act(async () => { await expect(form.onSubmit(decision)).rejects.toThrow('Connection lost') })
  await act(async () => { await form.onSubmit(decision) })
  expect(write.mock.calls[1][1]).toEqual(write.mock.calls[0][1])
  expect(JSON.parse(write.mock.calls[1][1].body)).toMatchObject({ artifactId: stage.currentArtifact!.artifactId, subjectHash: stage.currentArtifact!.contentHash, subjectVersion: 1 })
  expect(headers).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': now })
})

it('does not offer decisions for a historical version or a stale current stage', async () => {
  const { flow, stage } = seedStage()
  const view = render(<StageReview projectId={flow.projectId} stage={stage} updatedAt={now} canManage={false} canApprove onChanged={onChanged} />)
  await screen.findByTestId('delivery-stage-history')
  const versions = screen.getAllByRole('button', { name: 'delivery_os.flow.version' })
  await act(async () => { versions[1].click() })
  expect(screen.queryByRole('button', { name: 'delivery_os.flow.recordDecision' })).toBeNull()
  expect(screen.getByText('delivery_os.flow.historyReadOnly')).toBeTruthy()
  view.unmount()
  render(<StageReview projectId={flow.projectId} stage={{ ...stage, currency: 'stale' }} updatedAt={now} canManage={false} canApprove onChanged={onChanged} />)
  await screen.findByTestId('delivery-stage-history')
  expect(screen.queryByRole('button', { name: 'delivery_os.flow.recordDecision' })).toBeNull()
})

it('preserves existing tools when saving unrelated brief fields and changes them only on explicit manual-tool confirmation', async () => {
  const tools: IntakeResponse['intake']['tools'] = [
    { stageId: 'ux', kind: 'design', ref: 'figma', rationale: 'Existing choice' },
    { stageId: 'implementation', kind: 'execution', ref: 'manual_handoff', rationale: 'Existing handoff' },
  ]
  read.mockResolvedValue({ ok: true, result: { ...response, intake: { ...intake, tools } } })
  render(<BriefWizard projectId={intake.projectId} projectUpdatedAt={now} actorUserId={actorId} canManage canImport={false} onChanged={onChanged} />)
  await screen.findByTestId('delivery-brief-wizard')
  const form = forms['delivery_os:intake']
  expect(form.initialValues.confirmManualTools).toBe(false)
  await act(async () => { await form.onSubmit({ ...form.initialValues, businessGoal: 'Brief updated without changing tools' }) })
  expect(JSON.parse(write.mock.calls[0][1].body).tools).toEqual(tools)
  await act(async () => { await form.onSubmit({ ...form.initialValues, confirmManualTools: true }) })
  expect(JSON.parse(write.mock.calls[1][1].body).tools).toEqual([
    { stageId: 'ux', kind: 'design', ref: 'manual_upload', rationale: null },
    { stageId: 'implementation', kind: 'execution', ref: 'manual_handoff', rationale: null },
  ])
})
