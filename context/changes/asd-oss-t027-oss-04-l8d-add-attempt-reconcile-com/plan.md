# OSS-04 (L8d): attempt reconcile command and route R18 — Implementation Plan

## Overview

UA-19: after a cancel request, a crash or a restart nobody knows whether the external agent run started, stopped or
finished. An operator with the separate feature `delivery_os.attempts.reconcile` looks at the real process and
records the answer with `POST /api/delivery_os/tasks/:id/attempts/:attemptId/reconcile`
`{ resolution, externalEvidence { note, observedAt, externalRunId? }, manifest? }`. The system then decides
deterministically: release the task, accept the result through the normal R16 validation, or block the task as
`reconciliation_required`. It never restarts or dispatches anything by itself. This is the safety boundary of the
demo: the agent run is uncertain, a human states a fact, the system decides.

## Current State Analysis

See `research.md`. In short: the pure reducer `reconcileAttempt`, the request schema `reconcileAttemptSchema`
(with `422 manifest_required`), the ACL feature, the error codes, and the blocking of reserve/archive/late results
already exist. `ExecutionAttempt v1` already stores the external evidence (`reconciliation` + `externalRunId`), so
no contract field is added. Missing: command, shared acceptance helper, route, response schema, tests, docs.

## Desired End State

- Command `delivery_os.attempts.reconcile` (new file `commands/reconcile.ts`) and route R18 answering
  `200 { attemptId, resolution, taskStatus, taskUpdatedAt, evidenceId? }`.
- `not_started` / `stopped` → attempt `closed`; task `changes_requested` when an earlier attempt of the task has a
  result (correction round), otherwise `ready`; if the ready gate fails (for example the baseline is no longer
  active) the task lands in `blocked` with no reason instead of refusing the reconcile.
- `completed` → the same acceptance function as `results.accept`; task `awaiting_review`, never `verified`.
- `unknown` → attempt `reconciliation_required`, task `blocked` / `reconciliation_required`; a later reconcile with
  another resolution is allowed.
- Errors: 404 foreign scope / unknown attempt, 428 missing version, 409 stale version,
  409 `attempt_not_reconcilable`, 422 `manifest_required`, all R16 codes on `completed`, 403 without the feature.
- Verified by jest (`delivery_os` folder) and a live smoke on :3100.

### Key Discoveries:

- `checkAttemptAcceptsResult` (`lib/attempts.ts:371`) lets a `cancel_requested` / `reconciliation_required` attempt
  accept a result only when `reconciliation.resolution === 'completed'` — the acceptance must run on the reconciled
  register, not on the stored one.
- `canTransition` (`lib/taskLifecycle.ts:161`) refuses `ready` / `changes_requested` while the stored reason is
  `reconciliation_required`. Reconcile is the sanctioned exit, so it passes `statusReason: null` when the reason is
  `reconciliation_required` (the value it is about to write).
- `tasks.update` propagates `blocked` to `draft/ready` descendants and un-blocks them
  (`commands/tasks.ts:397-415`, private helpers); `checkReadyGate` (`commands/tasks.ts:343`) is private too.
- Cancel (`commands/attempts.ts:298`) fixes the check order and the side-effect pattern.
- `evidence.recorded` with `completionDelivery` is what enterprise uses to deliver a result to a parked workflow
  (T024). The completed path emits the same event, so a reconciled automatic attempt resumes its workflow the same way.

## What We're NOT Doing

- No executor call, queue job, workflow signal or retry from reconcile. No automatic detection of unknown attempts
  (EXEC calls this command in-process after a restart).
- No new `ExecutionAttempt` fields, error codes, events, ACL features, DI keys or migrations.
- No UI, i18n files, integration spec `TC-DELIVERY-007` (UI / QA streams) — patch requests go to the hand-over.
- No idempotent replay for reconcile: a closed attempt answers `409 attempt_not_reconcilable`.

## Implementation Approach

Decisions (autonomous; answered from the master plan, the spec, recorded decisions and the code):

1. **Where the command lives** — new `commands/reconcile.ts`, imported from `commands/index.ts`. It needs both the
   attempt helpers and the acceptance helper; a separate file keeps `attempts.ts` and `evidence.ts` free of a cycle.
2. **Shared acceptance** — extract from `commands/evidence.ts` two exported functions:
   `acceptResultInTransaction(tx, ctx, input)` (the whole current transaction body after the task lock; input has
   `task`, `scope`, `attemptId`, `manifest`, `source`, `recordedBy`, optional `register` override and optional
   `statusReasonOverride`) returning the existing `AcceptOutcome` plus `manifestHash`; and
   `emitResultAccepted(ctx, scope, attemptId, outcome)` (event + evidence index + task side effects).
   `results.accept` becomes a thin caller; behaviour and its tests stay unchanged.
3. **Correction round** — pure rule: another attempt in the register has `resultEvidenceId !== null`.
4. **Ready gate fails on release** → task `blocked`, reason null. Refusing would leave an active attempt that blocks
   archive forever; forcing `ready` would break the "ready only on an approved baseline" invariant.
5. **Propagation** — reconcile locks project → project tasks (same order as `tasks.update`) and applies block /
   unblock propagation so the board stays truthful: block when the task becomes `blocked`, unblock when it leaves
   `blocked`. Export `applyPropagation` and `checkReadyGate` from `commands/tasks.ts`; call the pure
   `planBlockPropagation` / `planUnblockPropagation` directly.
6. **Actor** — `reconciliation.actorUserId` is required: `ctx.auth.sub` when it is a uuid; else the issued
   `trustedExecution.actorUserId` of an in-process caller (EXEC marks `unknown` after a restart); else `403 forbidden`
   / `actor_required`. Evidence `source` of a reconciled result is always `manual`.
7. **Check order** (same as cancel): task found + locks (404) → version header (428, only with `ctx.request`) →
   register readable → stale version (409) → reducer errors (`attempt_not_found`, `attempt_not_reconcilable`) →
   resolution work → write. The task is expected to be `executing` or `blocked / reconciliation_required`
   (`tasks.update` refuses status changes while an attempt is active or unknown); any other combination is answered
   by `canTransition` (`409 invalid_transition`), never forced. `unknown` on an already blocked task changes only the
   attempt and the reason. Every reconcile writes the reason explicitly: `reconciliation_required` for `unknown`,
   null otherwise (also when the ready gate fails and the task stays `blocked`).
8. **Schema order on the route** (same as R16): scope (404) → capped body (413) → schema (400 / 422) → command.
   The command schema is `reconcileAttemptSchema` + `taskId`, `attemptId`, optional `trustedExecution`.
9. **Audit** — one entry per successful reconcile on the task resource; `snapshotAfter` carries the result plus the
   external evidence. Audit key `delivery_os.audit.attempts.reconcile` (i18n is a UI patch request).

## Critical Implementation Details

**State sequencing.** For `completed` the reducer runs first and its register is handed to the acceptance helper as
the override; the helper writes the final register (`result_received` → closed). If acceptance throws, the
transaction rolls back, so a failed manifest leaves no `reconciliation` record. `lockTaskForWrite` cannot be reused
as is because it enforces the version before the 428 check; take the locks with `findScopedProject` /
`lockScopedProjectTasks` style helpers and enforce the version with `envValue: 'all'` like cancel.

## Phase 1: Command and shared acceptance

### Changes Required:

#### 1. Shared acceptance helper

**File**: `commands/evidence.ts`

**Intent**: Move the transaction body and the post-commit emission of `results.accept` into exported helpers so
reconcile uses exactly the same validation path.

**Contract**: `acceptResultInTransaction`, `emitResultAccepted`, exported `AcceptOutcome`. `results.accept` output,
error order and unique-violation recovery unchanged.

#### 2. Exports for readiness and propagation

**File**: `commands/tasks.ts`

**Intent**: Export `checkReadyGate` and `applyPropagation` (no behaviour change).

#### 3. Command schema

**File**: `data/validators.ts`

**Intent**: Add `reconcileAttemptCommandSchema` (request schema + ids + optional `trustedExecution`), keeping the
`manifest_required` refinement.

#### 4. Reconcile command

**File**: `commands/reconcile.ts` (new), `commands/index.ts`

**Intent**: Implement decisions 3-9. Result type
`AttemptReconcileResult { taskId, attemptId, resolution, taskStatus, taskStatusReason, taskUpdatedAt, evidenceId?, attempt, propagatedTaskIds }`.
After commit: index refresh + `task.updated` for the task and each propagated task; for `completed` the shared
`emitResultAccepted`.

#### 5. Tests

**File**: `commands/__tests__/reconcile.test.ts` (new), `commands/__tests__/scopeChange.test.ts`

**Intent**: Cover the acceptance list: four resolutions, correction round → `changes_requested`, ready gate failure →
`blocked`, `manifest_required`, completed with a correlation failure gives the R16 code and writes nothing, completed
never `verified`, completed on a `cancel_requested` and on an `unknown` attempt, unknown → reserve 409 and archive
409, unknown then `stopped` releases, closed attempt 409, unknown attempt id 404, stale 409, missing header 428,
foreign scope 404, trusted in-process actor, no actor 403, propagation, and "nothing restarts": only
`delivery_os.task.updated` / `delivery_os.evidence.recorded` are emitted, `container.resolve` is never asked for a
command bus, queue or workflow key (deny-list), and the register gains no attempt. Add the id to the pinned list.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands --maxWorkers=2` passes
- Existing `results.test.ts` passes unchanged

---

## Phase 2: Route R18, docs, generation

### Changes Required:

#### 1. Response schema

**File**: `api/schemas.ts`

**Intent**: `attemptReconcileResponseSchema { attemptId, resolution, taskStatus, taskUpdatedAt, evidenceId? }`.

#### 2. Route

**File**: `api/tasks/[id]/attempts/[attemptId]/reconcile/route.ts` (new)

**Intent**: POST with `requireFeatures: ['delivery_os.attempts.reconcile']`, scope-first, `readCappedRouteBody`
(8 MB like R16), `executeDeliveryCommand` (mutation guards), `openApi` with all error rows.

#### 3. Route tests

**File**: `api/__tests__/reconcile.route.test.ts` (new)

**Intent**: metadata (manage-only and employee → not allowed, reconcile and wildcard → allowed), happy paths through
real reserve/cancel routes, 422 `manifest_required`, 428, 409 stale, 404 foreign, 409 closed, unknown then reserve
and DELETE → 409, response shape against the schema, openApi present.

#### 4. Docs and generation

**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (changelog + coverage row),
`context/changes/delivery-os-oss-domain/handover/OSS-04-L8d-reconcile.md` (new), `yarn generate`.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes
- `yarn generate` completes and lists the new route
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` passes
- `yarn turbo run lint --filter=@open-mercato/core --concurrency=2` passes
- Live smoke on :3100: reserve → cancel → reconcile `unknown` → reserve 409 → reconcile `stopped` → task `ready`

#### Manual Verification:

- A human reviews the reconcile flow in the UI once UI-04 wires `AttemptActions` (UI stream)

---

## Testing Strategy

Unit tests at command level with the in-memory EM mock (pattern of `attempts.test.ts` / `results.test.ts`), route
tests with `routeTestKit`. Integration spec TC-DELIVERY-007 is QA's; candidates go to the hand-over.

## Performance Considerations

Reconcile locks all tasks of one project (as `tasks.update` does). It is a rare human action; acceptable.

## Migration Notes

None. No schema, DTO or generated-contract change besides the new route entry.

## References

- Research: `context/changes/asd-oss-t027-oss-04-l8d-add-attempt-reconcile-com/research.md`
- Cancel: `packages/core/src/modules/delivery_os/commands/attempts.ts:298`
- Spec UA-19: `.ai/specs/2026-09-18-delivery-os-hackathon.md:314`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Command and shared acceptance

#### Automated

- [x] 1.1 Command jest suite passes (delivery_os/commands)
- [x] 1.2 Existing results.test.ts passes unchanged

### Phase 2: Route R18, docs, generation

#### Automated

- [x] 2.1 Full delivery_os jest suite passes
- [x] 2.2 yarn generate completes and lists the new route
- [x] 2.3 Core typecheck passes
- [x] 2.4 Core lint passes
- [x] 2.5 Live smoke on :3100 passes

#### Manual

- [ ] 2.6 Human reviews the reconcile flow in the UI once UI-04 wires AttemptActions
