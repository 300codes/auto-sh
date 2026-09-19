<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L6) In-process Manual End-to-end Flow Test

- **Plan**: context/changes/asd-oss-t017-oss-02-l6-add-the-in-process-manual/plan.md
- **Mode**: Deep (main-context verification, no sub-agent — 16 GB RAM rule)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
5/5 paths ✓ (routeTestKit.ts, attemptRouteKit.ts, baselineTestKit.ts, module-registration.test.ts, spec file), symbols ✓ (`baseline_not_approved` commands/tasks.ts:346, `checkTaskReservable` before the lock-free baseline check in commands/attempts.ts:171, `activeBaselineId` written only in commands/decisions.ts:189, task create does not require an active baseline commands/tasks.ts:518), brief↔plan ✓. Verified claims: reserve on a draft task answers `409 task_not_ready` before any baseline check; task creation works on a non-active baseline, so the negative legs are reachable.

## Findings

### F1 — Negative "decisions skipped" leg proves only the status gate at reserve

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Legs
- **Detail**: Without decisions the task cannot become ready, so reserve fails on `task_not_ready`, not on the baseline. The `baseline_not_active` defence in the reserve command is untested by this suite (and cannot be reached without a seeded shortcut the task forbids).
- **Fix**: State this explicitly in the plan and point at the existing coverage in `commands/__tests__/attempts.test.ts`.
- **Decision**: FIXED

### F2 — Typecheck command imprecise

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria
- **Detail**: `tsc --noEmit -p .` "or the package script" leaves a choice; the package has `typecheck: tsc --noEmit`. Must run once, alone (RAM rule).
- **Fix**: Use `yarn workspace @open-mercato/core typecheck`, foreground, once.
- **Decision**: FIXED

### F3 — ESLint must run from the repo root

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria
- **Detail**: The flat config lives at the root; running from the package dir may pick no config.
- **Fix**: Note "run from the repo root".
- **Decision**: FIXED
