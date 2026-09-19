# OSS-04 (L8a): claim, link_workflow, mark_delivery and closing the attempt on accept — Implementation Plan

## Overview

Deliver the internal OSS commands the EXEC bridge needs for the live vertical trial —
`delivery_os.attempts.claim`, `delivery_os.attempts.link_workflow`, `delivery_os.attempts.mark_delivery` — on top of
pure, tested reducers, and make `delivery_os.results.accept` close the attempt (`closedAt`, `outcome: 'result_accepted'`)
in the same transaction as the evidence write. A duplicate accept keeps re-emitting `delivery_os.evidence.recorded`
with the current `completionDelivery`, so a pending delivery is retried without re-running anything.

## Current State Analysis

- `lib/attempts.ts` has `reserveAttempt`, `claimAttempt` (tested), `requestCancellation`, `reconcileAttempt`,
  `recordAttemptResult`; no reducer for the workflow link, the delivery mark or closing.
- `commands/attempts.ts` registers only `delivery_os.attempts.reserve`. Its trusted-context rule is
  `!ctx.request && trustedExecution` (`assertExecutionModeAllowed`, :61), misuse → `403 forbidden` / `trusted_execution_required`.
- `commands/evidence.ts` accept: locks the task row, writes evidence + `recordAttemptResult` atomically, emits
  `evidence.recorded` on accept and on both duplicate paths. It never sets `closedAt` / `outcome`.
- `commands/attemptQueries.ts#listPendingDeliveries` already filters on `completionDelivery === 'pending'`.
- The spec (`.ai/specs/2026-09-18-delivery-os-hackathon.md:251-256`) already names the three commands as
  "enterprise (internal)", "Internal commands have no HTTP route".
- `commands/__tests__/scopeChange.test.ts:261` pins the complete `delivery_os.*` command id list.
- DTO v1 has no delivery counter. The attempt DTO is not copied outside the module.

## Desired End State

EXEC can, in-process and only with `trustedExecution: { source: 'delivery_agents', actorUserId }`, claim an attempt
exactly once, link it to a workflow instance/step (and mark it dispatched), import the result through the same
`results.accept` as the manual route, and mark the completion delivery `delivered` or failed. After accept the attempt
carries `closedAt` + `outcome: 'result_accepted'`; `listPendingDeliveries` lists it until `mark_delivery` flips it to
`delivered`. Any caller with a `ctx.request` or without the trusted option gets `403`. Verified by the three named test
files, the whole `delivery_os` jest scope and `yarn workspace @open-mercato/core typecheck`.

### Key Discoveries:

- `claimAttempt` already implements the claim rules of the task (`lib/attempts.ts:198`), only the command is missing.
- `executionAttemptSchema` is a non-strict `z.object` stored in JSONB (`lib/contracts.ts:620`) → an optional field needs
  no migration and old registers keep parsing.
- `commands/tasks.ts:453` and three tests already treat `outcome: 'result_accepted'` as "has a result".
- The results harness (`commands/__tests__/results.test.ts`) seeds a reserved attempt whose key/payload equal a
  `manual_handoff` reserve of the published package, so a reserve replay can be driven there for the fake-executor flow.

## What We're NOT Doing

- No HTTP route, no ACL feature, no event id, no DI key, no migration, no generated-file change.
- No `cancel` / `reconcile` commands (next OSS-04 step), no unknown-after-restart scenario.
- No enterprise/bridge code (`packages/enterprise/**` is EXEC's); only the hand-over describing how to call the commands.
- No new error codes — the frozen list is reused with new `details[].code` values.
- No registration in the workflow-safe command allow-list (`packages/core/src/modules/workflows/lib/workflow-safe-commands.ts`):
  `UPDATE_ENTITY` builds a ctx without `request`, so registration would leave the input option as the only barrier. A
  static guard test pins that the module never calls `registerWorkflowSafeCommands`.
- The only API-visible effect is additive: task responses reuse `executionAttemptSchema` (`api/schemas.ts:117`), so they
  gain optional `deliveryAttempts`, and `closedAt` / `outcome` are non-null for result attempts.

## Implementation Approach

Pure reducers first (contract + lib tests), then thin commands sharing one private runner in `commands/attempts.ts`
(trusted gate → parse → transaction → `lockScopedTask` → reducer → write register → index side effect after commit),
then the accept change, then docs. Decisions (self-answered planning questions):

1. **State of a result-closed attempt**: stays `result_received`; `closedAt` and `outcome: 'result_accepted'` are added.
   Why: the state enum and the accept behaviour are in the H4/H9 hand-over that UI/QA/EXEC built on; setting the two
   null fields is additive, switching the state to `closed` would silently change a published behaviour.
2. **Delivery counter**: additive optional `deliveryAttempts` (int ≥ 0) on ExecutionAttempt v1; absent = 0. No default,
   so stored registers and every existing literal stay valid.
3. **Trusted gate**: shared `assertTrustedInternal(ctx, trustedExecution)`: a `ctx.request` or a missing option → `403
   forbidden` / `trusted_execution_required`; a malformed option (other source) → `400 validation_failed` (same as reserve).
   The gate runs on the raw presence of `ctx.request` BEFORE input parsing, so HTTP callers never get validation hints.
4. **Scope** only from `resolveDeliveryScope(ctx)`; foreign/archived task → `404 not_found` (existing helper).
5. **Lock**: task row `PESSIMISTIC_WRITE` via `lockScopedTask`; no project lock (nothing project-level is read), no
   optimistic-lock header (in-process only, serialised by the row lock).
6. **Errors without new codes**: other worker → `409 attempt_active` (exists); different workflow link → `409
   attempt_active` detail `workflow_link_conflict`; link on a closed/cancelled/unknown attempt → `checkAttemptOpen` codes;
   `mark_delivery` without a delivery to mark (`completionDelivery` null) → `409 attempt_not_active` detail
   `no_pending_delivery`; unreadable register → `409 reconciliation_required` (fail closed, as elsewhere).
7. **link_workflow shape**: `{ workflowRef, workflowStepId?, dispatched? }`. Link and dispatch marker may arrive in one
   or two calls (master plan: "enqueue before marking dispatched"). Same ref/step → idempotent; `dispatchedAt` is set
   once, the first time `dispatched: true` is seen; a `null`/omitted step never clears a stored step.
8. **mark_delivery shape**: `{ outcome: 'delivered' } | { outcome: 'failed', error }`. `delivered` on pending →
   delivered, clears `lastDeliveryError`, counter +1. `failed` on pending → stays pending, stores the error (cut to 2000
   chars), counter +1. Anything on an already delivered attempt → unchanged (`changed: false`); delivered never regresses.
9. **Side effects**: changed calls refresh the task query index (`emitTaskSideEffects`) after commit and write one audit
   entry stamped with the trusted actor; no domain event (task status does not change; avoids workflow trigger loops).
   Idempotent replays write nothing and log nothing.
10. **Command result**: `{ taskId, attemptId, changed, attempt, taskUpdatedAt }` for all three.

11. **Addendum after the implementation review (F1)**: decision 3 is tightened — the `trustedExecution` option must be the
    object issued in-process by `lib/trustedExecution.ts#issueTrustedExecution` (WeakSet registry); a JSON look-alike is
    refused. The same check now guards `attempts.reserve` (`automatic`) and `results.accept` (`adapter`, new optional
    command input). Reason: the notification / message action dispatchers run stored command ids without `ctx.request`
    and merge HTTP payloads into the input. The whole gate runs on the raw input before parsing.

## Phase 1: Contract field and pure reducers

### Overview

Additive DTO field and the three reducers with unit tests.

### Changes Required:

#### 1. Attempt DTO

**File**: `packages/core/src/modules/delivery_os/lib/contracts.ts`

**Intent**: Give the delivery retry counter a home without breaking DTO v1.

**Contract**: `executionAttemptSchema` gains `deliveryAttempts: z.number().int().min(0).optional()`.

#### 2. Reducers

**File**: `packages/core/src/modules/delivery_os/lib/attempts.ts`

**Intent**: `linkAttemptWorkflow`, `markAttemptDelivery`, `closeAttempt` following the existing reducer shape
(find → gate → validate through `executionAttemptSchema` → `replaceAttempt`, never mutating the input).

**Contract**:
- `linkAttemptWorkflow(register, { attemptId, workflowRef, workflowStepId?, dispatched?, now })` →
  `{ ok, attempt, register, changed }`; gate `checkAttemptOpen`; rules of decision 7.
- `markAttemptDelivery(register, { attemptId, outcome: 'delivered' | 'failed', error?, now })` → `{ ok, attempt,
  register, changed }`; rules of decision 8; requires `completionDelivery` pending or delivered.
- `closeAttempt(register, { attemptId, now })` (kept separate from `recordAttemptResult`, whose pinned result stays
  `closedAt: null, outcome: null`) → sets `closedAt` + `outcome: 'result_accepted'` only on an attempt that
  holds a `resultEvidenceId`; already closed with that outcome → unchanged; otherwise `409 attempt_not_active`.

#### 3. Tests

**File**: `packages/core/src/modules/delivery_os/lib/__tests__/attempts.test.ts` (+ one case in `contracts.test.ts` if it
enumerates attempt fields)

**Intent**: cover each rule above incl. input immutability, register validity, second claim conflict (exists),
delivered never regresses, counter increments, error truncation, old register without `deliveryAttempts` parses.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` is green

---

## Phase 2: Internal commands and closing the attempt on accept

### Overview

Three internal commands, accept closes the attempt, command-level tests incl. the fake-executor flow.

### Changes Required:

#### 1. Validators

**File**: `packages/core/src/modules/delivery_os/data/validators.ts`

**Intent**: zod schemas for the three command inputs; `trustedExecution` stays optional in the schema so the gate, not
the parser, answers 403 for a missing option.

**Contract**: `claimAttemptCommandSchema { taskId, attemptId, workerRef(1..200), trustedExecution? }`,
`linkAttemptWorkflowCommandSchema { taskId, attemptId, workflowRef(1..200), workflowStepId?(1..200|null), dispatched?, trustedExecution? }`,
`markAttemptDeliveryCommandSchema` = discriminated union on `outcome` (`delivered` | `failed` + `error` 1..8000) with the same ids.

#### 2. Commands

**File**: `packages/core/src/modules/delivery_os/commands/attempts.ts` (already imported by `commands/index.ts`)

**Intent**: register the three commands through one private runner (decisions 3–6, 9, 10). Not exported to any route.

**Contract**: ids `delivery_os.attempts.claim`, `.link_workflow`, `.mark_delivery`; result type
`AttemptInternalCommandResult`; exported for EXEC typing.

#### 3. Accept closes the attempt

**File**: `packages/core/src/modules/delivery_os/commands/evidence.ts`

**Intent**: after `recordAttemptResult`, apply `closeAttempt` to the same register inside the transaction, so evidence,
`resultEvidenceId`, `completionDelivery`, `closedAt`, `outcome` and task status commit together. Duplicate paths unchanged.

#### 4. Tests

**Files**: `commands/__tests__/attempts.test.ts`, `commands/__tests__/results.test.ts`, `commands/__tests__/scopeChange.test.ts`

**Intent**:
- attempts: trusted gate (request present → 403 before validation, missing option → 403, foreign source → 400,
  body-supplied tenant/org ignored, foreign org → 404), task row locked `PESSIMISTIC_WRITE` in one transaction,
  claim once / same worker idempotent / other worker 409, claim race → one winner, link rules, mark_delivery serialised
  and idempotent, audit entry stamped with the trusted actor only when changed, no domain event, unreadable register 409.
- results: accept sets `closedAt` + `outcome`; duplicate accept writes no evidence and re-emits the event with
  `completionDelivery: 'pending'`; fake-executor flow (manual-mode reserve replay without `trustedExecution` → claim → link_workflow(dispatched) →
  executor → accept → redelivered job whose claim answers `attempt_closed` → duplicate accept) invokes the executor once; `mark_delivery` flips `createDeliveryOsAttemptQueries(...).listPendingDeliveries`
  from one row to none; an OSS-only attempt never becomes pending and `mark_delivery` answers `no_pending_delivery`.
- scopeChange: add the three ids to the pinned list; assert no route file references them and no module file mentions
  `registerWorkflowSafeCommands`.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/attempts.test.ts src/modules/delivery_os/commands/__tests__/attempts.test.ts src/modules/delivery_os/commands/__tests__/results.test.ts --maxWorkers=2` is green
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` is green
- `yarn workspace @open-mercato/core typecheck` is green and the touched test files type-check with the temporary tsconfig of T023

---

## Phase 3: Spec and hand-over

### Overview

Record the contract for EXEC/QA/UI.

### Changes Required:

#### 1. Spec

**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`

**Intent**: Commands table rows for the three commands and `results.accept` (input shapes, trusted rule, closing),
ExecutionAttempt v1 field list gains `deliveryAttempts`, one changelog line.

#### 2. Hand-over

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-04-L8a-internal-commands.md`

**Intent**: command ids, input/result shapes, error table, trusted-context rule, call order for the bridge, recovery via
`listPendingDeliveries` + `evidence.recorded`, limitations, patch requests to other streams. Must state: call through
`commandBus.execute` (index flush + audit run there) with a ctx that has no `request`; never register the ids as
workflow-safe; task responses gain `deliveryAttempts` / non-null `closedAt` + `outcome`.

### Success Criteria:

#### Automated Verification:

- `yarn lint` scoped to core (`yarn workspace @open-mercato/core lint` or eslint on the touched files) reports no new problems
- `git status --short` shows only files owned by OSS

#### Manual Verification:

- EXEC confirms the command shapes fit `delivery_agents/lib/executionBridge.ts` (joint acceptance of Progress 4.1 / 4.7)

---

## Testing Strategy

### Unit Tests:

Reducers (pure) and commands (mocked EM store, as the existing harnesses). Race = two sequential executions against the
same store (the row lock serialises them in production): exactly one `changed: true` for the same worker, a 409 for another.

### Integration Tests:

None here — the commands have no HTTP surface; TC-DELIVERY-* belongs to QA. R16 (results route) behaviour is unchanged
apart from the two additive attempt fields.

### Manual Testing Steps:

1. Live smoke of R14 → R16 on :3100 after a core build to confirm the attempt in the task detail carries `closedAt` / `outcome`.

## Performance Considerations

One extra in-memory reducer per accept; the commands do a single locked row read and one flush.

## Migration Notes

None. Attempts accepted before this change keep `closedAt: null`; nothing reads `closedAt` for result attempts.

## References

- Research: `context/changes/asd-oss-t024-oss-04-l8a-add-claim-link-workflow-a/research.md`
- Master plan: `context/changes/autonomous-software-delivery/plan.md:326-330`, Progress 4.1 / 4.7
- Pattern: `packages/core/src/modules/delivery_os/commands/attempts.ts:110` (reserve), `commands/evidence.ts:100` (accept)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract field and pure reducers

#### Automated

- [x] 1.1 delivery_os lib jest scope is green

### Phase 2: Internal commands and closing the attempt on accept

#### Automated

- [x] 2.1 attempts (lib + commands) and results test files are green
- [x] 2.2 whole delivery_os jest scope is green
- [x] 2.3 core typecheck is green and touched test files type-check

### Phase 3: Spec and hand-over

#### Automated

- [x] 3.1 lint reports no new problems on the touched files
- [x] 3.2 git status shows only OSS-owned files

#### Manual

- [ ] 3.3 EXEC confirms the command shapes fit the execution bridge
