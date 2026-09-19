<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L4e) attempt reservation command and pure TaskPackage builder

- **Plan**: context/changes/asd-oss-t013-oss-02-l4e-add-attempt-reservation-c/plan.md
- **Scope**: Phases 1–2 of 2 (one read-only sub-agent; no second agent because of the hard RAM rule)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS — jest 19 suites / 548 tests, `tsc --noEmit` 0 errors, eslint clean |

## Findings

### F1 — Reservation could pin a baseline that is superseded concurrently

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/attempts.ts (transaction head)
- **Detail**: Only the task row was locked and the project was read without a lock, while `decisions.record` changes `activeBaselineId` under the project lock only. A concurrent reject/supersede could commit next to a reservation that passed the `baseline_not_active` check.
- **Fix**: Lock in the sibling order project → task (unlocked task read, `lockScopedProject`, `lockScopedTask`). Reservations of one project serialise, which is fine with `maxParallelTasks` ≤ 8.
- **Decision**: FIXED (test asserts the lock order and one transaction)

### F2 — `automatic` trust relies on a missing `ctx.request`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/attempts.ts `assertExecutionModeAllowed`
- **Detail**: This is the rule the spec freezes (line 250). It stays safe only while the command is never registered as workflow-safe and route R14 builds its input from `reserveAttemptBodySchema` alone.
- **Fix**: Record both conditions in the hand-over for the routes task and EXEC.
- **Decision**: FIXED (hand-over note); the rule itself is ACCEPTED as specified

### F3 — Builder did not re-hash the stored baseline content

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lib/taskPackage.ts
- **Detail**: Altered content that still parses would have been exported under the old hash.
- **Fix**: Compare `hashCanonical(baseline.content)` with `contentHash`; refuse with `hash_mismatch` / `stored_content_altered`.
- **Decision**: FIXED (with test)

### F4 — Test gaps

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/attempts.test.ts
- **Detail**: Missing: one transaction, in-process manual without header, malformed header, stale header before `attempt_active`, trusted option over HTTP, `unknown_target_profile`.
- **Fix**: Add the tests.
- **Decision**: FIXED

### F5 — A gone task answers 404, siblings answer 409 when a lock header was sent

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: commands/attempts.ts
- **Detail**: The spec says a foreign or missing scope answers 404 for reserve, and T012 took the same decision for its commands.
- **Decision**: DISMISSED — 404 is the specified answer

### F6 — Dependencies are read without a lock

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/attempts.ts
- **Detail**: `tasks.update` takes the project lock first, so after F1 a same-project dependency can no longer change during a reservation.
- **Decision**: FIXED via F1
