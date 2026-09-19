import {
  ACTIVE_ATTEMPT_STATES,
  MAX_EXECUTION_ATTEMPTS,
  buildDeliveryError,
  deliveryErrorFromZod,
  executionAttemptSchema,
  executionAttemptsSchema,
  type AttemptMode,
  type DeliveryCheckResult,
  type DeliveryErrorCode,
  type DeliveryErrorResult,
  type ExecutionAttempt,
  type ReconciliationResolution,
  type SourceRevision,
} from './contracts'
import { hashCanonical } from './hash'

export type AttemptRegister = readonly ExecutionAttempt[]

export type AttemptFailure = { ok: false } & DeliveryErrorResult

export type AttemptTaskEffect = 'release_task' | 'await_manifest' | 'block_task'

export type ReserveAttemptInput = {
  idempotencyKey: string
  payload: unknown
  mode: AttemptMode
  baselineId: string
  baselineHash: string
  baseRevision: SourceRevision
  now: string
  newAttemptId: string
}

export type ReserveAttemptResult =
  | { ok: true; outcome: 'created' | 'existing'; attempt: ExecutionAttempt; register: ExecutionAttempt[] }
  | ({ outcome: 'conflict' } & AttemptFailure)

export type ClaimAttemptInput = { attemptId: string; workerRef: string; now: string }

export type ClaimAttemptResult =
  | { ok: true; attempt: ExecutionAttempt; register: ExecutionAttempt[]; alreadyClaimed: boolean }
  | AttemptFailure

export type RequestCancellationInput = { attemptId: string; now: string }

export type RequestCancellationResult =
  | { ok: true; attempt: ExecutionAttempt; register: ExecutionAttempt[]; alreadyRequested: boolean }
  | AttemptFailure

export type ReconcileAttemptInput = {
  attemptId: string
  resolution: ReconciliationResolution
  note: string
  observedAt: string
  actorUserId: string
  now: string
  externalRunId?: string | null
}

export type ReconcileAttemptResult =
  | { ok: true; attempt: ExecutionAttempt; register: ExecutionAttempt[]; taskEffect: AttemptTaskEffect }
  | AttemptFailure

const RECONCILIATION_TASK_EFFECTS: Readonly<Record<ReconciliationResolution, AttemptTaskEffect>> = {
  not_started: 'release_task',
  stopped: 'release_task',
  completed: 'await_manifest',
  unknown: 'block_task',
}

function fail(code: DeliveryErrorCode, error: string, path: string, message: string): AttemptFailure {
  return { ok: false, ...buildDeliveryError(code, error, [{ path, code, message }]) }
}

function attemptNotFound(attemptId: string): AttemptFailure {
  return fail('attempt_not_found', 'Attempt not found', 'attemptId', `No attempt ${attemptId} on this task`)
}

function replaceAttempt(register: AttemptRegister, next: ExecutionAttempt): ExecutionAttempt[] {
  return register.map((attempt) => (attempt.attemptId === next.attemptId ? next : attempt))
}

function validateAttempt(candidate: ExecutionAttempt): { ok: true; attempt: ExecutionAttempt } | AttemptFailure {
  const parsed = executionAttemptSchema.safeParse(candidate)
  if (!parsed.success) return { ok: false, ...deliveryErrorFromZod(parsed.error) }
  return { ok: true, attempt: parsed.data }
}

export function parseAttemptRegister(raw: unknown): { ok: true; register: ExecutionAttempt[] } | AttemptFailure {
  if (raw === null || raw === undefined) return { ok: true, register: [] }
  const parsed = executionAttemptsSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, ...deliveryErrorFromZod(parsed.error) }
  return { ok: true, register: parsed.data }
}

export function isAttemptActive(attempt: ExecutionAttempt): boolean {
  return ACTIVE_ATTEMPT_STATES.includes(attempt.state)
}

export function findAttempt(register: AttemptRegister, attemptId: string): ExecutionAttempt | undefined {
  return register.find((attempt) => attempt.attemptId === attemptId)
}

export function hasUnreconciledAttempt(register: AttemptRegister): boolean {
  return register.some((attempt) => attempt.state === 'reconciliation_required')
}

export function isArchiveBlocked(register: AttemptRegister): boolean {
  return register.some(isAttemptActive) || hasUnreconciledAttempt(register)
}

export function checkAttemptOpen(attempt: ExecutionAttempt | undefined): DeliveryCheckResult {
  if (!attempt) return fail('attempt_not_found', 'Attempt not found', 'attemptId', 'No such attempt on this task')
  if (attempt.state === 'reserved' || attempt.state === 'claimed') return { ok: true }
  if (attempt.state === 'reconciliation_required') {
    return fail('reconciliation_required', 'Reconcile the unknown attempt before continuing', 'attemptId', 'The external run state is unknown')
  }
  if (attempt.state === 'cancel_requested' || attempt.outcome === 'cancelled') {
    return fail('attempt_cancelled', 'Attempt was cancelled', 'attemptId', 'A cancellation was requested for this attempt')
  }
  return fail('attempt_closed', 'Attempt is closed', 'attemptId', `Attempt is ${attempt.state}`)
}

function hashPayload(payload: unknown): string | null {
  try {
    return hashCanonical(payload)
  } catch {
    return null
  }
}

export function reserveAttempt(register: AttemptRegister, input: ReserveAttemptInput): ReserveAttemptResult {
  const payloadHash = hashPayload(input.payload)
  if (payloadHash === null) {
    return { outcome: 'conflict', ...fail('validation_failed', 'Validation failed', 'payload', 'Payload is not canonical JSON') }
  }
  const replayed = register.find((attempt) => attempt.idempotencyKey === input.idempotencyKey)
  if (replayed) {
    if (replayed.payloadHash === payloadHash) return { ok: true, outcome: 'existing', attempt: replayed, register: [...register] }
    return {
      outcome: 'conflict',
      ...fail('idempotency_conflict', 'Idempotency key was used with another payload', 'idempotencyKey', 'Use a new key for a new request'),
    }
  }
  if (hasUnreconciledAttempt(register)) {
    return {
      outcome: 'conflict',
      ...fail('reconciliation_required', 'Reconcile the unknown attempt before continuing', 'executionAttempts', 'The external run state is unknown'),
    }
  }
  const active = register.find(isAttemptActive)
  if (active) {
    return {
      outcome: 'conflict',
      ...fail('attempt_active', 'Another attempt is active', 'executionAttempts', `Attempt ${active.attemptId} is ${active.state}`),
    }
  }
  if (register.length >= MAX_EXECUTION_ATTEMPTS) {
    return {
      outcome: 'conflict',
      ...fail('attempt_limit_reached', 'Attempt limit reached', 'executionAttempts', `At most ${MAX_EXECUTION_ATTEMPTS} attempts are recorded per task`),
    }
  }
  const validated = validateAttempt({
    attemptId: input.newAttemptId,
    idempotencyKey: input.idempotencyKey,
    payloadHash,
    mode: input.mode,
    state: 'reserved',
    baselineId: input.baselineId,
    baselineHash: input.baselineHash,
    baseRevision: input.baseRevision,
    baseCommit: input.baseRevision.kind === 'git' ? input.baseRevision.commitSha : null,
    reservedAt: input.now,
    claimedAt: null,
    workerRef: null,
    externalRunId: null,
    workflowRef: null,
    workflowStepId: null,
    dispatchedAt: null,
    cancellationRequestedAt: null,
    stopConfirmation: null,
    reconciliation: null,
    resultEvidenceId: null,
    completionDelivery: null,
    lastDeliveryError: null,
    closedAt: null,
    outcome: null,
  })
  if (!validated.ok) return { outcome: 'conflict', ...validated }
  if (findAttempt(register, validated.attempt.attemptId)) {
    return { outcome: 'conflict', ...fail('validation_failed', 'Validation failed', 'attemptId', 'attemptId is already used') }
  }
  return { ok: true, outcome: 'created', attempt: validated.attempt, register: [...register, validated.attempt] }
}

export function claimAttempt(register: AttemptRegister, input: ClaimAttemptInput): ClaimAttemptResult {
  const attempt = findAttempt(register, input.attemptId)
  if (!attempt) return attemptNotFound(input.attemptId)
  const open = checkAttemptOpen(attempt)
  if (!open.ok) return open
  if (attempt.state === 'claimed') {
    if (attempt.workerRef === input.workerRef) return { ok: true, attempt, register: [...register], alreadyClaimed: true }
    return fail('attempt_active', 'Attempt is already claimed', 'workerRef', 'Another worker holds this attempt')
  }
  const validated = validateAttempt({ ...attempt, state: 'claimed', claimedAt: input.now, workerRef: input.workerRef })
  if (!validated.ok) return validated
  return { ok: true, attempt: validated.attempt, register: replaceAttempt(register, validated.attempt), alreadyClaimed: false }
}

export function requestCancellation(register: AttemptRegister, input: RequestCancellationInput): RequestCancellationResult {
  const attempt = findAttempt(register, input.attemptId)
  if (!attempt) return attemptNotFound(input.attemptId)
  if (attempt.state === 'cancel_requested') return { ok: true, attempt, register: [...register], alreadyRequested: true }
  if (!isAttemptActive(attempt)) {
    return fail('attempt_not_active', 'Attempt is not active', 'attemptId', `Attempt is ${attempt.state}`)
  }
  const validated = validateAttempt({
    ...attempt,
    state: 'cancel_requested',
    cancellationRequestedAt: input.now,
    stopConfirmation: 'stop_unconfirmed',
  })
  if (!validated.ok) return validated
  return { ok: true, attempt: validated.attempt, register: replaceAttempt(register, validated.attempt), alreadyRequested: false }
}

export function reconcileAttempt(register: AttemptRegister, input: ReconcileAttemptInput): ReconcileAttemptResult {
  const attempt = findAttempt(register, input.attemptId)
  if (!attempt) return attemptNotFound(input.attemptId)
  if (!isAttemptActive(attempt) && attempt.state !== 'reconciliation_required') {
    return fail('attempt_not_reconcilable', 'Attempt cannot be reconciled', 'attemptId', `Attempt is ${attempt.state}`)
  }
  const recorded: ExecutionAttempt = {
    ...attempt,
    externalRunId: input.externalRunId ?? attempt.externalRunId,
    reconciliation: {
      resolution: input.resolution,
      note: input.note,
      observedAt: input.observedAt,
      actorUserId: input.actorUserId,
      resolvedAt: input.now,
    },
  }
  const closes = input.resolution === 'not_started' || input.resolution === 'stopped'
  const closedOutcome = attempt.cancellationRequestedAt !== null ? 'cancelled' : input.resolution === 'stopped' ? 'stopped' : 'not_started'
  const next: ExecutionAttempt = closes
    ? {
        ...recorded,
        state: 'closed',
        closedAt: input.now,
        outcome: closedOutcome,
        stopConfirmation: input.resolution === 'stopped' ? 'stopped' : recorded.stopConfirmation,
      }
    : input.resolution === 'unknown'
      ? { ...recorded, state: 'reconciliation_required' }
      : recorded
  const validated = validateAttempt(next)
  if (!validated.ok) return validated
  return {
    ok: true,
    attempt: validated.attempt,
    register: replaceAttempt(register, validated.attempt),
    taskEffect: RECONCILIATION_TASK_EFFECTS[input.resolution],
  }
}
