<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-04 (L8c): attempt cancel command and route R17

- **Plan**: context/changes/asd-oss-t026-oss-04-l8c-add-attempt-cancel-comman/plan.md
- **Mode**: Deep (claims verified directly against the code, no sub-agent: the touched surface is two files and was read in full)
- **Date**: 2026-09-19
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding
Grounding: 6/6 paths ✓ (commands/attempts.ts, data/validators.ts, api/schemas.ts, scopeChange.test.ts, attempts.test.ts, spec), 5/5 symbols ✓ (requestCancellation, cancelAttemptSchema, emitTaskSideEffects, emitTaskUpdated, enforceCommandOptimisticLockWithGuards), brief↔plan ✓.
Risky claims verified: `cancel_requested` is in ACTIVE_ATTEMPT_STATES (reserve → attempt_active, archive guard commands/projects.ts:145 → attempt_active); results.accept closes the attempt on accept (commands/evidence.ts:148 closeAttempt), so cancel after accept → attempt_not_active and the replay path is duplicate; checkAttemptAcceptsResult answers attempt_cancelled for cancel_requested.

## Findings

### F1 — Live smoke fixture path not specified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Success Criteria (live smoke)
- **Detail**: Reserving needs a ready task on an approved baseline (project → draftSpec with an uploaded screen → baseline → two approvals → task → ready). The plan does not say how the smoke builds that.
- **Fix**: Reuse the T025 live script flow (`/tmp/t025/live.ts`) in `/tmp/t026/live.ts`, then cancel, retry, late result, archive attempts, and SQL cleanup of the created rows.
- **Decision**: FIXED

### F2 — Audit snapshot content ambiguous

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Command contract
- **Detail**: "`snapshotAfter: { ...result without attempt?, reason }`" leaves a guess.
- **Fix**: `snapshotAfter: { ...result, reason: reason ?? null }` (full attempt kept, like the internal attempt commands).
- **Decision**: FIXED

### F3 — Route test params need both ids

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Route tests
- **Detail**: `routeTestKit.routeParams(id)` sets only `id`; the cancel route reads `attemptId` too.
- **Fix**: Build `{ params: { id, attemptId } }` locally in the new test (no kit change needed).
- **Decision**: FIXED
