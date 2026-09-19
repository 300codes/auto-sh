/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  loadAttemptRegisterFixture,
  loadResultManifestFixture,
} from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import { ReconcileAttemptDialog } from '../ReconcileAttemptDialog'
import { buildReconcileRequest, emptyReconcileDraft } from '../reconcileInput'

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
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))

const manifest = loadResultManifestFixture()
const unresolved = loadAttemptRegisterFixture('reconciliation-required')
const taskId = '33333333-3333-4333-8333-333333333333'
const attemptId = unresolved.executionAttempts[1].attemptId
const now = '2026-09-19T10:00:00.000Z'
const observedAtLocal = '2026-09-19T13:45'

function reconcileResponse(resolution: string) {
  return {
    ok: true,
    status: 200,
    result: {
      attemptId,
      resolution,
      taskStatus: resolution === 'completed' ? 'awaiting_review' : resolution === 'unknown' ? 'blocked' : 'ready',
      taskUpdatedAt: '2026-09-19T14:00:00.000Z',
    },
  }
}

function renderDialog() {
  const onReconciled = jest.fn()
  render(
    <ReconcileAttemptDialog
      open
      onOpenChange={jest.fn()}
      taskId={taskId}
      attemptId={attemptId}
      taskUpdatedAt={now}
      onReconciled={onReconciled}
    />,
  )
  return onReconciled
}

function fillEvidence(note = 'The runner host was rebuilt; the session log is gone.'): void {
  fireEvent.change(screen.getByTestId('reconcile-note'), { target: { value: note } })
  fireEvent.change(screen.getByTestId('reconcile-observed-at'), { target: { value: observedAtLocal } })
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
})

describe('buildReconcileRequest', () => {
  it('refuses a reconciliation with no statement, because that is not evidence', () => {
    const draft = emptyReconcileDraft(observedAtLocal)
    expect(buildReconcileRequest(draft)).toEqual({ ok: false, field: 'note', reason: 'required' })
  })

  it('refuses a missing observation time', () => {
    const draft = { ...emptyReconcileDraft(''), note: 'Nothing ran.' }
    expect(buildReconcileRequest(draft)).toEqual({ ok: false, field: 'observedAt', reason: 'required' })
  })

  it.each(['not_started', 'stopped', 'unknown'] as const)('builds %s from a note and a time alone', (resolution) => {
    const built = buildReconcileRequest({ ...emptyReconcileDraft(observedAtLocal), resolution, note: 'Observed.' })
    expect(built.ok).toBe(true)
    if (!built.ok) throw new Error('[internal] expected a request')
    expect(built.body.resolution).toBe(resolution)
    expect(built.body.manifest).toBeUndefined()
    expect(built.body.externalEvidence.observedAt).toBe(new Date(observedAtLocal).toISOString())
  })

  it('blocks completed without a manifest before the server can answer manifest_required', () => {
    const draft = { ...emptyReconcileDraft(observedAtLocal), resolution: 'completed' as const, note: 'It finished.' }
    expect(buildReconcileRequest(draft)).toEqual({ ok: false, field: 'manifest', reason: 'required' })
  })

  it('carries the manifest for completed and names its failing fields when it is wrong', () => {
    const ok = buildReconcileRequest({
      ...emptyReconcileDraft(observedAtLocal),
      resolution: 'completed',
      note: 'It finished.',
      manifestRaw: JSON.stringify(manifest),
    })
    expect(ok).toMatchObject({ ok: true, body: { resolution: 'completed', manifest } })

    const broken = buildReconcileRequest({
      ...emptyReconcileDraft(observedAtLocal),
      resolution: 'completed',
      note: 'It finished.',
      manifestRaw: JSON.stringify({ ...manifest, taskId: 'not-a-uuid' }),
    })
    expect(broken).toMatchObject({ ok: false, field: 'manifest', reason: 'manifestInvalid' })
    if (broken.ok) throw new Error('[internal] expected a refusal')
    expect(broken.issues?.some((issue) => issue.path === 'taskId')).toBe(true)
  })

  it('omits an empty external run id rather than sending a blank string', () => {
    const built = buildReconcileRequest({ ...emptyReconcileDraft(observedAtLocal), note: 'Observed.', externalRunId: '  ' })
    if (!built.ok) throw new Error('[internal] expected a request')
    expect('externalRunId' in built.body.externalEvidence).toBe(false)
  })
})

describe('ReconcileAttemptDialog — four resolutions', () => {
  it('offers exactly the four resolutions the domain defines', () => {
    renderDialog()
    for (const resolution of ['not_started', 'stopped', 'completed', 'unknown']) {
      expect(screen.getByTestId(`reconcile-resolution-${resolution}`)).toBeTruthy()
    }
  })

  it.each(['not_started', 'stopped', 'unknown'] as const)('records %s with the evidence and no manifest', async (resolution) => {
    apiCallMock.mockResolvedValue(reconcileResponse(resolution))
    const onReconciled = renderDialog()
    fireEvent.click(screen.getByTestId(`reconcile-resolution-${resolution}`))
    fillEvidence()
    fireEvent.click(screen.getByTestId('reconcile-submit'))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [path, init] = apiCallMock.mock.calls[0] as [string, { body: string }]
    expect(path).toBe(`/api/delivery_os/tasks/${taskId}/attempts/${attemptId}/reconcile`)
    expect(JSON.parse(init.body)).toMatchObject({ resolution })
    expect(JSON.parse(init.body).manifest).toBeUndefined()
    await waitFor(() => expect(onReconciled).toHaveBeenCalledWith('2026-09-19T14:00:00.000Z'))
  })

  it('shows the manifest field only for completed, and does not send without it', () => {
    renderDialog()
    expect(screen.queryByTestId('reconcile-manifest')).toBeNull()
    fireEvent.click(screen.getByTestId('reconcile-resolution-completed'))
    expect(screen.getByTestId('reconcile-manifest')).toBeTruthy()
    fillEvidence('The run finished on the other host.')
    fireEvent.click(screen.getByTestId('reconcile-submit'))
    expect(screen.getByTestId('reconcile-problem').textContent).toBe('delivery_os.task.reconcile.error.manifestRequired')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('reuses the result-import parser so a completed reconciliation carries a validated manifest', async () => {
    apiCallMock.mockResolvedValue(reconcileResponse('completed'))
    renderDialog()
    fireEvent.click(screen.getByTestId('reconcile-resolution-completed'))
    fillEvidence('The run finished on the other host.')
    fireEvent.change(screen.getByTestId('reconcile-manifest'), { target: { value: JSON.stringify(manifest) } })
    fireEvent.click(screen.getByTestId('reconcile-submit'))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(JSON.parse((apiCallMock.mock.calls[0][1] as { body: string }).body).manifest).toEqual(manifest)
  })

  it('presents unknown as a recorded decision rather than a failure', async () => {
    apiCallMock.mockResolvedValue(reconcileResponse('unknown'))
    renderDialog()
    fireEvent.click(screen.getByTestId('reconcile-resolution-unknown'))
    fillEvidence()
    fireEvent.click(screen.getByTestId('reconcile-submit'))
    await waitFor(() => expect(flashMock).toHaveBeenCalled())
    expect(flashMock.mock.calls[0][0]).toBe('delivery_os.task.reconcile.recorded.unknown')
    expect(flashMock.mock.calls[0][1]).toBe('warning')
  })
})

describe('ReconcileAttemptDialog — refusals stay disjoint', () => {
  it.each([
    ['attempt_not_reconcilable', 'delivery_os.task.reconcile.error.attemptNotReconcilable'],
    ['attempt_not_active', 'delivery_os.task.reconcile.error.attemptNotActive'],
    ['result_conflict', 'delivery_os.task.reconcile.error.resultConflict'],
  ])('names %s with its own sentence', async (code, key) => {
    apiCallMock.mockResolvedValue({ ok: false, status: 409, result: { error: 'refused', code, details: [] } })
    renderDialog()
    fillEvidence()
    fireEvent.click(screen.getByTestId('reconcile-submit'))
    expect((await screen.findByTestId('reconcile-server-error')).textContent).toBe(key)
  })

  it('does not give attempt_not_reconcilable the wording of attempt_not_active', () => {
    expect('delivery_os.task.reconcile.error.attemptNotReconcilable')
      .not.toBe('delivery_os.task.reconcile.error.attemptNotActive')
  })

  it('renders every field the server named', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 422,
      result: {
        error: 'refused',
        code: 'path_not_allowed',
        details: [
          { path: 'manifest.changedPaths.1', code: 'outside_allowed_paths', message: 'package.json' },
          { path: 'manifest.changedPaths.2', code: 'outside_allowed_paths', message: '.github/workflows/deploy.yml' },
        ],
      },
    })
    renderDialog()
    fillEvidence()
    fireEvent.click(screen.getByTestId('reconcile-submit'))
    await screen.findByTestId('result-import-issues')
    expect(screen.getAllByTestId('result-import-issue')).toHaveLength(2)
  })
})
