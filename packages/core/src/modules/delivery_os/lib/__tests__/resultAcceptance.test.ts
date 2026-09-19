import { reconcileAttempt, recordAttemptResult, requestCancellation, reserveAttempt } from '../attempts'
import { type ExecutionAttempt, type TaskPackageV1 } from '../contracts'
import { loadNegativeDeliveryFixtures, loadResultManifestFixture, loadTaskPackageFixture } from '../fixtures'
import { hashCanonical } from '../hash'
import {
  RESULT_ACCEPTANCE_PENDING_CHECKS,
  evaluateResultAcceptance,
  type ResultAcceptanceInput,
  type ResultAcceptanceOutcome,
} from '../resultAcceptance'

const NOW = '2026-09-19T10:00:00.000Z'
const ACTOR_ID = '88888888-8888-4888-8888-888888888888'
const EVIDENCE_ID = '6b6b6b6b-6666-4666-8666-666666666666'

function reserve(taskPackage: TaskPackageV1): ExecutionAttempt {
  const result = reserveAttempt([], {
    idempotencyKey: taskPackage.idempotencyKey,
    payload: { mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
    mode: 'manual_handoff',
    baselineId: taskPackage.baselineId,
    baselineHash: taskPackage.baselineHash,
    baseRevision: taskPackage.baseRevision,
    now: NOW,
    newAttemptId: taskPackage.attemptId,
  })
  if (!result.ok) throw new Error('[internal] fixture reservation failed')
  return result.attempt
}

function reconcile(attempt: ExecutionAttempt, resolution: 'completed' | 'unknown' | 'stopped'): ExecutionAttempt {
  const result = reconcileAttempt([attempt], {
    attemptId: attempt.attemptId,
    resolution,
    note: 'Checked the runner',
    observedAt: NOW,
    actorUserId: ACTOR_ID,
    now: NOW,
  })
  if (!result.ok) throw new Error('[internal] fixture reconciliation failed')
  return result.attempt
}

function cancel(attempt: ExecutionAttempt): ExecutionAttempt {
  const result = requestCancellation([attempt], { attemptId: attempt.attemptId, now: NOW })
  if (!result.ok) throw new Error('[internal] fixture cancellation failed')
  return result.attempt
}

function inputFor(variant: 'git' | 'snapshot' = 'git', overrides: Partial<ResultAcceptanceInput> = {}): ResultAcceptanceInput {
  const taskPackage = loadTaskPackageFixture(variant)
  return {
    manifestRaw: loadResultManifestFixture(variant),
    task: { id: taskPackage.taskId, allowedPaths: taskPackage.allowedPaths },
    attempt: reserve(taskPackage),
    taskPackage: { ok: true, taskPackage },
    existingResult: null,
    ...overrides,
  }
}

function expectFailure(outcome: ResultAcceptanceOutcome, status: number, code: string): void {
  expect(outcome.ok).toBe(false)
  if (outcome.ok) return
  expect(outcome.status).toBe(status)
  expect(outcome.body.code).toBe(code)
}

function negative(name: string): unknown {
  const fixture = loadNegativeDeliveryFixtures().find((entry) => entry.name === name)
  if (!fixture) throw new Error(`[internal] missing negative fixture ${name}`)
  return fixture.document
}

describe('evaluateResultAcceptance', () => {
  it('accepts the published manifest for the published package', () => {
    const outcome = evaluateResultAcceptance(inputFor())
    expect(outcome.ok && outcome.outcome).toBe('accept')
    if (!outcome.ok || outcome.outcome !== 'accept') return
    expect(outcome.manifestHash).toBe(hashCanonical(loadResultManifestFixture()))
  })

  it('rejects an unknown schemaVersion before anything else', () => {
    const manifestRaw = { ...loadResultManifestFixture(), schemaVersion: 'delivery.result-manifest/v2' }
    expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw, attempt: undefined })), 422, 'unsupported_schema_version')
  })

  it('does not accept another document type as a result', () => {
    expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw: loadTaskPackageFixture() })), 422, 'unsupported_schema_version')
  })

  it.each(['result-manifest.missing-check-fields', 'result-manifest.status-skipped'])('rejects the schema fixture %s', (name) => {
    const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: negative(name) }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.status).toBe(400)
  })

  it('answers attempt_not_found for a missing attempt', () => {
    expectFailure(evaluateResultAcceptance(inputFor('git', { attempt: undefined })), 404, 'attempt_not_found')
  })

  it('ignores tenant and organization keys inside the manifest', () => {
    const manifestRaw = { ...loadResultManifestFixture(), tenantId: 'other-tenant', organizationId: 'other-org' }
    const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw }))
    expect(outcome.ok && outcome.outcome).toBe('accept')
    if (!outcome.ok || outcome.outcome !== 'accept') return
    expect(outcome.manifestHash).toBe(hashCanonical(loadResultManifestFixture()))
    expect('tenantId' in outcome.manifest).toBe(false)
  })

  describe('idempotency runs before the attempt gate', () => {
    const storedHash = hashCanonical(loadResultManifestFixture())
    const existingResult = { evidenceId: EVIDENCE_ID, payloadHash: storedHash }

    function received(): ExecutionAttempt {
      const base = inputFor().attempt
      if (!base) throw new Error('[internal] missing attempt')
      const recorded = recordAttemptResult([base], { attemptId: base.attemptId, evidenceId: EVIDENCE_ID, externalRunId: 'run-1' })
      if (!recorded.ok) throw new Error('[internal] fixture record failed')
      return recorded.attempt
    }

    it('returns duplicate for the identical manifest on an attempt that already has the result', () => {
      const outcome = evaluateResultAcceptance(inputFor('git', { attempt: received(), existingResult }))
      expect(outcome).toEqual({ ok: true, outcome: 'duplicate', evidenceId: EVIDENCE_ID, manifestHash: storedHash })
    })

    it('duplicate beats attempt_closed and a package that can no longer be built', () => {
      const closed: ExecutionAttempt = { ...received(), state: 'closed', closedAt: NOW, outcome: 'result_accepted' }
      const brokenPackage = evaluateResultAcceptance(inputFor('git', { attempt: undefined })) as { ok: false; status: number; body: never }
      const outcome = evaluateResultAcceptance(inputFor('git', { attempt: closed, existingResult, taskPackage: brokenPackage }))
      expect(outcome.ok && outcome.outcome).toBe('duplicate')
    })

    it('answers result_conflict for different content', () => {
      const manifestRaw = { ...loadResultManifestFixture(), externalRunId: 'another-run' }
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw, attempt: received(), existingResult })), 409, 'result_conflict')
    })

    it('answers result_conflict when a manifest of another attempt targets an attempt with a result', () => {
      const manifestRaw = negative('result-manifest.foreign-attempt')
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw, attempt: received(), existingResult })), 409, 'result_conflict')
    })

    it('answers attempt_closed when the attempt has a result but no stored evidence was found', () => {
      expectFailure(evaluateResultAcceptance(inputFor('git', { attempt: received() })), 409, 'attempt_closed')
    })
  })

  describe('result gate', () => {
    it('rejects a late result after a cancellation request', () => {
      const attempt = cancel(reserve(loadTaskPackageFixture()))
      expectFailure(evaluateResultAcceptance(inputFor('git', { attempt })), 409, 'attempt_cancelled')
    })

    it('rejects a result for an attempt closed as cancelled', () => {
      const attempt = reconcile(cancel(reserve(loadTaskPackageFixture())), 'stopped')
      expect(attempt.outcome).toBe('cancelled')
      expectFailure(evaluateResultAcceptance(inputFor('git', { attempt })), 409, 'attempt_cancelled')
    })

    it('rejects a result while the external run is unknown', () => {
      const attempt = reconcile(reserve(loadTaskPackageFixture()), 'unknown')
      expectFailure(evaluateResultAcceptance(inputFor('git', { attempt })), 409, 'reconciliation_required')
    })

    it('accepts after a completed reconciliation of an unknown or cancel-requested attempt', () => {
      const unknownThenCompleted = reconcile(reconcile(reserve(loadTaskPackageFixture()), 'unknown'), 'completed')
      expect(unknownThenCompleted.state).toBe('reconciliation_required')
      expect(evaluateResultAcceptance(inputFor('git', { attempt: unknownThenCompleted })).ok).toBe(true)
      const cancelledThenCompleted = reconcile(cancel(reserve(loadTaskPackageFixture())), 'completed')
      expect(cancelledThenCompleted.state).toBe('cancel_requested')
      expect(evaluateResultAcceptance(inputFor('git', { attempt: cancelledThenCompleted })).ok).toBe(true)
    })
  })

  describe('correlation', () => {
    it('surfaces a package build failure only after the gate', () => {
      const failure = { ok: false as const, status: 422, body: { error: 'Stored baseline content does not match its hash', code: 'hash_mismatch' as const, details: [] } }
      expectFailure(evaluateResultAcceptance(inputFor('git', { taskPackage: failure })), 422, 'hash_mismatch')
    })

    it.each(['result-manifest.foreign-attempt', 'result-manifest.foreign-task'])('rejects %s with correlation_mismatch', (name) => {
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw: negative(name) })), 422, 'correlation_mismatch')
    })

    it('rejects a wrong baseline hash', () => {
      const manifestRaw = { ...loadResultManifestFixture(), baselineHash: 'f'.repeat(64) }
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw })), 422, 'baseline_mismatch')
    })

    it('rejects a wrong base commit', () => {
      const commitSha = 'b'.repeat(40)
      const manifestRaw = { ...loadResultManifestFixture(), baseRevision: { kind: 'git', commitSha }, baseCommit: commitSha }
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw })), 422, 'base_revision_mismatch')
    })

    it('rejects a wrong profile version', () => {
      const manifestRaw = { ...loadResultManifestFixture(), targetProfileVersion: 2 }
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw })), 422, 'correlation_mismatch')
    })

    it('rejects a snapshot result for react-vite with revision_kind_mismatch', () => {
      const manifestRaw = negative('result-manifest.snapshot-for-react')
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw })), 422, 'revision_kind_mismatch')
    })

    it('accepts a snapshot result for wordpress-theme', () => {
      const outcome = evaluateResultAcceptance(inputFor('snapshot'))
      expect(outcome.ok && outcome.outcome).toBe('accept')
    })
  })

  it('keeps the OSS-04 checks as named pass-through seams', () => {
    const taskPackage = loadTaskPackageFixture()
    const context = { manifest: loadResultManifestFixture(), task: { id: taskPackage.taskId, allowedPaths: [] }, taskPackage }
    expect(RESULT_ACCEPTANCE_PENDING_CHECKS).toHaveLength(3)
    expect(RESULT_ACCEPTANCE_PENDING_CHECKS.every((pendingCheck) => pendingCheck(context).ok)).toBe(true)
  })
})
