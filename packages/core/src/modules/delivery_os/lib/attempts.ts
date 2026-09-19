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

export type LinkAttemptWorkflowInput = {
  attemptId: string
  workflowRef: string
  workflowStepId?: string | null
  dispatched?: boolean
  now: string
}

export type MarkAttemptDeliveryInput = {
  attemptId: string
  outcome: 'delivered' | 'failed'
  error?: string | null
  now: string
}

export type CloseAttemptInput = { attemptId: string; now: string }

export type AttemptChangeResult =
  | { ok: true; attempt: ExecutionAttempt; register: ExecutionAttempt[]; changed: boolean }
  | AttemptFailure

const MAX_DELIVERY_ERROR_LENGTH = 2000
const UNKNOWN_DELIVERY_ERROR = 'Delivery failed'

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

export function linkAttemptWorkflow(register: AttemptRegister, input: LinkAttemptWorkflowInput): AttemptChangeResult {
  const attempt = findAttempt(register, input.attemptId)
  if (!attempt) return attemptNotFound(input.attemptId)
  const open = checkAttemptOpen(attempt)
  if (!open.ok) return open
  const requestedStepId = input.workflowStepId ?? null
  const hasOtherRef = attempt.workflowRef !== null && attempt.workflowRef !== input.workflowRef
  const hasOtherStep = attempt.workflowStepId !== null && requestedStepId !== null && attempt.workflowStepId !== requestedStepId
  if (hasOtherRef || hasOtherStep) {
    return {
      ok: false,
      ...buildDeliveryError('attempt_active', 'Attempt is already linked to another workflow', [
        {
          path: hasOtherRef ? 'workflowRef' : 'workflowStepId',
          code: 'workflow_link_conflict',
          message: 'A workflow link is immutable once set',
        },
      ]),
    }
  }
  const next: ExecutionAttempt = {
    ...attempt,
    workflowRef: input.workflowRef,
    workflowStepId: attempt.workflowStepId ?? requestedStepId,
    dispatchedAt: attempt.dispatchedAt ?? (input.dispatched ? input.now : null),
  }
  const changed =
    next.workflowRef !== attempt.workflowRef ||
    next.workflowStepId !== attempt.workflowStepId ||
    next.dispatchedAt !== attempt.dispatchedAt
  if (!changed) return { ok: true, attempt, register: [...register], changed: false }
  const validated = validateAttempt(next)
  if (!validated.ok) return validated
  return { ok: true, attempt: validated.attempt, register: replaceAttempt(register, validated.attempt), changed: true }
}

export function markAttemptDelivery(register: AttemptRegister, input: MarkAttemptDeliveryInput): AttemptChangeResult {
  const attempt = findAttempt(register, input.attemptId)
  if (!attempt) return attemptNotFound(input.attemptId)
  if (attempt.completionDelivery === 'delivered') return { ok: true, attempt, register: [...register], changed: false }
  if (attempt.completionDelivery !== 'pending') {
    return {
      ok: false,
      ...buildDeliveryError('attempt_not_active', 'Attempt has no completion delivery to mark', [
        { path: 'attemptId', code: 'no_pending_delivery', message: 'Only an accepted result of a workflow-linked attempt is delivered' },
      ]),
    }
  }
  const deliveryAttempts = (attempt.deliveryAttempts ?? 0) + 1
  const validated = validateAttempt(
    input.outcome === 'delivered'
      ? { ...attempt, completionDelivery: 'delivered', lastDeliveryError: null, deliveryAttempts }
      : {
          ...attempt,
          lastDeliveryError: (input.error || UNKNOWN_DELIVERY_ERROR).slice(0, MAX_DELIVERY_ERROR_LENGTH),
          deliveryAttempts,
        },
  )
  if (!validated.ok) return validated
  return { ok: true, attempt: validated.attempt, register: replaceAttempt(register, validated.attempt), changed: true }
}

export function closeAttempt(register: AttemptRegister, input: CloseAttemptInput): AttemptChangeResult {
  const attempt = findAttempt(register, input.attemptId)
  if (!attempt) return attemptNotFound(input.attemptId)
  if (attempt.outcome === 'result_accepted') return { ok: true, attempt, register: [...register], changed: false }
  if (attempt.state !== 'result_received' || attempt.resultEvidenceId === null) {
    return fail('attempt_not_active', 'Attempt has no accepted result to close', 'attemptId', `Attempt is ${attempt.state}`)
  }
  const validated = validateAttempt({ ...attempt, closedAt: input.now, outcome: 'result_accepted' })
  if (!validated.ok) return validated
  return { ok: true, attempt: validated.attempt, register: replaceAttempt(register, validated.attempt), changed: true }
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

export type RecordAttemptResultInput = { attemptId: string; evidenceId: string; externalRunId: string }

export type RecordAttemptResultResult = { ok: true; attempt: ExecutionAttempt; register: ExecutionAttempt[] } | AttemptFailure

export function checkAttemptAcceptsResult(attempt: ExecutionAttempt | undefined): DeliveryCheckResult {
  if (!attempt) return fail('attempt_not_found', 'Attempt not found', 'attemptId', 'No such attempt on this task')
  if (attempt.state === 'reserved' || attempt.state === 'claimed') return { ok: true }
  const isConfirmedCompleted = attempt.reconciliation?.resolution === 'completed'
  if (attempt.state === 'cancel_requested') {
    if (isConfirmedCompleted) return { ok: true }
    return fail('attempt_cancelled', 'Attempt was cancelled', 'attemptId', 'A result arrives too late after a cancellation request')
  }
  if (attempt.state === 'reconciliation_required') {
    if (isConfirmedCompleted) return { ok: true }
    return fail('reconciliation_required', 'Reconcile the unknown attempt before continuing', 'attemptId', 'The external run state is unknown')
  }
  if (attempt.outcome === 'cancelled') {
    return fail('attempt_cancelled', 'Attempt was cancelled', 'attemptId', 'The attempt was closed as cancelled')
  }
  return fail('attempt_closed', 'Attempt is closed', 'attemptId', `Attempt is ${attempt.state}`)
}

export function recordAttemptResult(register: AttemptRegister, input: RecordAttemptResultInput): RecordAttemptResultResult {
  const attempt = findAttempt(register, input.attemptId)
  if (!attempt) return attemptNotFound(input.attemptId)
  const accepts = checkAttemptAcceptsResult(attempt)
  if (!accepts.ok) return accepts
  const validated = validateAttempt({
    ...attempt,
    state: 'result_received',
    resultEvidenceId: input.evidenceId,
    externalRunId: attempt.externalRunId ?? input.externalRunId,
    completionDelivery: attempt.workflowRef ? 'pending' : null,
  })
  if (!validated.ok) return validated
  return { ok: true, attempt: validated.attempt, register: replaceAttempt(register, validated.attempt) }
}
