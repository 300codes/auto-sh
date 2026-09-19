<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L4f) minimal idempotent result acceptance

- **Plan**: context/changes/asd-oss-t014-oss-02-l4f-add-minimal-idempotent-re/plan.md
- **Mode**: Deep, done in the main context (no sub-agent: hard RAM rule on this machine, same choice as T012/T013)
- **Date**: 2026-09-19
- **Verdict**: SOUND after fixes (was REVISE)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 6/6 paths ✓, symbols ✓ (`buildTaskPackageV1` has no callers outside lib/tests; `typecheck` script exists in packages/core), brief↔plan ✓, Progress↔Phase ✓

## Findings

### F1 — Read-after-mutation ordering inside the transaction is not stated

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — commands/evidence.ts
- **Detail**: packages/core/AGENTS.md forbids `em.find*` between scalar mutations and flush. The flow lists reads and writes but does not pin that every read (task, project, baseline, evidence lookup) happens before the first mutation.
- **Fix**: Add a Critical Implementation Details note: all reads first, then `create/persist` + task mutation, nothing read afterwards.
- **Decision**: FIXED

### F2 — Manifest for another attempt posted against an attempt that already has a result

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — evaluate order
- **Detail**: With idempotency first, a manifest whose `attemptId` differs from the input attempt answers `result_conflict` (not `correlation_mismatch`) when the input attempt already has a result. That is consistent with the frozen order but must be a conscious, tested choice.
- **Fix**: Record it in Decisions and cover it with a lib test.
- **Decision**: FIXED

### F3 — Race-recovered duplicate needs the current completionDelivery

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — decision 13
- **Detail**: The re-emitted event carries `completionDelivery`; after a unique violation the value must come from the winner's committed register, not from the loser's in-memory task.
- **Fix**: State that the recovery re-reads the task with a fresh EM and takes status, updatedAt and the attempt's completionDelivery from it.
- **Decision**: FIXED

### F4 — `task` argument of evaluate is used only by no-op seams

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1
- **Detail**: The signature is fixed by the task description and OSS-04 needs `allowedPaths` there.
- **Fix**: Keep; no change.
- **Decision**: DISMISSED — signature is given by the task

### F5 — Typecheck command

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 success criteria
- **Detail**: `yarn workspace @open-mercato/core typecheck` exists (`tsc --noEmit`); the "or" alternative is noise.
- **Fix**: Keep the first command only when running.
- **Decision**: ACCEPTED
