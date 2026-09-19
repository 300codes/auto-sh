import { buildDeliveryError, taskStatusSchema, type DeliveryCheckResult, type SourceRevision, type TaskStatus } from '../contracts'
import {
  TASK_TRANSITIONS,
  canTransition,
  changesRequestedOutcome,
  findBlockedAncestors,
  planBlockPropagation,
  planUnblockPropagation,
  type LifecycleTask,
  type TransitionContext,
  type VerificationContext,
} from '../taskLifecycle'

const statuses = taskStatusSchema.options
const resultRevision: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
const olderRevision: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }

function provenVerification(overrides: Partial<VerificationContext> = {}): VerificationContext {
  return {
    taskBaselineId: 'baseline-2',
    resultRevision,
    evidence: [
      { id: 'evidence-1', kind: 'result_manifest', baselineId: 'baseline-2', sourceRevision: resultRevision },
      { id: 'evidence-2', kind: 'test', baselineId: 'baseline-2', sourceRevision: resultRevision },
    ],
    unprovenAcIds: [],
    ...overrides,
  }
}

const completeContext: TransitionContext = {
  source: 'command',
  statusReason: null,
  readiness: { ok: true },
  correction: { requested: 0, max: 2 },
  verification: provenVerification(),
}

function errorCode(result: DeliveryCheckResult): string | null {
  return result.ok ? null : result.body.code
}

function detailCodes(result: DeliveryCheckResult): string[] {
  return result.ok ? [] : result.body.details.map((detail) => detail.code)
}

describe('task lifecycle table', () => {
  it('walks the master-plan path draft → ready → executing → awaiting_review → changes_requested → executing → awaiting_review → verified', () => {
    const path: TaskStatus[] = ['draft', 'ready', 'executing', 'awaiting_review', 'changes_requested', 'executing', 'awaiting_review', 'verified']
    for (let index = 1; index < path.length; index += 1) {
      expect(canTransition(path[index - 1], path[index], completeContext)).toEqual({ ok: true })
    }
  })

  it('allows every table edge with a complete context', () => {
    for (const from of statuses) {
      for (const to of TASK_TRANSITIONS[from]) {
        expect({ from, to, result: canTransition(from, to, completeContext) }).toEqual({ from, to, result: { ok: true } })
      }
    }
  })

  it('rejects every pair outside the table with 409 invalid_transition, even with a complete context', () => {
    let rejected = 0
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to || TASK_TRANSITIONS[from].includes(to)) continue
        const result = canTransition(from, to, completeContext)
        expect({ from, to, code: errorCode(result), details: detailCodes(result) }).toEqual({
          from,
          to,
          code: 'invalid_transition',
          details: ['not_in_lifecycle'],
        })
        if (!result.ok) expect(result.status).toBe(409)
        rejected += 1
      }
    }
    expect(rejected).toBe(33)
  })

  it('keeps verified and cancelled terminal and does not let a running task be cancelled directly', () => {
    expect(TASK_TRANSITIONS.verified).toEqual([])
    expect(TASK_TRANSITIONS.cancelled).toEqual([])
    expect(errorCode(canTransition('executing', 'cancelled', completeContext))).toBe('invalid_transition')
    expect(canTransition('changes_requested', 'cancelled', completeContext)).toEqual({ ok: true })
  })

  it('treats an identity change as a no-op, also for an unchanged status sent through R12', () => {
    expect(canTransition('blocked', 'blocked', { source: 'command' })).toEqual({ ok: true })
    expect(canTransition('executing', 'executing', { source: 'status_update' })).toEqual({ ok: true })
  })
})

describe('status updates from users (R12)', () => {
  it('rejects statuses owned by commands, including verified, while user-settable ones pass', () => {
    for (const to of ['executing', 'awaiting_review', 'changes_requested', 'verified'] as const) {
      const result = canTransition('ready', to, { ...completeContext, source: 'status_update' })
      expect({ to, code: errorCode(result), details: detailCodes(result) }).toEqual({ to, code: 'invalid_transition', details: ['not_user_settable'] })
    }
    expect(canTransition('draft', 'ready', { ...completeContext, source: 'status_update' })).toEqual({ ok: true })
    expect(canTransition('ready', 'blocked', { source: 'status_update' })).toEqual({ ok: true })
    expect(canTransition('awaiting_review', 'cancelled', { source: 'status_update' })).toEqual({ ok: true })
  })
})

describe('ready gate', () => {
  it('rejects ready when readiness was not checked and returns the readiness failure as is', () => {
    expect(detailCodes(canTransition('draft', 'ready', { source: 'status_update' }))).toEqual(['readiness_not_checked'])
    const notApproved = { ok: false as const, ...buildDeliveryError('baseline_not_approved', 'Baseline is not approved') }
    expect(canTransition('draft', 'ready', { source: 'status_update', readiness: notApproved })).toEqual(notApproved)
    expect(canTransition('draft', 'ready', { source: 'status_update', readiness: { ok: true } })).toEqual({ ok: true })
  })
})

describe('verified gate', () => {
  it('rejects verified without any context or evidence', () => {
    expect(errorCode(canTransition('awaiting_review', 'verified', { source: 'command' }))).toBe('missing_required_tests')
    const empty = canTransition('awaiting_review', 'verified', { source: 'command', verification: provenVerification({ evidence: [] }) })
    expect(errorCode(empty)).toBe('missing_required_tests')
    expect(detailCodes(empty)).toEqual(['missing_evidence'])
  })

  it('does not count reference material or screenshots as acceptance evidence', () => {
    const evidence = [
      { id: 'reference', kind: 'reference_material' as const, baselineId: 'baseline-2', sourceRevision: resultRevision },
      { id: 'screenshot', kind: 'screenshot' as const, baselineId: 'baseline-2', sourceRevision: resultRevision },
    ]
    expect(errorCode(canTransition('awaiting_review', 'verified', { source: 'command', verification: provenVerification({ evidence }) }))).toBe(
      'missing_required_tests',
    )
  })

  it('rejects evidence recorded for another baseline with baseline_mismatch', () => {
    const evidence = [{ id: 'old', kind: 'result_manifest' as const, baselineId: 'baseline-1', sourceRevision: resultRevision }]
    const result = canTransition('awaiting_review', 'verified', { source: 'command', verification: provenVerification({ evidence }) })
    expect(errorCode(result)).toBe('baseline_mismatch')
    if (!result.ok) expect(result.status).toBe(422)
  })

  it('rejects evidence for another revision of the pinned baseline, and accepts the same evidence on the result revision', () => {
    const evidence = [{ id: 'stale', kind: 'test' as const, baselineId: 'baseline-2', sourceRevision: olderRevision }]
    const stale = canTransition('awaiting_review', 'verified', { source: 'command', verification: provenVerification({ evidence }) })
    expect(errorCode(stale)).toBe('missing_required_tests')
    expect(detailCodes(stale)).toEqual(['revision_mismatch'])
    const noRevision = [{ id: 'bare', kind: 'test' as const, baselineId: 'baseline-2', sourceRevision: null }]
    expect(errorCode(canTransition('awaiting_review', 'verified', { source: 'command', verification: provenVerification({ evidence: noRevision }) }))).toBe(
      'missing_required_tests',
    )
    const current = [{ id: 'fresh', kind: 'test' as const, baselineId: 'baseline-2', sourceRevision: resultRevision }]
    expect(canTransition('awaiting_review', 'verified', { source: 'command', verification: provenVerification({ evidence: current }) })).toEqual({
      ok: true,
    })
  })

  it('rejects verified while any task AC is unproven, listing each AC', () => {
    const result = canTransition('awaiting_review', 'verified', { source: 'command', verification: provenVerification({ unprovenAcIds: ['AC-2', 'AC-3'] }) })
    expect(errorCode(result)).toBe('missing_required_tests')
    if (!result.ok) expect(result.body.details.map((detail) => detail.path)).toEqual(['acIds.AC-2', 'acIds.AC-3'])
  })
})

describe('correction rounds', () => {
  it('allows the first and second correction round and rejects the third with correction_limit_reached', () => {
    expect(canTransition('changes_requested', 'executing', { source: 'command', correction: { requested: 1, max: 2 } })).toEqual({ ok: true })
    expect(canTransition('changes_requested', 'executing', { source: 'command', correction: { requested: 2, max: 2 } })).toEqual({ ok: true })
    const third = canTransition('changes_requested', 'executing', { source: 'command', correction: { requested: 3, max: 2 } })
    expect(errorCode(third)).toBe('correction_limit_reached')
    if (!third.ok) expect(third.status).toBe(409)
  })

  it('cannot be reset by moving the task back through draft and ready', () => {
    expect(canTransition('ready', 'executing', { source: 'command', correction: { requested: 0, max: 2 } })).toEqual({ ok: true })
    expect(errorCode(canTransition('ready', 'executing', { source: 'command', correction: { requested: 3, max: 2 } }))).toBe('correction_limit_reached')
  })

  it('fails closed when the correction budget is unknown or malformed', () => {
    expect(detailCodes(canTransition('changes_requested', 'executing', { source: 'command' }))).toEqual(['correction_budget_unknown'])
    expect(detailCodes(canTransition('ready', 'executing', { source: 'command' }))).toEqual(['correction_budget_unknown'])
    for (const correction of [{ requested: -1, max: 2 }, { requested: 0, max: Number.NaN }, { requested: 0.5, max: 2 }]) {
      expect(detailCodes(canTransition('changes_requested', 'executing', { source: 'command', correction }))).toEqual(['correction_budget_unknown'])
    }
    expect(changesRequestedOutcome({ requested: 0, max: Number.NaN })).toEqual({ status: 'blocked', statusReason: 'correction_limit_reached' })
  })

  it('turns a review asking for changes into an escalation block once the budget is used', () => {
    expect(changesRequestedOutcome({ requested: 1, max: 2 })).toEqual({ status: 'changes_requested', statusReason: null })
    expect(canTransition('awaiting_review', 'changes_requested', { source: 'command', correction: { requested: 1, max: 2 } })).toEqual({ ok: true })
    expect(changesRequestedOutcome({ requested: 2, max: 2 })).toEqual({ status: 'blocked', statusReason: 'correction_limit_reached' })
    expect(errorCode(canTransition('awaiting_review', 'changes_requested', { source: 'command', correction: { requested: 2, max: 2 } }))).toBe(
      'correction_limit_reached',
    )
    expect(canTransition('awaiting_review', 'blocked', { source: 'command', statusReason: 'correction_limit_reached' })).toEqual({ ok: true })
  })

  it('lets an escalated task only be cancelled', () => {
    const escalated: TransitionContext = { ...completeContext, statusReason: 'correction_limit_reached' }
    for (const to of ['changes_requested', 'ready', 'draft', 'awaiting_review'] as const) {
      expect({ to, code: errorCode(canTransition('blocked', to, escalated)) }).toEqual({ to, code: 'correction_limit_reached' })
    }
    expect(canTransition('blocked', 'cancelled', escalated)).toEqual({ ok: true })
  })
})

describe('reconciliation_required block', () => {
  const unknownRun: TransitionContext = { ...completeContext, statusReason: 'reconciliation_required' }

  it('cannot go to ready, executing or changes_requested until reconciled', () => {
    for (const [from, to] of [['blocked', 'ready'], ['ready', 'executing'], ['blocked', 'changes_requested']] as const) {
      const result = canTransition(from, to, unknownRun)
      expect({ from, to, code: errorCode(result) }).toEqual({ from, to, code: 'reconciliation_required' })
    }
  })

  it('can still be cancelled or returned to draft, and moves on once the reconcile command clears the reason', () => {
    expect(canTransition('blocked', 'cancelled', unknownRun)).toEqual({ ok: true })
    expect(canTransition('blocked', 'draft', unknownRun)).toEqual({ ok: true })
    expect(canTransition('blocked', 'ready', { ...unknownRun, statusReason: null })).toEqual({ ok: true })
    expect(canTransition('blocked', 'awaiting_review', { ...unknownRun, statusReason: null })).toEqual({ ok: true })
    expect(errorCode(canTransition('blocked', 'awaiting_review', { source: 'status_update', statusReason: null }))).toBe('invalid_transition')
  })
})

describe('block propagation', () => {
  const tasks: LifecycleTask[] = [
    { id: 'A', status: 'ready', dependsOnTaskIds: [] },
    { id: 'B', status: 'ready', dependsOnTaskIds: ['A'] },
    { id: 'C', status: 'draft', dependsOnTaskIds: ['B'] },
    { id: 'D', status: 'cancelled', dependsOnTaskIds: ['B'] },
    { id: 'E', status: 'ready', dependsOnTaskIds: [] },
    { id: 'F', status: 'draft', dependsOnTaskIds: ['E'] },
  ]

  it('blocks only descendants that can be blocked; ancestors, independent and terminal tasks are untouched', () => {
    expect(planBlockPropagation('B', tasks)).toEqual([{ taskId: 'C', from: 'draft', to: 'blocked', statusReason: 'dependency_blocked' }])
    expect(planBlockPropagation('E', tasks)).toEqual([{ taskId: 'F', from: 'draft', to: 'blocked', statusReason: 'dependency_blocked' }])
    expect(planBlockPropagation('C', tasks)).toEqual([])
  })

  it('refuses ready while any ancestor is blocked, whatever the task status reason', () => {
    const blocked: LifecycleTask[] = [
      { id: 'A', status: 'blocked', statusReason: null, dependsOnTaskIds: [] },
      { id: 'B', status: 'blocked', statusReason: 'dependency_blocked', dependsOnTaskIds: ['A'] },
      { id: 'N', status: 'draft', statusReason: null, dependsOnTaskIds: ['A'] },
    ]
    const blockedAncestorIds = findBlockedAncestors('B', blocked)
    expect(blockedAncestorIds).toEqual(['A'])
    const context: TransitionContext = { ...completeContext, source: 'status_update', statusReason: 'dependency_blocked', blockedAncestorIds }
    expect(detailCodes(canTransition('blocked', 'ready', context))).toEqual(['dependency_blocked'])
    expect(detailCodes(canTransition('draft', 'ready', { ...context, statusReason: null, blockedAncestorIds: findBlockedAncestors('N', blocked) }))).toEqual([
      'dependency_blocked',
    ])
    expect(canTransition('blocked', 'draft', context)).toEqual({ ok: true })
    expect(canTransition('blocked', 'ready', { ...context, blockedAncestorIds: [] })).toEqual({ ok: true })
  })

  it('never touches descendants that are already running, under review or waiting for a correction', () => {
    const inFlight: LifecycleTask[] = [
      { id: 'A', status: 'ready', dependsOnTaskIds: [] },
      { id: 'R', status: 'executing', dependsOnTaskIds: ['A'] },
      { id: 'V', status: 'awaiting_review', dependsOnTaskIds: ['A'] },
      { id: 'W', status: 'changes_requested', dependsOnTaskIds: ['A'] },
      { id: 'Z', status: 'draft', dependsOnTaskIds: ['R'] },
    ]
    expect(planBlockPropagation('A', inFlight)).toEqual([{ taskId: 'Z', from: 'draft', to: 'blocked', statusReason: 'dependency_blocked' }])
  })

  it('unblocks descendants to draft only when no other root block remains upstream', () => {
    const blocked: LifecycleTask[] = [
      { id: 'A', status: 'ready', statusReason: null, dependsOnTaskIds: [] },
      { id: 'X', status: 'blocked', statusReason: null, dependsOnTaskIds: [] },
      { id: 'B', status: 'blocked', statusReason: 'dependency_blocked', dependsOnTaskIds: ['A'] },
      { id: 'C', status: 'blocked', statusReason: 'dependency_blocked', dependsOnTaskIds: ['B'] },
      { id: 'D', status: 'blocked', statusReason: 'dependency_blocked', dependsOnTaskIds: ['A', 'X'] },
      { id: 'M', status: 'blocked', statusReason: null, dependsOnTaskIds: ['A'] },
    ]
    expect(planUnblockPropagation('A', blocked)).toEqual([
      { taskId: 'B', from: 'blocked', to: 'draft', statusReason: null },
      { taskId: 'C', from: 'blocked', to: 'draft', statusReason: null },
    ])
  })
})
