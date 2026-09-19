<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L4f) minimal idempotent result acceptance

- **Plan**: context/changes/asd-oss-t014-oss-02-l4f-add-minimal-idempotent-re/plan.md
- **Scope**: Phases 1–2 of 2 (one read-only sub-agent, hard RAM rule)
- **Date**: 2026-09-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: delivery_os jest 21 suites / 603 tests green; `yarn workspace @open-mercato/core typecheck` clean; eslint of touched files clean; grep shows only `tx.create` + find for `DeliveryEvidence`. Manual row 2.4 stays open for a human.

## Findings

### F1 — Unique-violation recovery did not name the constraint

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/evidence.ts (catch block)
- **Detail**: Any 23505 with a matching winner row would be reported as duplicate once OSS-04 adds inserts to the transaction.
- **Fix**: `isUniqueViolation(error, 'delivery_evidence_result_manifest_uq')` + tests for another constraint and for no winner row.
- **Decision**: FIXED

### F2 — Post-commit emits are not repaired by a replay

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: commands/evidence.ts (after the transaction)
- **Detail**: If an accept-only side effect throws after commit, the retry takes the duplicate path and re-emits only `evidence.recorded`. Same behaviour as attempts.ts / baselines.ts (module-wide).
- **Fix**: Module-wide hardening in OSS-06, not here.
- **Decision**: SKIPPED — module-wide pattern, recorded in the hand-over

### F3 — `attempt_not_found` from the builder lost its detail message

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: lib/taskPackage.ts:95
- **Fix**: Re-add `message: 'No such attempt on this task'`.
- **Decision**: FIXED

### F4 — Result gate runs twice (evaluate + reducer)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Detail**: Harmless; the reducer must stay safe when called on its own.
- **Decision**: DISMISSED — intentional defence in depth

### F5 — `result_received` attempt is not closed

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Detail**: Matches "What We're NOT Doing" (closing belongs to OSS-04); noted in the hand-over.
- **Decision**: ACCEPTED
