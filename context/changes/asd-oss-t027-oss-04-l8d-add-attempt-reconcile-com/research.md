---
date: 2026-09-19T09:10:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 3d93b6af1
branch: dev-mateusz
repository: open-mercato
topic: "How to build delivery_os.attempts.reconcile (R18) over the existing reconcileAttempt reducer"
tags: [research, codebase, delivery_os, attempts, reconcile]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: delivery_os.attempts.reconcile (R18)

## Research Question

What do the reducer, the lifecycle, the cancel command, the result acceptance, the routes, ACL and the pinned
command list already provide for R18, and what is missing?

## Summary

Almost every domain piece exists; the command, the route, the response schema, tests and docs are missing.
No contract change is needed: `ExecutionAttempt v1` already stores the external evidence in `reconciliation`
(`note`, `observedAt`, `actorUserId`, `resolvedAt`) plus `externalRunId`, the request schema
`reconcileAttemptSchema` exists (with `422 manifest_required`), the ACL feature exists, and the error codes exist.

## Detailed Findings

### Reducer — `lib/attempts.ts`

- `reconcileAttempt` (`lib/attempts.ts:327`): `404 attempt_not_found`; `409 attempt_not_reconcilable` unless the
  attempt is active (`reserved` / `claimed` / `cancel_requested`) or `reconciliation_required`. Records
  `reconciliation`, sets `externalRunId` when given. `not_started` / `stopped` → `state: closed`, `closedAt`,
  outcome `cancelled` (when a cancel was requested) / `stopped` / `not_started`. `unknown` → state
  `reconciliation_required`. `completed` → state unchanged, only the record. Returns
  `taskEffect: release_task | await_manifest | block_task`.
- `checkAttemptAcceptsResult` (`lib/attempts.ts:371`): a `cancel_requested` or `reconciliation_required` attempt
  accepts a result only when `reconciliation.resolution === 'completed'`. So the completed path must put the
  reconciled register into the acceptance, not the stored one.
- `hasUnreconciledAttempt` / `isArchiveBlocked` already block reserve (`409 reconciliation_required`) and archive.

### Lifecycle — `lib/taskLifecycle.ts`

- Table: `executing → awaiting_review | ready | changes_requested | blocked`;
  `blocked → draft | ready | awaiting_review | changes_requested | cancelled`.
- `canTransition` refuses `ready / executing / changes_requested` while `statusReason` is
  `reconciliation_required` (`lib/taskLifecycle.ts:161`). Reconcile is the sanctioned exit, so the command calls
  `canTransition` with the reason it is about to write (null), not the stored one.
- `→ ready` needs `context.readiness` (`checkReadyGate` in `commands/tasks.ts:343`, not exported yet).
- Block propagation (`planBlockPropagation` / `planUnblockPropagation`) is applied by `tasks.update` through
  `planPropagation` / `applyPropagation` (`commands/tasks.ts:397-415`, module-private) over the locked project tasks.

### "Came from a correction round"

- After a review asks for changes the task can reach `executing` only from `changes_requested`
  (`checkReopenAllowed` refuses `draft/ready` once a result exists). So an earlier attempt with a
  `resultEvidenceId` in the register ⇔ the current attempt is a correction round. Pure, no extra read.

### Command pattern — `commands/attempts.ts` (cancel, T026)

- Order: task row lock (404) → lock header (428, only with `ctx.request`) → register readable
  (`409 reconciliation_required / unreadable_attempt_register`) → stale version 409
  (`enforceCommandOptimisticLockWithGuards`, `envValue: 'all'`) → domain conflict → write.
- Side effects after commit: `emitTaskSideEffects(ctx, 'updated', task)` + `emitTaskUpdated(task)`; audit via
  `buildLog` with `resourceKind: DELIVERY_TASK_RESOURCE_KIND`.
- Trusted in-process callers: `!ctx.request && isIssuedTrustedExecution(readTrustedExecutionOption(rawInput))`,
  actor from `trustedExecution.actorUserId` (reserve). EXEC needs this to mark `unknown` after a restart.

### Result acceptance — `commands/evidence.ts`

- The transaction body of `delivery_os.results.accept` (lines 116-172) is the acceptance function: package load,
  existing evidence lookup, `evaluateResultAcceptance`, duplicate, `canTransition → awaiting_review`,
  `verifyResultArtifacts`, `recordAttemptResult`, `closeAttempt`, evidence row, task status. It reads the register
  from the task. To reuse it, extract it as an exported helper that takes the locked task and an optional register
  override. The post-commit part (event `evidence.recorded`, evidence index, task side effects) is also shared.
- Evidence of a reconciled result: `source: 'manual'` for a user; the trusted executor is not a result source here.

### Route, ACL, schemas

- R17 route `api/tasks/[id]/attempts/[attemptId]/cancel/route.ts` is the template; R16
  `api/tasks/[id]/results/route.ts` adds scope-first (`requireScopedTask`) and `readCappedRouteBody` (8 MB).
- `acl.ts:28` has `delivery_os.attempts.reconcile`; `setup.ts` grants `admin: delivery_os.*`, employee gets neither
  manage nor reconcile. No change.
- `data/validators.ts:454` `reconcileAttemptSchema` exists, unused. A command schema (+ ids, + trustedExecution)
  is missing. `api/schemas.ts` has no reconcile response schema.
- Spec line 314: `200 { attemptId, resolution, taskStatus, taskUpdatedAt, evidenceId? }`.
- `commands/__tests__/scopeChange.test.ts:255` pins the command id list.

## Code References

- `packages/core/src/modules/delivery_os/lib/attempts.ts:327` — reducer
- `packages/core/src/modules/delivery_os/lib/taskLifecycle.ts:161` — reconciliation lock on transitions
- `packages/core/src/modules/delivery_os/commands/attempts.ts:298` — cancel command pattern
- `packages/core/src/modules/delivery_os/commands/evidence.ts:103` — results.accept
- `packages/core/src/modules/delivery_os/commands/tasks.ts:343,397,404` — ready gate, propagation
- `packages/core/src/modules/delivery_os/data/validators.ts:454` — request schema
- `.ai/specs/2026-09-18-delivery-os-hackathon.md:314` — UA-19 contract

## Historical Context

- T026 hand-over: R18 must add its id to the pinned list; route tests need `{ params: { id, attemptId } }`.
- T024: `evidence.recorded` carries `completionDelivery`; enterprise re-dispatches delivery from it, so the completed
  path must emit the same event.
- Master plan line 131: completed leads to the normal manifest validation, never to verified; line 147: unknown
  blocks retry, no exactly-once promise.

## Open Questions

None blocking. Choices (readiness failure on release, propagation) are decided in the plan.
