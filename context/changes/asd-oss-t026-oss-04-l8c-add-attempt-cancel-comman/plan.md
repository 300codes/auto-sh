# OSS-04 (L8c): attempt cancel command and route R17 — Implementation Plan

## Overview

UA-18: an operator cancels a running execution attempt with
`POST /api/delivery_os/tasks/:id/attempts/:attemptId/cancel` `{ reason? }`. The system records the request
(`cancellationRequestedAt`, state `cancel_requested`, `stopConfirmation: 'stop_unconfirmed'`), blocks any new
dispatch, late results, a new reservation and archiving until the attempt is reconciled (R18, next task), and never
claims the external process stopped. This is the "system decides" boundary the demo shows: the agent run can be
stopped only by a human decision that the system records honestly.

## Current State Analysis

- `lib/attempts.ts:310` `requestCancellation` already exists (pure, idempotent: `alreadyRequested: true` for a
  `cancel_requested` attempt; `409 attempt_not_active` for `result_received` / `reconciliation_required` / `closed`;
  `404 attempt_not_found`). Covered by `lib/__tests__/attempts.test.ts:252`.
- `lib/attempts.ts:371` `checkAttemptAcceptsResult` already answers `409 attempt_cancelled` for a `cancel_requested`
  attempt unless reconciled `completed`; `results.accept` runs idempotency first, so an accepted manifest replay wins.
- `lib/attempts.ts:137` `checkAttemptOpen` already answers `attempt_cancelled` for claim / link_workflow / package.
- `ACTIVE_ATTEMPT_STATES` includes `cancel_requested`, so `reserveAttempt` answers `409 attempt_active` and the
  project/task archive guard (`commands/projects.ts:130-160`) answers `409 attempt_active` with detail
  `attempt_cancel_requested`. `isArchiveBlocked` is true, `hasUnreconciledAttempt` is false.
- `data/validators.ts:443` `cancelAttemptSchema = { reason?: string ≤ 2000 }` exists and is unused.
- `acl.ts` already has `delivery_os.attempts.manage` ("Reserve, cancel and export execution attempts").
- Missing: the command, the route, the response schema, tests, spec changelog and a hand-over note.

## Desired End State

- Command `delivery_os.attempts.cancel` registered in `commands/attempts.ts`; route R17 answers
  `200 { attemptId, state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed', taskStatus, taskUpdatedAt }`.
- Errors: `404 not_found` (foreign/archived task, bad ids), `404 attempt_not_found`, `428 optimistic_lock_required`,
  platform `409 optimistic_lock_conflict` when stale, `409 attempt_not_active` for a terminal / unknown attempt,
  `400 validation_failed` for a reason above 2000 chars, `403` via metadata without `attempts.manage`.
- Verified by jest (command + route tests) and a live smoke on :3100.

### Key Discoveries:

- Reserve command pattern (`commands/attempts.ts:127-261`): replay decided before the lock check, lock header
  required only when `ctx.request` exists, `enforceCommandOptimisticLockWithGuards(..., envValue: 'all')`, side effects
  after commit, audit via `buildLog` only when something changed.
- Route pattern (`api/tasks/[id]/attempts/route.ts`): `resolveDeliveryRouteContext` → `readRouteId` →
  `parseDeliveryInput` → `executeDeliveryCommand` (mutation guards, `operation: 'custom'`) → `deliveryErrorResponse`.
  `readRouteId(context, 'attemptId')` reads the second path param.
- `scopeChange.test.ts:255` pins the registered command id list; it must gain `delivery_os.attempts.cancel`. The new
  route path has no `baselines/decisions/results/evidence` segment, so the append-only route scan is unaffected.
- Route test kit (`api/__tests__/routeTestKit.ts`, `attemptRouteKit.ts`) already runs reserve, package, results and
  the project/task DELETE routes against an in-memory store — enough for an end-to-end route test.

## What We're NOT Doing

- Reconcile (R18, `delivery_os.attempts.reconcile`, feature `attempts.reconcile`) — next task.
- Stopping any external process or sending a signal to EXEC; enterprise pause/cancel in the workflow.
- New attempt fields (no `cancellationReason` on the frozen `ExecutionAttempt v1`), new error codes, events, ACL
  features, DI keys, migrations.
- UI (`AttemptActions.tsx`) and i18n files — UI stream; the audit label key is handed over as a patch request.
- Integration spec `TC-DELIVERY-007` — QA stream.

## Implementation Approach

Decisions (autonomous; answered from the master plan, the spec and the existing code):

1. **Reason storage** — audit entry only (`snapshotAfter.reason`), not on the attempt. The attempt DTO is frozen v1
   and the UI keeps strict copies; the audit log is the documented home of operator notes on operational commands.
2. **Repeated cancel** — idempotent: a `cancel_requested` attempt answers 200 with the same body and `changed: false`
   (no write, audit, event or index refresh), even with a stale version header, like the reserve replay. A network
   retry or double click must not produce a confusing 409. The header itself is still required (428).
3. **Check order** — scope → task row `PESSIMISTIC_WRITE` lock (404) → lock header present (428, only with
   `ctx.request`) → register readable (else `409 reconciliation_required`/`unreadable_attempt_register`, as the other
   attempt commands) → reducer → replay returns → optimistic lock (409 stale) → reducer failure
   (`404 attempt_not_found` / `409 attempt_not_active`) → write. Stale wins over a domain conflict, as in reserve.
4. **In-process callers** (no `ctx.request`) may cancel without a header, like the manual reserve in-process; the
   operation only records a request and is audited.
5. **Task status** stays `executing` (`statusReason` untouched). The task leaves `executing` only through reconcile or a
   result; `taskLifecycle` has no `executing → cancelled` edge by design.
6. **Command result** `AttemptCancelResult = { taskId, attemptId, changed, state, stopConfirmation,
   cancellationRequestedAt, taskStatus, taskUpdatedAt, attempt }`; the route returns only the five documented fields.
   `state` / `stopConfirmation` are typed as the literals the spec documents, so the response can never say `stopped`.
7. **Side effects** on change only, after commit: `emitTaskSideEffects(ctx, 'updated', task)` (query index) and
   `emitTaskUpdated(task)` (persistent `delivery_os.task.updated`).

## Phase 1: Cancel command

### Overview

Register `delivery_os.attempts.cancel` and prove its rules at command level.

### Changes Required:

#### 1. Command

**File**: `packages/core/src/modules/delivery_os/commands/attempts.ts`

**Intent**: Add the cancel command next to reserve, reusing `requestCancellation`, shared scope/lock helpers and the
task side-effect helpers.

**Contract**: id `delivery_os.attempts.cancel`; input `{ taskId: uuid, attemptId: uuid, reason?: string ≤ 2000 }`
(schema = `cancelAttemptSchema` extended with the two ids in `data/validators.ts` as `cancelAttemptCommandSchema`);
result `AttemptCancelResult` (exported type); `buildLog` → `delivery_os.audit.attempts.cancel` /
"Request execution attempt cancellation", `resourceKind` task, `snapshotAfter: { ...result, reason: reason ?? null }`
only when `changed`.

#### 2. Command tests

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/attempts.test.ts`

**Intent**: Cover: active (`reserved` and `claimed`) attempt → `cancel_requested` / `stop_unconfirmed` /
`cancellationRequestedAt`, task still `executing`, row lock taken, one `task.updated` event + index refresh + audit with
reason; repeat → `changed: false`, no event, even with a stale header; 428 without header; 409 stale; 409
`attempt_not_active` for `result_received` / `closed` / `reconciliation_required`; 404 unknown attempt; 404 foreign org;
400 reason > 2000; after cancel `reserve` (new key) → 409 `attempt_active`, `isArchiveBlocked` true,
`hasUnreconciledAttempt` false.

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/scopeChange.test.ts`

**Intent**: Add `delivery_os.attempts.cancel` to the pinned command id list.

### Success Criteria:

#### Automated Verification:

- Command and scope tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands --maxWorkers=2`
- Type check of the changed files passes (core `tsc --noEmit` scoped via temporary tsconfig for tests)

---

## Phase 2: Route R17, contract docs and live smoke

### Overview

Expose the command over HTTP with the documented body and prove the whole UA-18 path end to end.

### Changes Required:

#### 1. Response schema

**File**: `packages/core/src/modules/delivery_os/api/schemas.ts`

**Intent**: Add `attemptCancelResponseSchema = { attemptId: uuid, state: literal 'cancel_requested',
stopConfirmation: literal 'stop_unconfirmed', taskStatus, taskUpdatedAt: iso }`.

#### 2. Route

**File**: `packages/core/src/modules/delivery_os/api/tasks/[id]/attempts/[attemptId]/cancel/route.ts` (new)

**Intent**: POST handler following the reserve route: metadata `requireAuth` + `requireFeatures:
['delivery_os.attempts.manage']`; read `id` and `attemptId`; parse body with `cancelAttemptSchema`; run
`executeDeliveryCommand` (`operation: 'custom'`, path ids override body); return 200 with the five fields; `openApi`
with the 200 and 400/404/409/428 errors, wording that the stop is not confirmed.

#### 3. Route tests

**File**: `packages/core/src/modules/delivery_os/api/__tests__/cancel.route.test.ts` (new)

**Intent**: metadata guard (attempts.manage allowed, `delivery_os.*` allowed, projects.manage + results.import → not
allowed = 403); 401 without session; reserve → cancel → 200 with exactly the five keys matching the schema; repeat →
200; 428 / stale 409; foreign tenant/org → 404, unknown attempt 404; after cancel: reserve new key → 409
`attempt_active`, task DELETE and project DELETE → 409, late result import → 409 `attempt_cancelled` with zero evidence
rows; accepted result → cancel 409 `attempt_not_active` → identical replay → 200 `duplicate: true`. The route
params are built locally as `{ params: { id, attemptId } }` (`routeTestKit.routeParams` sets only `id`).

#### 4. Generated registry, spec, hand-over

- Run `yarn generate` (new route file is auto-discovered); report the generated diff (generated output is gitignored).
- `.ai/specs/2026-09-18-delivery-os-hackathon.md`: changelog line for T026.
- `context/changes/delivery-os-oss-domain/handover/OSS-04-L8c-cancel.md`: contract, check order, patch requests
  (UI: i18n key `delivery_os.audit.attempts.cancel`, render `stop_unconfirmed` honestly; EXEC: treat
  `attempt_cancelled` on claim/link as "do not run"; QA: TC-DELIVERY-007 candidates).

### Success Criteria:

#### Automated Verification:

- All delivery_os jest suites pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Core type check passes: `yarn turbo run typecheck --concurrency=2 --filter=@open-mercato/core` (or the core `tsc`)
- `yarn generate` completes and lists the new route
- Live smoke on :3100 (after core build + `yarn dev:app` restart): reserve → cancel answers the documented 200 body;
  repeat without header → 428; late result → 409 `attempt_cancelled`. Script `/tmp/t026/live.ts` reuses the T025 flow
  (project → draftSpec with an uploaded screen → baseline → two approvals → task → ready → reserve), then cancels,
  retries, tries reserve / task archive / late result, and deletes the created rows by SQL at the end

#### Manual Verification:

- Operator sees the cancelled attempt as "stop not confirmed" in the UI (UI stream, after their patch)

---

## Testing Strategy

### Unit Tests:

- Command rules and ordering in `commands/__tests__/attempts.test.ts` (in-memory EM mock from `baselineTestKit`).

### Integration Tests:

- Route-level end-to-end in `api/__tests__/cancel.route.test.ts`; Playwright TC-DELIVERY-007 belongs to QA.

### Manual Testing Steps:

1. Log in on :3100, reserve an attempt on a ready task, cancel it via API, read the task detail.
2. Try to reserve again and to archive the task — both 409.

## References

- Master plan: `context/changes/autonomous-software-delivery/plan.md:107-131`, spec
  `.ai/specs/2026-09-18-delivery-os-hackathon.md` rows R17 / UA-18.
- Pattern: `packages/core/src/modules/delivery_os/commands/attempts.ts:127` (reserve),
  `api/tasks/[id]/attempts/route.ts`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cancel command

#### Automated

- [x] 1.1 Command and scope tests pass
- [x] 1.2 Type check of the changed files passes

### Phase 2: Route R17, contract docs and live smoke

#### Automated

- [x] 2.1 All delivery_os jest suites pass
- [x] 2.2 Core type check passes
- [x] 2.3 yarn generate completes and lists the new route
- [x] 2.4 Live smoke on :3100 returns the documented body

#### Manual

- [ ] 2.5 Operator sees the cancelled attempt as "stop not confirmed" in the UI
