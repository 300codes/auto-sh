import { MAX_EXECUTION_ATTEMPTS, type TaskStatus } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { AttemptRegisterEntry, AttemptRegisterState } from './attemptRegister'

/**
 * Mirrors `RESERVABLE_STATUSES` in `commands/attempts.ts`. Declared here so a
 * client island never imports the command module, and used only to decide which
 * affordance to offer — the server stays the authority on the refusal.
 */
const RESERVABLE_STATUSES: readonly TaskStatus[] = ['ready', 'changes_requested']
const SETTLED_STATUSES: readonly TaskStatus[] = ['verified', 'cancelled']

export type TaskNextStepKind =
  | 'reconcile'
  | 'import'
  | 'review'
  | 'reserve'
  | 'prepare'
  | 'settled'
  | 'unknown_history'

export type TaskNextStepBlocker =
  | 'missing_feature'
  | 'attempt_limit'
  | 'archived'
  | 'unreadable_register'
  | 'not_reservable'
  | 'result_unreadable'

export type TaskNextStep = {
  kind: TaskNextStepKind
  attemptId: string | null
  attemptNumber: number | null
  blocker: TaskNextStepBlocker | null
}

export type TaskNextStepInput = {
  status: TaskStatus
  /** `TaskDto` carries the reason as a plain string; `TASK_STATUS_REASONS` names the values. */
  statusReason: string | null
  archivedAt: string | null
  attemptNumber: number
  register: AttemptRegisterState
  /** The accepted result has been read back; a review cannot be written without it. */
  hasAcceptedResult: boolean
  canManageAttempts: boolean
  canImportResults: boolean
  canReconcile: boolean
}

/** An attempt whose real fate the system does not know can only be reconciled. */
function findUnresolved(entries: readonly AttemptRegisterEntry[]): AttemptRegisterEntry | null {
  return entries.find((entry) => entry.reconciliationRequired || entry.awaitingStopConfirmation) ?? null
}

function step(kind: TaskNextStepKind, blocker: TaskNextStepBlocker | null, entry?: AttemptRegisterEntry | null): TaskNextStep {
  return {
    kind,
    blocker,
    attemptId: entry?.attempt.attemptId ?? null,
    attemptNumber: entry?.number ?? null,
  }
}

/**
 * One affordance at a time, in the order the domain forces: an unresolved
 * attempt blocks everything, a live attempt owns the result slot, and a
 * reservation is only offered where the command would accept it. A step the
 * operator may not take is still named — with the reason — rather than hidden,
 * so the screen never looks finished when it is only ungranted.
 */
export function readTaskNextStep(input: TaskNextStepInput): TaskNextStep {
  if (input.archivedAt !== null) return step('settled', 'archived')
  if (input.register.kind === 'unreadable') return step('unknown_history', 'unreadable_register')

  const entries = input.register.kind === 'entries' ? input.register.entries : []
  const unresolved = findUnresolved(entries)
  if (unresolved !== null || input.statusReason === 'reconciliation_required') {
    return step('reconcile', input.canReconcile ? null : 'missing_feature', unresolved)
  }

  if (SETTLED_STATUSES.includes(input.status)) return step('settled', null)

  if (input.status === 'awaiting_review') {
    if (!input.canImportResults) return step('review', 'missing_feature')
    return step('review', input.hasAcceptedResult ? null : 'result_unreadable')
  }

  const active = input.register.kind === 'entries' ? input.register.activeEntry : null
  if (active !== null) return step('import', input.canImportResults ? null : 'missing_feature', active)

  if (RESERVABLE_STATUSES.includes(input.status)) {
    if (!input.canManageAttempts) return step('reserve', 'missing_feature')
    if (input.attemptNumber >= MAX_EXECUTION_ATTEMPTS) return step('reserve', 'attempt_limit')
    return step('reserve', null)
  }

  return step('prepare', 'not_reservable')
}

export type TaskProgressStepId = 'reserve' | 'run' | 'import' | 'review' | 'verified'

export type TaskProgressStep = { id: TaskProgressStepId; state: 'pending' | 'active' | 'completed' }

const PROGRESS_ORDER: readonly TaskProgressStepId[] = ['reserve', 'run', 'import', 'review', 'verified']

function activeProgressStep(input: TaskNextStepInput, next: TaskNextStep): TaskProgressStepId {
  if (input.status === 'verified') return 'verified'
  if (next.kind === 'review' || input.status === 'awaiting_review') return 'review'
  if (next.kind === 'import' || next.kind === 'reconcile') return 'import'
  if (input.status === 'executing') return 'run'
  return 'reserve'
}

/**
 * The tracker reports where the task stands, never where it should be: a task
 * that came back with changes requested is at the reservation again, and the
 * steps behind it stay completed because they did happen.
 */
export function readTaskProgress(input: TaskNextStepInput, next: TaskNextStep): TaskProgressStep[] {
  const current = activeProgressStep(input, next)
  const currentIndex = PROGRESS_ORDER.indexOf(current)
  const done = input.status === 'verified'
  return PROGRESS_ORDER.map((id, index) => ({
    id,
    state: done || index < currentIndex ? 'completed' : index === currentIndex ? 'active' : 'pending',
  }))
}
