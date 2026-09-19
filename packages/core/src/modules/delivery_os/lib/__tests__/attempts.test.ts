import {
  MAX_EXECUTION_ATTEMPTS,
  executionAttemptsSchema,
  type AttemptState,
  type ExecutionAttempt,
  type SourceRevision,
} from '../contracts'
import {
  checkAttemptOpen,
  claimAttempt,
  findAttempt,
  isArchiveBlocked,
  isAttemptActive,
  parseAttemptRegister,
  reconcileAttempt,
  recordAttemptResult,
  requestCancellation,
  reserveAttempt,
  type ReserveAttemptInput,
} from '../attempts'
import { hashCanonical } from '../hash'

const NOW = '2026-09-19T10:00:00.000Z'
const LATER = '2026-09-19T11:00:00.000Z'
const BASELINE_ID = '44444444-4444-4444-8444-444444444444'
const ACTOR_ID = '55555555-5555-4555-8555-555555555555'
const gitRevision: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
const snapshotRevision: SourceRevision = { kind: 'snapshot', contentHash: 'c'.repeat(64), externalWorkspaceId: 'wp-demo' }

function attemptId(index: number): string {
  return `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`
}

function payloadFor(revision: SourceRevision) {
  return { mode: 'manual_handoff', baseRevision: revision }
}

function buildAttempt(index: number, state: AttemptState, overrides: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
  const isClosed = state === 'closed'
  return {
    attemptId: attemptId(index),
    idempotencyKey: `key-${index}`,
    payloadHash: hashCanonical(payloadFor(gitRevision)),
    mode: 'manual_handoff',
    state,
    baselineId: BASELINE_ID,
    baselineHash: 'b'.repeat(64),
    baseRevision: gitRevision,
    baseCommit: gitRevision.kind === 'git' ? gitRevision.commitSha : null,
    reservedAt: NOW,
    claimedAt: state === 'claimed' ? NOW : null,
    workerRef: state === 'claimed' ? 'worker-1' : null,
    externalRunId: null,
    workflowRef: null,
    workflowStepId: null,
    dispatchedAt: null,
    cancellationRequestedAt: state === 'cancel_requested' ? NOW : null,
    stopConfirmation: state === 'cancel_requested' ? 'stop_unconfirmed' : null,
    reconciliation: null,
    resultEvidenceId: null,
    completionDelivery: null,
    lastDeliveryError: null,
    closedAt: isClosed ? NOW : null,
    outcome: isClosed ? 'not_started' : null,
    ...overrides,
  }
}

function reserveInput(index: number, overrides: Partial<ReserveAttemptInput> = {}): ReserveAttemptInput {
  return {
    idempotencyKey: `key-${index}`,
    payload: payloadFor(gitRevision),
    mode: 'manual_handoff',
    baselineId: BASELINE_ID,
    baselineHash: 'b'.repeat(64),
    baseRevision: gitRevision,
    now: NOW,
    newAttemptId: attemptId(index),
    ...overrides,
  }
}

function closedHistory(count: number): ExecutionAttempt[] {
  return Array.from({ length: count }, (_unused, index) => buildAttempt(index + 1, 'closed'))
}

function expectValidRegister(register: readonly ExecutionAttempt[]): void {
  expect(executionAttemptsSchema.safeParse(register).success).toBe(true)
}

function failureCode(result: { ok: boolean; body?: { code: string } }): string | null {
  return result.ok ? null : (result.body?.code ?? null)
}

describe('parseAttemptRegister', () => {
  it('treats a missing register as empty', () => {
    expect(parseAttemptRegister(null)).toEqual({ ok: true, register: [] })
    expect(parseAttemptRegister(undefined)).toEqual({ ok: true, register: [] })
  })

  it('accepts a valid register and rejects two active attempts', () => {
    expect(parseAttemptRegister([buildAttempt(1, 'closed'), buildAttempt(2, 'reserved')]).ok).toBe(true)
    const broken = parseAttemptRegister([buildAttempt(1, 'reserved'), buildAttempt(2, 'claimed')])
    expect(failureCode(broken)).toBe('attempt_active')
  })
})

describe('reserveAttempt', () => {
  it('creates a reserved attempt on an empty register', () => {
    const result = reserveAttempt([], reserveInput(1))
    expect(result.ok && result.outcome).toBe('created')
    if (!result.ok) return
    expect(result.attempt).toMatchObject({
      attemptId: attemptId(1),
      state: 'reserved',
      baseCommit: gitRevision.commitSha,
      payloadHash: hashCanonical(payloadFor(gitRevision)),
      reservedAt: NOW,
      claimedAt: null,
    })
    expect(result.register).toHaveLength(1)
    expectValidRegister(result.register)
  })

  it('derives a null baseCommit for a snapshot revision', () => {
    const result = reserveAttempt([], reserveInput(1, { baseRevision: snapshotRevision, payload: payloadFor(snapshotRevision) }))
    expect(result.ok && result.attempt.baseCommit).toBeNull()
  })

  it('returns the existing attempt for the same key and payload regardless of key order in the payload', () => {
    const first = reserveAttempt([], reserveInput(1))
    if (!first.ok) throw new Error('[internal] expected created')
    const replay = reserveAttempt(first.register, reserveInput(1, { payload: { baseRevision: gitRevision, mode: 'manual_handoff' }, newAttemptId: attemptId(2) }))
    expect(replay.ok && replay.outcome).toBe('existing')
    expect(replay.ok && replay.attempt.attemptId).toBe(attemptId(1))
    expect(replay.ok && replay.register).toHaveLength(1)
  })

  it('rejects the same key with another payload', () => {
    const result = reserveAttempt([buildAttempt(1, 'reserved')], reserveInput(1, { payload: payloadFor(snapshotRevision) }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.outcome).toBe('conflict')
    expect(failureCode(result)).toBe('idempotency_conflict')
    expect(!result.ok && result.status).toBe(409)
  })

  it('keeps the conflict for a reused key after its attempt closed, and rejects a payload that cannot be hashed', () => {
    const result = reserveAttempt([buildAttempt(1, 'closed')], reserveInput(1, { payload: payloadFor(snapshotRevision) }))
    expect(failureCode(result)).toBe('idempotency_conflict')
    expect(failureCode(reserveAttempt([], reserveInput(1, { payload: undefined })))).toBe('validation_failed')
  })

  it.each<[string, ExecutionAttempt[]]>([
    ['an active attempt', [buildAttempt(1, 'claimed')]],
    ['a full register', closedHistory(MAX_EXECUTION_ATTEMPTS)],
    ['an unknown attempt', [buildAttempt(1, 'reconciliation_required')]],
    ['a closed attempt', [buildAttempt(1, 'closed')]],
  ])('keeps a replay of the winning key successful with %s', (_label, register) => {
    const result = reserveAttempt(register, reserveInput(1))
    expect(result.ok && result.outcome).toBe('existing')
  })

  it.each<AttemptState>(['reserved', 'claimed', 'cancel_requested'])('rejects a second attempt while one is %s', (state) => {
    const result = reserveAttempt([buildAttempt(1, state)], reserveInput(2))
    expect(failureCode(result)).toBe('attempt_active')
  })

  it('allows a new attempt after the previous one closed or received a result', () => {
    const register = [buildAttempt(1, 'closed'), buildAttempt(2, 'result_received')]
    const result = reserveAttempt(register, reserveInput(3))
    expect(result.ok && result.outcome).toBe('created')
    if (result.ok) expectValidRegister(result.register)
  })

  it('accepts the 16th attempt and rejects the 17th without trimming history', () => {
    const fifteen = closedHistory(MAX_EXECUTION_ATTEMPTS - 1)
    const sixteenth = reserveAttempt(fifteen, reserveInput(MAX_EXECUTION_ATTEMPTS))
    expect(sixteenth.ok && sixteenth.register).toHaveLength(MAX_EXECUTION_ATTEMPTS)

    const full = closedHistory(MAX_EXECUTION_ATTEMPTS)
    const seventeenth = reserveAttempt(full, reserveInput(MAX_EXECUTION_ATTEMPTS + 1))
    expect(failureCode(seventeenth)).toBe('attempt_limit_reached')
    expect(full).toHaveLength(MAX_EXECUTION_ATTEMPTS)
  })

  it('blocks a new attempt while another one is unknown, before the active and limit checks', () => {
    const register = [...closedHistory(MAX_EXECUTION_ATTEMPTS - 1), buildAttempt(MAX_EXECUTION_ATTEMPTS, 'reconciliation_required')]
    const result = reserveAttempt(register, reserveInput(MAX_EXECUTION_ATTEMPTS + 1))
    expect(failureCode(result)).toBe('reconciliation_required')
  })

  it('rejects malformed input instead of storing it', () => {
    expect(failureCode(reserveAttempt([], reserveInput(1, { idempotencyKey: 'has space' })))).toBe('validation_failed')
    expect(failureCode(reserveAttempt([], reserveInput(1, { newAttemptId: 'not-a-uuid' })))).toBe('validation_failed')
    const reused = reserveAttempt([buildAttempt(1, 'closed')], reserveInput(2, { newAttemptId: attemptId(1) }))
    expect(failureCode(reused)).toBe('validation_failed')
  })

  it('does not mutate the input register', () => {
    const register = Object.freeze([Object.freeze(buildAttempt(1, 'closed'))])
    const result = reserveAttempt(register, reserveInput(2))
    expect(result.ok).toBe(true)
    expect(register).toHaveLength(1)
  })
})

describe('claimAttempt', () => {
  it('claims a reserved attempt exactly once', () => {
    const register = [buildAttempt(1, 'reserved')]
    const claimed = claimAttempt(register, { attemptId: attemptId(1), workerRef: 'worker-1', now: LATER })
    expect(claimed.ok && claimed.alreadyClaimed).toBe(false)
    if (!claimed.ok) return
    expect(claimed.attempt).toMatchObject({ state: 'claimed', claimedAt: LATER, workerRef: 'worker-1' })
    expect(register[0].state).toBe('reserved')
    expectValidRegister(claimed.register)

    const again = claimAttempt(claimed.register, { attemptId: attemptId(1), workerRef: 'worker-1', now: '2026-09-19T12:00:00.000Z' })
    expect(again.ok && again.alreadyClaimed).toBe(true)
    expect(again.ok && again.attempt.claimedAt).toBe(LATER)

    const other = claimAttempt(claimed.register, { attemptId: attemptId(1), workerRef: 'worker-2', now: LATER })
    expect(failureCode(other)).toBe('attempt_active')
  })

  it.each<[AttemptState, Partial<ExecutionAttempt>, string]>([
    ['cancel_requested', {}, 'attempt_cancelled'],
    ['closed', { outcome: 'cancelled' }, 'attempt_cancelled'],
    ['closed', {}, 'attempt_closed'],
    ['result_received', {}, 'attempt_closed'],
    ['reconciliation_required', {}, 'reconciliation_required'],
  ])('rejects a claim on a %s attempt', (state, overrides, code) => {
    const result = claimAttempt([buildAttempt(1, state, overrides)], { attemptId: attemptId(1), workerRef: 'worker-1', now: LATER })
    expect(failureCode(result)).toBe(code)
  })

  it('answers attempt_not_found for a foreign attempt id', () => {
    const result = claimAttempt([buildAttempt(1, 'reserved')], { attemptId: attemptId(9), workerRef: 'worker-1', now: LATER })
    expect(failureCode(result)).toBe('attempt_not_found')
    expect(!result.ok && result.status).toBe(404)
    expect(failureCode(checkAttemptOpen(undefined))).toBe('attempt_not_found')
  })

  it('rejects an empty workerRef', () => {
    const result = claimAttempt([buildAttempt(1, 'reserved')], { attemptId: attemptId(1), workerRef: '', now: LATER })
    expect(failureCode(result)).toBe('validation_failed')
  })
})

describe('requestCancellation', () => {
  it.each<AttemptState>(['reserved', 'claimed'])('records a cancellation request on a %s attempt without confirming the stop', (state) => {
    const result = requestCancellation([buildAttempt(1, state)], { attemptId: attemptId(1), now: LATER })
    expect(result.ok && result.alreadyRequested).toBe(false)
    if (!result.ok) return
    expect(result.attempt).toMatchObject({
      state: 'cancel_requested',
      cancellationRequestedAt: LATER,
      stopConfirmation: 'stop_unconfirmed',
      closedAt: null,
      outcome: null,
    })
    expect(isAttemptActive(result.attempt)).toBe(true)
    expectValidRegister(result.register)
  })

  it('is idempotent and keeps the first request time', () => {
    const result = requestCancellation([buildAttempt(1, 'cancel_requested')], { attemptId: attemptId(1), now: LATER })
    expect(result.ok && result.alreadyRequested).toBe(true)
    expect(result.ok && result.attempt.cancellationRequestedAt).toBe(NOW)
  })

  it.each<AttemptState>(['closed', 'result_received', 'reconciliation_required'])('rejects a %s attempt', (state) => {
    const result = requestCancellation([buildAttempt(1, state)], { attemptId: attemptId(1), now: LATER })
    expect(failureCode(result)).toBe('attempt_not_active')
  })

  it('answers attempt_not_found for a foreign attempt id', () => {
    expect(failureCode(requestCancellation([], { attemptId: attemptId(1), now: LATER }))).toBe('attempt_not_found')
  })
})

describe('reconcileAttempt', () => {
  const observation = { attemptId: attemptId(1), note: 'Checked the runner by hand', observedAt: NOW, actorUserId: ACTOR_ID, now: LATER }

  it.each<['not_started' | 'stopped', AttemptState, ExecutionAttempt['outcome'], ExecutionAttempt['stopConfirmation']]>([
    ['not_started', 'reserved', 'not_started', null],
    ['stopped', 'claimed', 'stopped', 'stopped'],
    ['not_started', 'cancel_requested', 'cancelled', 'stop_unconfirmed'],
    ['stopped', 'cancel_requested', 'cancelled', 'stopped'],
  ])('closes the attempt for %s observed on a %s attempt', (resolution, state, outcome, stopConfirmation) => {
    const register = Object.freeze([Object.freeze(buildAttempt(1, state))])
    const result = reconcileAttempt(register, { ...observation, resolution })
    expect(result.ok && result.taskEffect).toBe('release_task')
    if (!result.ok) return
    expect(result.attempt).toMatchObject({ state: 'closed', outcome, closedAt: LATER, stopConfirmation })
    expect(failureCode(checkAttemptOpen(result.attempt))).toBe(outcome === 'cancelled' ? 'attempt_cancelled' : 'attempt_closed')
    expect(result.attempt.reconciliation).toMatchObject({ resolution, resolvedAt: LATER, actorUserId: ACTOR_ID })
    expect(isArchiveBlocked(result.register)).toBe(false)
    expectValidRegister(result.register)
  })

  it('only waits for the manifest on completed and never closes or accepts the result', () => {
    const result = reconcileAttempt([buildAttempt(1, 'claimed')], { ...observation, resolution: 'completed', externalRunId: 'run-42' })
    expect(result.ok && result.taskEffect).toBe('await_manifest')
    if (!result.ok) return
    expect(result.attempt).toMatchObject({ state: 'claimed', outcome: null, closedAt: null, resultEvidenceId: null, externalRunId: 'run-42' })
    expect(result.attempt.reconciliation?.resolution).toBe('completed')
    expect(isArchiveBlocked(result.register)).toBe(true)
  })

  it('keeps an unknown attempt unknown after completed until a manifest is accepted', () => {
    const result = reconcileAttempt([buildAttempt(1, 'reconciliation_required')], { ...observation, resolution: 'completed' })
    expect(result.ok && result.attempt.state).toBe('reconciliation_required')
    expect(result.ok && failureCode(reserveAttempt(result.register, reserveInput(2)))).toBe('reconciliation_required')
  })

  it('flags unknown, which blocks a new reserve and the archive until it is resolved', () => {
    const unknown = reconcileAttempt([buildAttempt(1, 'claimed')], { ...observation, resolution: 'unknown' })
    expect(unknown.ok && unknown.taskEffect).toBe('block_task')
    if (!unknown.ok) return
    expect(unknown.attempt.state).toBe('reconciliation_required')
    expect(isAttemptActive(unknown.attempt)).toBe(false)
    expect(isArchiveBlocked(unknown.register)).toBe(true)
    expect(failureCode(reserveAttempt(unknown.register, reserveInput(2)))).toBe('reconciliation_required')
    expectValidRegister(unknown.register)

    const resolved = reconcileAttempt(unknown.register, { ...observation, resolution: 'stopped' })
    expect(resolved.ok && resolved.attempt.state).toBe('closed')
    if (!resolved.ok) return
    expect(isArchiveBlocked(resolved.register)).toBe(false)
    expect(reserveAttempt(resolved.register, reserveInput(2)).ok).toBe(true)
  })

  it('accepts a corrected observation after completed; the last record wins', () => {
    const completed = reconcileAttempt([buildAttempt(1, 'claimed')], { ...observation, resolution: 'completed' })
    if (!completed.ok) throw new Error('[internal] expected completed')
    const corrected = reconcileAttempt(completed.register, { ...observation, resolution: 'unknown' })
    expect(corrected.ok && corrected.attempt.state).toBe('reconciliation_required')
    expect(corrected.ok && corrected.attempt.reconciliation?.resolution).toBe('unknown')
  })

  it.each<AttemptState>(['closed', 'result_received'])('rejects a %s attempt', (state) => {
    const result = reconcileAttempt([buildAttempt(1, state)], { ...observation, resolution: 'stopped' })
    expect(failureCode(result)).toBe('attempt_not_reconcilable')
  })

  it('rejects an empty note and a foreign attempt id', () => {
    expect(failureCode(reconcileAttempt([buildAttempt(1, 'claimed')], { ...observation, resolution: 'stopped', note: '' }))).toBe('validation_failed')
    expect(failureCode(reconcileAttempt([], { ...observation, resolution: 'stopped' }))).toBe('attempt_not_found')
  })
})

describe('isArchiveBlocked', () => {
  it('is blocked by active and unknown attempts only', () => {
    expect(isArchiveBlocked([])).toBe(false)
    expect(isArchiveBlocked([buildAttempt(1, 'closed'), buildAttempt(2, 'result_received')])).toBe(false)
    expect(isArchiveBlocked([buildAttempt(1, 'reserved')])).toBe(true)
    expect(isArchiveBlocked([buildAttempt(1, 'cancel_requested')])).toBe(true)
    expect(isArchiveBlocked([buildAttempt(1, 'reconciliation_required')])).toBe(true)
    expect(findAttempt([buildAttempt(1, 'closed')], attemptId(1))?.state).toBe('closed')
  })
})

describe('recordAttemptResult', () => {
  const EVIDENCE_ID = '6b6b6b6b-6666-4666-8666-666666666666'
  const input = { attemptId: attemptId(1), evidenceId: EVIDENCE_ID, externalRunId: 'run-from-manifest' }

  it('marks the attempt result_received without a pending delivery when no workflow is linked', () => {
    const register = [buildAttempt(1, 'claimed')]
    const result = recordAttemptResult(register, input)
    if (!result.ok) throw new Error('[internal] expected a recorded result')
    expect(result.attempt).toMatchObject({
      state: 'result_received',
      resultEvidenceId: EVIDENCE_ID,
      externalRunId: 'run-from-manifest',
      completionDelivery: null,
      closedAt: null,
      outcome: null,
    })
    expect(register[0].state).toBe('claimed')
    expectValidRegister(result.register)
    expect(isAttemptActive(result.attempt)).toBe(false)
  })

  it('sets the pending delivery only with a workflowRef and keeps a known externalRunId', () => {
    const linked = buildAttempt(1, 'claimed', { workflowRef: 'wf-instance-1', workflowStepId: 'wait-result', externalRunId: 'run-known' })
    const result = recordAttemptResult([linked], input)
    expect(result.ok && result.attempt.completionDelivery).toBe('pending')
    expect(result.ok && result.attempt.externalRunId).toBe('run-known')
  })

  it('rejects cancelled, unknown, closed and missing attempts', () => {
    expect(failureCode(recordAttemptResult([buildAttempt(1, 'cancel_requested')], input))).toBe('attempt_cancelled')
    expect(failureCode(recordAttemptResult([buildAttempt(1, 'reconciliation_required')], input))).toBe('reconciliation_required')
    expect(failureCode(recordAttemptResult([buildAttempt(1, 'closed')], input))).toBe('attempt_closed')
    expect(failureCode(recordAttemptResult([buildAttempt(1, 'closed', { outcome: 'cancelled' })], input))).toBe('attempt_cancelled')
    expect(failureCode(recordAttemptResult([buildAttempt(1, 'result_received')], input))).toBe('attempt_closed')
    expect(failureCode(recordAttemptResult([], input))).toBe('attempt_not_found')
  })
})
