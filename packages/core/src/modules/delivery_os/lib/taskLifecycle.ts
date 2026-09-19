import {
  buildDeliveryError,
  isSameRevision,
  USER_SETTABLE_TASK_STATUSES,
  type DeliveryCheckResult,
  type DeliveryErrorCode,
  type DeliveryErrorDetail,
  type DeliveryEvidenceKind,
  type SourceRevision,
  type TaskStatus,
  type TaskStatusReason,
} from './contracts'
import { ancestorsOf, descendantsOf } from './dag'
import { countsAsAcEvidence } from './targetProfiles'

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  draft: ['ready', 'blocked', 'cancelled'],
  ready: ['draft', 'executing', 'blocked', 'cancelled'],
  executing: ['awaiting_review', 'ready', 'changes_requested', 'blocked'],
  awaiting_review: ['changes_requested', 'verified', 'blocked', 'cancelled'],
  changes_requested: ['executing', 'blocked', 'cancelled'],
  blocked: ['draft', 'ready', 'awaiting_review', 'changes_requested', 'cancelled'],
  verified: [],
  cancelled: [],
}

export type CorrectionBudget = { requested: number; max: number }

export type VerificationEvidence = {
  id: string
  kind: DeliveryEvidenceKind
  baselineId: string
  sourceRevision: SourceRevision | null
}

export type VerificationContext = {
  taskBaselineId: string
  resultRevision: SourceRevision
  evidence: readonly VerificationEvidence[]
  unprovenAcIds: readonly string[]
}

export type TransitionContext = {
  source: 'status_update' | 'command'
  currentStatusReason?: string | null
  readiness?: DeliveryCheckResult
  correction?: CorrectionBudget
  verification?: VerificationContext
  blockedAncestorIds?: readonly string[]
}

export type LifecycleTask = {
  id: string
  status: TaskStatus
  statusReason?: string | null
  dependsOnTaskIds: readonly string[]
}

export type PlannedStatusChange = {
  taskId: string
  from: TaskStatus
  to: TaskStatus
  statusReason: TaskStatusReason | null
}

const RECONCILIATION_LOCKED_TARGETS: readonly TaskStatus[] = ['ready', 'executing', 'changes_requested']
const PROPAGATING_STATUSES: readonly TaskStatus[] = ['draft', 'ready']

function reject(code: DeliveryErrorCode, error: string, detail: DeliveryErrorDetail): DeliveryCheckResult {
  return { ok: false, ...buildDeliveryError(code, error, [detail]) }
}

function invalidTransition(from: TaskStatus, to: TaskStatus, detailCode: string, message: string): DeliveryCheckResult {
  return reject('invalid_transition', `Task cannot move from ${from} to ${to}`, { path: 'status', code: detailCode, message })
}

function isValidCorrectionBudget(correction: CorrectionBudget): boolean {
  return Number.isInteger(correction.requested) && Number.isInteger(correction.max) && correction.requested >= 0 && correction.max >= 0
}

export function isCorrectionBudgetExhausted(correction: CorrectionBudget): boolean {
  return !isValidCorrectionBudget(correction) || correction.requested >= correction.max
}

function checkCorrectionBudget(from: TaskStatus, to: TaskStatus, correction: CorrectionBudget | undefined): DeliveryCheckResult {
  if (!correction || !isValidCorrectionBudget(correction)) {
    return invalidTransition(from, to, 'correction_budget_unknown', 'Correction rounds were not supplied')
  }
  const exceeded = to === 'executing' ? correction.requested > correction.max : correction.requested >= correction.max
  if (!exceeded) return { ok: true }
  return reject('correction_limit_reached', 'Correction round limit reached; escalate to a human', {
    path: 'status',
    code: 'correction_limit_reached',
    message: `${correction.requested} of ${correction.max} correction rounds already requested`,
  })
}

export function checkVerification(verification: VerificationContext | undefined): DeliveryCheckResult {
  if (!verification) {
    return reject('missing_required_tests', 'Verification needs evidence', { path: 'evidence', code: 'missing_evidence', message: 'No verification evidence supplied' })
  }
  const countable = verification.evidence.filter((item) => countsAsAcEvidence(item.kind))
  if (countable.length === 0) {
    return reject('missing_required_tests', 'Verification needs evidence', { path: 'evidence', code: 'missing_evidence', message: 'No acceptance evidence recorded for the task' })
  }
  const onBaseline = countable.filter((item) => item.baselineId === verification.taskBaselineId)
  if (onBaseline.length === 0) {
    return reject('baseline_mismatch', 'Evidence belongs to another baseline', {
      path: 'evidence',
      code: 'baseline_mismatch',
      message: `No evidence for baseline ${verification.taskBaselineId}`,
    })
  }
  const onRevision = onBaseline.filter((item) => item.sourceRevision && isSameRevision(item.sourceRevision, verification.resultRevision))
  if (onRevision.length === 0) {
    return reject('missing_required_tests', 'Evidence belongs to another revision', {
      path: 'evidence',
      code: 'revision_mismatch',
      message: 'No evidence for the result revision under review',
    })
  }
  if (verification.unprovenAcIds.length > 0) {
    return {
      ok: false,
      ...buildDeliveryError(
        'missing_required_tests',
        'Some acceptance criteria are not proven',
        verification.unprovenAcIds.map((acId) => ({ path: `acIds.${acId}`, code: 'ac_unproven', message: `${acId} is not proven on the result revision` })),
      ),
    }
  }
  return { ok: true }
}

export function canTransition(from: TaskStatus, to: TaskStatus, context: TransitionContext): DeliveryCheckResult {
  if (from === to) return { ok: true }
  if (context.source === 'status_update' && !USER_SETTABLE_TASK_STATUSES.includes(to)) {
    return invalidTransition(from, to, 'not_user_settable', `${to} is set only by attempt, result and review commands`)
  }
  if (!TASK_TRANSITIONS[from].includes(to)) {
    return invalidTransition(from, to, 'not_in_lifecycle', `${from} -> ${to} is not in the lifecycle table`)
  }
  if (context.currentStatusReason === 'reconciliation_required' && RECONCILIATION_LOCKED_TARGETS.includes(to)) {
    return reject('reconciliation_required', 'Reconcile the unknown attempt before continuing', {
      path: 'status',
      code: 'reconciliation_required',
      message: 'The external run state is unknown',
    })
  }
  if (context.currentStatusReason === 'correction_limit_reached' && to !== 'cancelled') {
    return reject('correction_limit_reached', 'Correction round limit reached; escalate to a human', {
      path: 'status',
      code: 'correction_limit_reached',
      message: 'Only cancellation is allowed after the correction limit',
    })
  }
  const blockedAncestors = context.blockedAncestorIds ?? []
  if (to === 'ready' && blockedAncestors.length > 0) {
    return invalidTransition(from, to, 'dependency_blocked', `Blocked by ${blockedAncestors.join(', ')}`)
  }
  if (to === 'ready') {
    if (!context.readiness) return invalidTransition(from, to, 'readiness_not_checked', 'Baseline readiness was not checked')
    if (!context.readiness.ok) return context.readiness
  }
  if (to === 'executing' || (from === 'awaiting_review' && to === 'changes_requested')) {
    const budget = checkCorrectionBudget(from, to, context.correction)
    if (!budget.ok) return budget
  }
  if (to === 'verified') return checkVerification(context.verification)
  return { ok: true }
}

export function changesRequestedOutcome(
  correction: CorrectionBudget,
): { status: 'changes_requested'; statusReason: null } | { status: 'blocked'; statusReason: 'correction_limit_reached' } {
  if (isCorrectionBudgetExhausted(correction)) return { status: 'blocked', statusReason: 'correction_limit_reached' }
  return { status: 'changes_requested', statusReason: null }
}

export function findBlockedAncestors(taskId: string, tasks: readonly LifecycleTask[]): string[] {
  const statusById = new Map(tasks.map((task) => [task.id, task.status]))
  return ancestorsOf(taskId, tasks).filter((ancestorId) => statusById.get(ancestorId) === 'blocked')
}

export function planBlockPropagation(taskId: string, tasks: readonly LifecycleTask[]): PlannedStatusChange[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const changes: PlannedStatusChange[] = []
  for (const descendantId of descendantsOf(taskId, tasks)) {
    const descendant = tasksById.get(descendantId)
    if (!descendant || !PROPAGATING_STATUSES.includes(descendant.status)) continue
    changes.push({ taskId: descendantId, from: descendant.status, to: 'blocked', statusReason: 'dependency_blocked' })
  }
  return changes
}

export function planUnblockPropagation(taskId: string, tasks: readonly LifecycleTask[]): PlannedStatusChange[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const isRootBlock = (candidateId: string) => {
    const candidate = tasksById.get(candidateId)
    return candidateId !== taskId && candidate?.status === 'blocked' && candidate.statusReason !== 'dependency_blocked'
  }
  const changes: PlannedStatusChange[] = []
  for (const descendantId of descendantsOf(taskId, tasks)) {
    const descendant = tasksById.get(descendantId)
    if (!descendant || descendant.status !== 'blocked' || descendant.statusReason !== 'dependency_blocked') continue
    if (ancestorsOf(descendantId, tasks).some(isRootBlock)) continue
    changes.push({ taskId: descendantId, from: 'blocked', to: 'draft', statusReason: null })
  }
  return changes
}
