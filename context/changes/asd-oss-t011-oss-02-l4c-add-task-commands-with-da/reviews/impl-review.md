<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L4c) task commands

- **Plan**: context/changes/asd-oss-t011-oss-02-l4c-add-task-commands-with-da/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-09-19
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes
- **Findings**: 0 critical, 3 warnings, 4 observations (one read-only sub-agent; no builds run by it)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run after the fixes: delivery_os jest folder 15 suites / 462 tests green; `tsc --noEmit` for
`@open-mercato/core` exit 0; eslint on `commands/` clean. Manual row 1.5 stays open for a human.

## Findings

### F1 — First task lookup leaves the transaction and takes a second connection
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/shared.ts (`lockTaskForWrite`)
- **Detail**: `tx.fork()` drops the transaction context (MikroORM 7.1.14), so each update/delete used two pooled connections.
- **Fix**: `tx.fork({ keepTransactionContext: true })` — separate identity map, same connection.
- **Decision**: FIXED

### F2 — A task could leave review through `blocked → ready` and run again
- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: commands/tasks.ts (`checkStatusChange`)
- **Detail**: `awaiting_review → blocked → ready` was accepted once the attempt was closed, bypassing the review decision and the correction budget.
- **Fix**: `checkReopenAllowed` refuses `→ draft|ready` when any attempt carries an accepted result (`409 invalid_transition` / `result_awaits_review`); `cancelled` and `blocked` stay allowed. Test added.
- **Decision**: FIXED

### F3 — Unblock propagation fired on `blocked → cancelled`
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/tasks.ts (`planPropagation`)
- **Fix**: propagate the unblock only when the new status is `draft` or `ready`. Test added (also proves `correction_limit_reached` is kept).
- **Decision**: FIXED

### F4 — `blocked (dependency_blocked) → draft` accepted under a still-blocked ancestor
- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Fix**: refused with `409 invalid_transition` / `dependency_blocked`. Test added.
- **Decision**: FIXED

### F5 — Missing baseline in the ready gate answered `hash_mismatch`
- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Fix**: both paths now answer `422 foreign_reference` / `foreign_baseline`.
- **Decision**: FIXED

### F6 — Post-commit side-effect loop has no per-task isolation
- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Decision**: DISMISSED — same pattern as `commands/projects.ts` and the customers reference; the UI re-reads on any `task.updated`.

### F7 — Delete accepts `verified` / `awaiting_review` tasks
- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Decision**: ACCEPTED — soft delete; evidence rows are append-only and stay. Noted in the hand-over.
