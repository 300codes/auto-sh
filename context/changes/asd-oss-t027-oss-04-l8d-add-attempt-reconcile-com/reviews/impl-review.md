<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-04 (L8d): attempt reconcile command and route R18

- **Plan**: context/changes/asd-oss-t027-oss-04-l8d-add-attempt-reconcile-com/plan.md
- **Scope**: Phases 1-2 of 2 (independent read-only sub-agent review + success criteria re-run)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-run: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 41 suites,
1022 tests green; `tsc --noEmit -p packages/core` → 0 errors; eslint on touched files clean; `yarn generate` lists the
route; live smoke on :3100 green (`/tmp/t027/live.log`). Manual row 2.6 stays open for a human.

## Findings

### F1 — Release under a blocked ancestor wrote `blocked` with no reason

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/reconcile.ts:88-92
- **Detail**: With a blocked ancestor the released task became `blocked` / null. `planUnblockPropagation` revives only `dependency_blocked` tasks and treats any other blocked task as a root block, so the task and its dependants would stay blocked after the ancestor recovers.
- **Fix**: Write `dependency_blocked` when `blockedAncestorIds` is not empty; test added.
- **Decision**: FIXED

### F2 — Missing tests: `completed` from `blocked` with dependants, blocked-ancestor release, event list on the completed route path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/reconcile.test.ts, api/__tests__/reconcile.route.test.ts
- **Fix**: Two command tests and one route assertion added.
- **Decision**: FIXED

### F3 — Actor check (403) runs before the scope load (404) for in-process callers

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/reconcile.ts:126
- **Detail**: Over HTTP the route checks scope first, so nothing leaks; in-process callers are trusted code.
- **Decision**: ACCEPTED

### F4 — Correction round is derived from the register

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Detail**: Matches plan decision 3; `checkReopenAllowed` refuses draft/ready once a result exists, so the odd path is not reachable through `tasks.update`. Listed as a limitation in the hand-over.
- **Decision**: ACCEPTED

### F5 — Reconcile unblocks dependants on any exit from `blocked`, `tasks.update` only for draft/ready

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Detail**: Deliberate (plan decision 5): a task that left `blocked` for `awaiting_review` no longer justifies `dependency_blocked` dependants. Dependants go to `draft`, never straight to `ready`.
- **Decision**: ACCEPTED

### F6 — Plan drift: `onEvaluated` callback instead of a returned hash, no `statusReasonOverride`, two extra exports

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Detail**: The hash must survive a throw for the unique-violation recovery of `results.accept`; the override is not needed because `blocked → awaiting_review` is not locked by `reconciliation_required`. `toLifecycleTask` and `unreadableRegisterError` exports avoid duplication.
- **Decision**: DISMISSED (benign, documented in the spec changelog)
