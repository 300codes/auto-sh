<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L4b) project commands

- **Plan**: context/changes/asd-oss-t010-oss-02-l4b-add-project-commands-with/plan.md
- **Mode**: Deep (claims verified inline, no sub-agent — memory rule of the environment)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

6/6 paths ✓ (`commands/` is new by design), symbols ✓ (`enforceCommandOptimisticLockWithGuards`,
`enforceRecordGoneIsConflict`, `findOneWithDecryption(em, entity, where, options, scope)`, `parseAttemptRegister`,
`isAttemptActive`, `hasUnreconciledAttempt`, `emitCrudSideEffects`, `requireId`), brief↔plan ✓.
Verified: the command bus treats a handler without `undo` as non-undoable (`command-bus.ts:294,361`), so
decision 6 is safe. `emitDeliveryOsEvent` does not swallow bus errors; customers commands do not catch either.

## Findings

### F1 — Archive guard races with a concurrent reservation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1, Critical Implementation Details
- **Detail**: Delete locks only the project row and reads tasks without a lock. A reserve command locks the task
  row (T008 notes), so a reservation can commit between the guard read and the soft delete, leaving an archived
  project with a live attempt — exactly what UA-04 forbids.
- **Fix**: Load the project's live tasks with `PESSIMISTIC_WRITE` inside the delete transaction. Lock order is
  project → tasks; reserve takes only the task lock, so no deadlock. Hand over to the attempts task: after
  locking the task, reserve must load the project with `deletedAt: null` (404 when archived).
- **Decision**: FIXED

### F2 — `withDeliveryTransaction` wrapper adds nothing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §1
- **Detail**: A pass-through over `em.transactional` with confusing wording ("transactionalEm-free"). The task asks
  for a row-lock helper used inside `em.transactional`, which `lockScopedProject/Task` already are.
- **Fix**: Drop the wrapper; commands call `em.transactional` directly. Add `lockScopedProjectTasks`.
- **Decision**: FIXED

### F3 — Generation criterion is not runnable as written

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 success criteria
- **Detail**: "yarn generate lists the three command ids" names no file. The registry is
  `apps/mercato/.mercato/generated/command-loaders.generated.ts` (gitignored, so nothing to commit).
- **Fix**: Name the file and the grep in the criterion text of the Phase block (Progress title unchanged).
- **Decision**: FIXED

### F4 — Event persistence not stated

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1
- **Detail**: `project.created` is a `crud` category event that workflow triggers may subscribe to; customers CRUD
  events are persistent.
- **Fix**: Emit with `{ persistent: true, tenantId, organizationId }`.
- **Decision**: FIXED
