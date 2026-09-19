<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L3b) attempt reducers and baseline rules

- **Plan**: context/changes/asd-oss-t008-oss-02-l3b-add-execution-attempt-red/plan.md
- **Scope**: Phases 1–2 of 2 (one independent read-only reviewer sub-agent; two pure files, so drift and safety were reviewed together)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (one documented addition: `hash_mismatch` readiness reason) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after F1, F2 |
| Architecture | PASS (imports: `./contracts`, `./hash`, type-only `./targetProfiles`) |
| Pattern Consistency | PASS |
| Success Criteria | PASS — jest `src/modules/delivery_os` 11 suites / 372 tests, core `typecheck` exit 0, eslint clean |

## Findings

### F1 — A later reject naming another version was ignored

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lib/baseline.ts `latestBaselineDecisions`
- **Detail**: Spec `:164` says the latest decision per `(kind, subject_hash)` wins. The filter also required the version to match for rejects, so a later reject with a null/other version for identical content left the approve standing (fail open).
- **Fix**: Approvals must match hash + version; a reject voids on hash alone. Tests added.
- **Decision**: FIXED

### F2 — Non-canonical input threw instead of returning a failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lib/baseline.ts `buildBaselineContent`, lib/attempts.ts `reserveAttempt`
- **Detail**: `hashCanonical` / `structuredClone` throw on depth > 64, functions, `undefined`; `tokens` has no depth limit in zod, so L4 would answer 500.
- **Fix**: Guarded clone and hash → `400 validation_failed` (detail `not_canonical_json`). Tests added.
- **Decision**: FIXED

### F3 — `checkAttemptOpen` cannot gate a reconcile-completed manifest

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: lib/attempts.ts `checkAttemptOpen`
- **Detail**: After `completed` the state is untouched by design, so OSS-04 result acceptance needs its own gate.
- **Fix**: Recorded in the hand-over note for OSS-04.
- **Decision**: ACCEPTED (documented)

### F4 — Cancelled attempt closed with outcome `not_started`/`stopped`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lib/attempts.ts `reconcileAttempt`
- **Detail**: A late manifest would get `attempt_closed` instead of `attempt_cancelled`.
- **Fix**: Outcome is `cancelled` when a cancellation was requested; the observation stays in `reconciliation.resolution`. Tests added.
- **Decision**: FIXED

### F5 — Approve with unreadable time reported as `_rejected`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: lib/baseline.ts `collectReadinessReasons`
- **Fix**: New detail code `<kind>_decision_invalid`. Test added.
- **Decision**: FIXED

### F6 — Readiness does not check that the baseline is the project's active one

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: lib/baseline.ts `checkTaskReadiness`
- **Detail**: A task pinned to an older, still approved baseline is ready while a newer one is active. The spec's ready gate (UA-09) lists no `baseline_not_active`; the package pins `baselineId`/`baselineHash`, and verification requires evidence on the pinned baseline.
- **Fix**: None in the rule; recorded in the hand-over note so the L4 command decides with `project.activeBaselineId`.
- **Decision**: ACCEPTED (documented)

### F7 — Test gaps

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Detail**: Reconcile from `reserved`, reused key after close, frozen inputs for reconcile, throw paths.
- **Fix**: Added. `decidedAt` without an offset is left as is: the value comes from a `timestamptz` column (`Date`), not from user input.
- **Decision**: FIXED
