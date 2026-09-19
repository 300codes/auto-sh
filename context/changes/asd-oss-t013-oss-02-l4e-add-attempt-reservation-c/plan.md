# OSS-02 (L4e): attempt reservation command and pure TaskPackage builder — Implementation Plan

## Overview

Add the pure `buildTaskPackageV1` (`lib/taskPackage.ts`) and the `delivery_os.attempts.reserve` command
(`commands/attempts.ts`) to `packages/core/src/modules/delivery_os/`. Reservation is the visible
"agent proposes, system decides" gate in front of every executor start: one key reserves one attempt, and only a
trusted in-process caller may reserve in `automatic` mode. Paths below are relative to the module folder.

## Current State Analysis

All domain rules exist as pure reducers (`lib/attempts.ts` `reserveAttempt`, `checkAttemptOpen`;
`lib/taskLifecycle.ts` `canTransition`; `lib/targetProfiles.ts` `assertRevisionKind`) and shared command helpers
(`commands/shared.ts`). Nothing writes `executionAttempts` yet, no package builder exists, and four helpers that
reserve needs are private in `commands/tasks.ts`. See `research.md`.

## Desired End State

- `buildTaskPackageV1({ project, task, baseline, attempt, profile })` returns
  `{ ok: true, taskPackage }` that parses with `taskPackageV1Schema` and equals the shipped fixtures, or a
  `DeliveryCheckResult` failure. It performs no IO.
- `delivery_os.attempts.reserve` is registered and returns
  `{ created, attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl }`; without `created` the
  result parses with `reserveAttemptResponseSchema`.
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` is green and the scoped
  typecheck passes.

### Key Discoveries:

- `reserveAttempt` already orders replay → `idempotency_conflict` → `reconciliation_required` → `attempt_active`
  → `attempt_limit_reached` (`lib/attempts.ts:133`); `baselineHash` is unused on the replay path.
- A task with an active attempt is `executing`, and one with an unknown attempt is `blocked`. So register conflicts
  must be reported before `task_not_ready`, otherwise `attempt_active` and `reconciliation_required` are unreachable.
- `task-package.v1.json` is exactly the package of a task with AC-001 + AC-002 over `baseline-content.v1.json`
  (AC-003 excluded), so the builder test can use `toEqual` against the fixture.
- A duplicate writes no audit entry when `buildLog` returns `null` (`commands/baselines.ts:214`).

## What We're NOT Doing

- No API routes (R14/R15), no claim / link_workflow / mark_delivery / cancel / reconcile commands, no result import.
- No UI, i18n, integration tests, enterprise code, migrations or dependency changes.
- No change to the frozen v1 error catalogue or to published schemas and fixtures.
- The command does not call the builder; the GET route (next task) does.

## Implementation Approach

Two small phases: the pure builder first (no dependencies), then the command. Decisions taken (self-answered
planning questions):

| # | Question | Decision | Why |
|---|----------|----------|-----|
| 1 | Check order for a new key | replay → `idempotency_conflict` → lock header (428/400/409) → other register conflicts → task-level checks in this order: status → dependencies → profile (`unknown_target_profile`) + revision kind (`revision_kind_mismatch`) → baseline → `canTransition` with the correction budget | Spec: replay is checked before the lock; a stale client must refresh before it is told about domain state; register conflicts must precede `task_not_ready` to be reachable |
| 2 | Lock with `OM_OPTIMISTIC_LOCK=off` | Exactly when `ctx.request` exists: header required and compare forced (`envValue: 'all'`) for a new key | Same rule as T012 decisions; the safety gate must not depend on an env opt-out |
| 3 | Lock without a request (trusted `automatic`, or any in-process call) | No header; the row lock serialises | In-process callers have no HTTP version token |
| 4 | Rejecting `automatic` | 403 `forbidden`, detail `trusted_execution_required`, for: `automatic` with `ctx.request`, `automatic` without `trustedExecution`, and `trustedExecution` sent with `ctx.request` or with `manual_handoff` | Fail closed with a catalogue code; the public route still answers 400 from its literal body schema |
| 5 | Blocked task | 409 `task_not_ready` with detail `task_blocked`; other statuses detail `task_not_ready` | `task_blocked` is not a catalogue code |
| 6 | Dependencies | Every `dependsOnTaskIds` task must be live, in scope and `verified`, else 409 `dependency_not_verified` with one detail per task (`dependsOnTaskIds.<id>`); read without lock | Lock order note from T011: reserve locks only the task row |
| 7 | Superseded baseline | New key on a task whose `baselineId` is not `project.activeBaselineId` → 422 `baseline_not_active`; a baseline missing from the project → 422 `foreign_reference` / `foreign_baseline` | Never start an agent on stale scope |
| 8 | Unreadable register | 409 `reconciliation_required`, detail `unreadable_attempt_register` | Same fail-closed rule as the archive guard |
| 9 | Actor | No uuid actor required for `manual_handoff` (the register stores no actor; API-key callers must work); `trustedExecution.actorUserId` is schema-validated and stamped as `actorUserId` of the audit entry | EXEC bridge and QA scripts may reserve with an API key |
| 10 | Missing key | 400 `idempotency_key_required` before schema validation | Catalogue |
| 11 | Replay response | Attempt's pinned `baselineId`/`baselineHash`, current `task.updatedAt`; no writes, no events, no audit entry | The caller gets the current lock token |
| 12 | `attemptNumber` | Set to the register length on create | Column exists and nothing else maintains it |
| 13 | Builder scope rules | ACs = baseline ACs filtered by `task.acIds` in baseline order; requirements = those referenced by these ACs; `requiredTests` = `acTestMap` entries of these ACs; all baseline screens as `designArtifactRefs`; `description` omitted when empty; `baseCommit` only for git | Matches the fixtures |
| 14 | Builder refusals | `checkAttemptOpen`; attempt/task/baseline pin mismatch → `baseline_mismatch`; task outside the project → `correlation_mismatch`; unreadable content → `hash_mismatch`/`unreadable_baseline_content`; AC missing from baseline → `unknown_ac`; profile id/version ≠ task → `unknown_target_profile`; revision kind via `assertRevisionKind`; final schema parse | GET must never export an inconsistent package |

## Phase 1: Pure TaskPackage builder

### Overview

`lib/taskPackage.ts` + `lib/__tests__/taskPackage.test.ts`.

### Changes Required:

#### 1. Builder

**File**: `lib/taskPackage.ts`

**Intent**: Build TaskPackage v1 from plain records per decisions 13–14, no IO, no entity imports.

**Contract**: `buildTaskPackageV1(input: TaskPackageInput): { ok: true; taskPackage: TaskPackageV1 } | ({ ok: false } & DeliveryErrorResult)`.
`TaskPackageInput = { project: { id, repositoryRef?, limits }, task: { id, projectId, baselineId, title, description?, acIds, allowedPaths, targetProfileId, targetProfileVersion }, baseline: { id, projectId, contentHash, content: unknown }, attempt: ExecutionAttempt | undefined, profile: TargetProfile }`.
Entities satisfy these shapes structurally.

#### 2. Tests

**File**: `lib/__tests__/taskPackage.test.ts`

**Intent**: Output parses and `toEqual`s the git fixture; AC-003 and unused requirements excluded; wordpress-theme
gives a snapshot revision without `baseCommit`; git revision on a snapshot profile refused; cancelled, closed,
unknown and missing attempts refused; pin mismatch, unknown AC and unreadable content refused; input not mutated.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` passes, including `fixtures.test.ts`

---

## Phase 2: `delivery_os.attempts.reserve`

### Overview

Command, validator, registration, exports from `tasks.ts`, tests, spec/hand-over notes.

### Changes Required:

#### 1. Validator

**File**: `data/validators.ts`

**Intent**: Typed command input including the internal option.

**Contract**: `reserveAttemptCommandSchema = { taskId: uuid, idempotencyKey, mode: attemptModeSchema, baseRevision, trustedExecution?: strict { source: 'delivery_agents', actorUserId: uuid } }` and its inferred type. `reserveAttemptBodySchema` (public body) is unchanged.

#### 2. Shared helpers

**File**: `commands/tasks.ts`

**Intent**: Export `findProjectBaseline`, `loadCorrectionBudget`, `emitTaskSideEffects`, `emitTaskUpdated` for reuse. No behaviour change.

#### 3. Command

**File**: `commands/attempts.ts`, registered in `commands/index.ts`

**Intent**: Implement decisions 1–12 inside one `em.transactional`: `lockScopedTask` → `requireScopedProject`
(archived → 404) → `parseAttemptRegister` → `reserveAttempt` with payload `{ mode, baseRevision }`, fresh
`randomUUID()`, ISO now → ordered checks → persist register, `attemptNumber`, `status = 'executing'`,
`statusReason = null`. After commit: CRUD side effects + exactly one `delivery_os.task.updated`. `buildLog` returns
`null` for a replay.

**Contract**: `AttemptReserveResult = ReserveAttemptResponse & { created: boolean }`; exported pure check
`checkTaskReservable(task, dependencies)` for the status + dependency rules.

#### 4. Tests

**File**: `commands/__tests__/attempts.test.ts`

**Intent**: Every case listed in the task, plus: missing key, missing header 428, archived project 404, blocked
task detail, superseded baseline, revision kind mismatch, `changes_requested` with correction budget exhausted,
unreadable register, forced compare with `OM_OPTIMISTIC_LOCK=off`, result parses with `reserveAttemptResponseSchema`.

#### 5. Docs

**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (changelog line + detail codes),
`context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md` (hand-over section).

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes
- Scoped typecheck of `@open-mercato/core` reports no errors in `delivery_os`
- `yarn lint` scoped to the touched files is clean

#### Manual Verification:

- A human confirms over HTTP (after the routes task) that a second reserve with the same key returns 200 and a stale header on a new key returns 409

---

## Testing Strategy

Unit tests only, with the in-memory store and mocked `findWithDecryption` pattern of `commands/__tests__/tasks.test.ts`.
Real two-connection races and HTTP belong to the routes task and QA `TC-DELIVERY-*`.

## Performance Considerations

One row lock and at most four small reads per reservation. No concerns.

## Migration Notes

None. No schema change.

## References

- Research: `context/changes/asd-oss-t013-oss-02-l4e-add-attempt-reservation-c/research.md`
- Pattern: `commands/decisions.ts`, `commands/tasks.ts`, `commands/__tests__/tasks.test.ts`
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md:250,304,305`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure TaskPackage builder

#### Automated

- [x] 1.1 `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` passes, including `fixtures.test.ts`

### Phase 2: delivery_os.attempts.reserve

#### Automated

- [x] 2.1 `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes
- [x] 2.2 Scoped typecheck of `@open-mercato/core` reports no errors in `delivery_os`
- [x] 2.3 `yarn lint` scoped to the touched files is clean

#### Manual

- [ ] 2.4 A human confirms over HTTP (after the routes task) that a second reserve with the same key returns 200 and a stale header on a new key returns 409
