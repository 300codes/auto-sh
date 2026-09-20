/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { StageReview } from '../StageReview'
import { parseStageArtifactDocument, resolveStageContent } from '../artifactContent'
import { loadFlowStatusFixture, loadStageArtifactFixture } from '../../../lib/fixtures/flow'

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

function seedStage() {
  const flow = loadFlowStatusFixture()
  const stage = flow.stages[0]
  const content = loadStageArtifactFixture('scope')
  const artifact = { artifactId: stage.currentArtifact!.artifactId, projectId: flow.projectId, stageId: 'scope', version: 1, contentHash: stage.currentArtifact!.contentHash, source: 'manual', content: content.content, dependsOn: [], attachmentIds: [], templateHash: flow.template!.hash, createdBy: actorId, createdAt: now }
  read.mockImplementation(async (url: string) => ({ ok: true, result: url.includes('/artifacts') ? { items: [artifact], total: 1 } : { items: [], total: 0 } }))
  return { flow, stage, content }
}

beforeEach(() => { forms = {}; read.mockReset(); write.mockReset(); headers.mockClear(); write.mockResolvedValue({ ok: true, result: {} }); onChanged.mockClear() })

it('renders the approved content as readable sections instead of a document field', async () => {
  const { flow, stage } = seedStage()
  render(<StageReview projectId={flow.projectId} stage={stage} updatedAt={now} canManage canApprove onChanged={onChanged} />)
  await screen.findByTestId('delivery-stage-scope')
  expect(screen.getByTestId('delivery-stage-scope-content')).toBeTruthy()
  expect(screen.getByText('Marketing site with an online booking form for a dog grooming salon.')).toBeTruthy()
  expect(screen.getByText('Every seeded service renders with name and price.')).toBeTruthy()
  expect(screen.queryByTestId('form-delivery_os:project')).toBeNull()
})

it('presents an AI draft for reading and submits the envelope the agent produced', async () => {
  const { flow, stage, content } = seedStage()
  const draft = { ...content, projectId: flow.projectId, stageId: 'scope', source: 'agent' }
  render(<StageReview projectId={flow.projectId} stage={stage} updatedAt={now} canManage canApprove onChanged={onChanged} />)
  await screen.findByTestId('delivery-stage-scope')
  read.mockImplementationOnce(async () => ({ ok: true, result: { artifact: draft } }))
  await act(async () => { screen.getByRole('button', { name: 'delivery_os.flow.artifact.draft' }).click() })
  const review = await screen.findByTestId('delivery-stage-draft-review')
  expect(review.querySelector('[data-testid="delivery-stage-scope-content"]')).toBeTruthy()
  const form = forms['delivery_os:project']
  expect(form.initialValues).not.toHaveProperty('artifact')
  await act(async () => { await form.onSubmit({}) })
  expect(headers).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': now })
  const [url, options] = write.mock.calls[0]
  expect(url).toContain('/stages/scope/artifacts')
  expect(options.headers).not.toHaveProperty('Idempotency-Key')
  expect(JSON.parse(options.body)).toEqual(draft)
})

it('refuses a pasted document that names another project and accepts a matching one', () => {
  const { flow, content } = seedStage()
  expect(parseStageArtifactDocument('{', flow.projectId, 'scope')).toEqual({ ok: false, reason: 'json' })
  expect(parseStageArtifactDocument(JSON.stringify({ ...content, source: 'manual', projectId: actorId }), flow.projectId, 'scope')).toEqual({ ok: false, reason: 'document' })
  expect(parseStageArtifactDocument(JSON.stringify({ ...content, source: 'intake' }), flow.projectId, 'scope')).toEqual({ ok: false, reason: 'document' })
  const accepted = parseStageArtifactDocument(JSON.stringify({ ...content, source: 'manual' }), flow.projectId, 'scope')
  expect(accepted.ok).toBe(true)
})

it('names an unreadable payload instead of rendering an empty section', () => {
  expect(resolveStageContent({ summary: 'only a summary' })).toEqual({ kind: 'unreadable' })
  expect(resolveStageContent(loadStageArtifactFixture('ux').content).kind).toBe('design')
})
