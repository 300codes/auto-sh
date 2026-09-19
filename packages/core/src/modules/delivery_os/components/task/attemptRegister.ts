import {
  ACTIVE_ATTEMPT_STATES,
  type ExecutionAttempt,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'

export type AttemptRegisterSource = {
  executionAttempts: ExecutionAttempt[]
  attemptRegisterReadable: boolean
}

export type AttemptRegisterEntry = {
  attempt: ExecutionAttempt
  /** Position in the chronological register, counted from 1 — what the operator calls "attempt #2". */
  number: number
  active: boolean
  awaitingStopConfirmation: boolean
  reconciliationRequired: boolean
  startedAt: string
  closedAt: string | null
  /** Epoch milliseconds; an attempt that has not closed runs up to `now`, not to an unknown point. */
  interval: { start: number; end: number }
}

/**
 * Three disjoint register states. `attemptRegisterReadable: false` arrives with
 * an EMPTY array, so folding it into "no attempts" would report a clean history
 * for a task whose history could not be read at all.
 */
export type AttemptRegisterState =
  | { kind: 'unreadable' }
  | { kind: 'empty' }
  | { kind: 'entries'; entries: AttemptRegisterEntry[]; activeEntry: AttemptRegisterEntry | null }

export function isAttemptActive(attempt: ExecutionAttempt): boolean {
  return ACTIVE_ATTEMPT_STATES.includes(attempt.state)
}

function toEpochMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Reservation order is the only order the operator can reason about; ties fall
 * back to the attempt id so two reservations recorded in the same millisecond
 * still render in a stable sequence instead of swapping between renders.
 */
function compareAttempts(first: ExecutionAttempt, second: ExecutionAttempt): number {
  const byReservation = toEpochMs(first.reservedAt) - toEpochMs(second.reservedAt)
  if (byReservation !== 0) return byReservation
  return first.attemptId < second.attemptId ? -1 : first.attemptId > second.attemptId ? 1 : 0
}

function toEntry(attempt: ExecutionAttempt, index: number, nowMs: number): AttemptRegisterEntry {
  const start = toEpochMs(attempt.reservedAt)
  const end = attempt.closedAt === null ? nowMs : toEpochMs(attempt.closedAt)
  return {
    attempt,
    number: index + 1,
    active: isAttemptActive(attempt),
    awaitingStopConfirmation: attempt.stopConfirmation === 'stop_unconfirmed',
    reconciliationRequired: attempt.state === 'reconciliation_required',
    startedAt: attempt.reservedAt,
    closedAt: attempt.closedAt,
    interval: { start, end: end < start ? start : end },
  }
}

export function readAttemptRegister(source: AttemptRegisterSource, now: Date = new Date()): AttemptRegisterState {
  if (!source.attemptRegisterReadable) return { kind: 'unreadable' }
  if (source.executionAttempts.length === 0) return { kind: 'empty' }
  const nowMs = now.getTime()
  const entries = [...source.executionAttempts].sort(compareAttempts).map((attempt, index) => toEntry(attempt, index, nowMs))
  return { kind: 'entries', entries, activeEntry: entries.find((entry) => entry.active) ?? null }
}

/**
 * The list of tasks needs the marker without paying for the whole register, and
 * it must stay silent when the register could not be read — an unreadable
 * register is not evidence that nothing is running.
 */
export function findActiveAttempt(source: AttemptRegisterSource): ExecutionAttempt | null {
  if (!source.attemptRegisterReadable) return null
  return source.executionAttempts.find(isAttemptActive) ?? null
}

/** Two runs overlap when each starts before the other ends; touching endpoints do not. */
export function attemptIntervalsOverlap(first: AttemptRegisterEntry, second: AttemptRegisterEntry): boolean {
  return first.interval.start < second.interval.end && second.interval.start < first.interval.end
}
