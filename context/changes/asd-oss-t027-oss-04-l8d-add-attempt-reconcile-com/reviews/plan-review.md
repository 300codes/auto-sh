<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-04 (L8d): attempt reconcile command and route R18

- **Plan**: context/changes/asd-oss-t027-oss-04-l8d-add-attempt-reconcile-com/plan.md
- **Mode**: Deep (claims verified directly against the code, no sub-agent — the touched surface is 6 files already read)
- **Date**: 2026-09-19
- **Verdict**: SOUND after fixes (was REVISE)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
6/6 paths ✓ (`commands/evidence.ts`, `commands/tasks.ts`, `commands/attempts.ts`, `data/validators.ts`, `api/schemas.ts`, `commands/__tests__/scopeChange.test.ts`), 5/5 symbols ✓ (`reconcileAttempt`, `reconcileAttemptSchema`, `checkReadyGate`, `applyPropagation`, `readCappedRouteBody`), brief↔plan ✓. Lock order checked: reserve = project → task, tasks.update = project → tasks, results.accept = task only; reconcile = project → tasks cannot deadlock with them.

## Findings

### F1 — Status reason is not specified for every exit from `blocked`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Desired End State / decision 4
- **Detail**: A task that is `blocked / reconciliation_required` and is then released while the ready gate fails stays `blocked`. The plan does not say the reason must be cleared; a left-over `reconciliation_required` would keep the task locked with no unknown attempt left, and no command could clear it.
- **Fix**: State that every reconcile writes the reason explicitly: `reconciliation_required` only for `unknown`, null otherwise.
- **Decision**: FIXED

### F2 — Expected task status before reconcile is not stated

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach
- **Detail**: `tasks.update` refuses any status change while an attempt is active or unknown (`checkProjectArchivable` in `checkStatusChange`), so the task is `executing` or `blocked / reconciliation_required`. The plan should say that any other combination is answered by `canTransition` (`409 invalid_transition`) rather than forced, and that `unknown` on an already blocked task is a no-op for the status.
- **Fix**: Add the sentence to decision 7.
- **Decision**: FIXED

### F3 — "No container key other than …" assertion is brittle

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, tests
- **Detail**: The lock guard and attachment verification resolve platform services; pinning exact keys will break on unrelated platform changes. The real risk is a queue, command bus or workflow call.
- **Fix**: Assert a deny-list: `container.resolve` is never called with `commandBus`, `queue`-like or `workflow`-like keys, and the emitted event ids are a subset of `task.updated` / `evidence.recorded`; also assert no new attempt appears in the register.
- **Decision**: FIXED

### F4 — Un-block propagation moves descendants to `draft`, not back to `ready`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: decision 5
- **Detail**: This is the existing behaviour of `planUnblockPropagation`; a human sets them ready again. Consistent with `tasks.update`, mention in the hand-over.
- **Fix**: Note in the hand-over.
- **Decision**: ACCEPTED
