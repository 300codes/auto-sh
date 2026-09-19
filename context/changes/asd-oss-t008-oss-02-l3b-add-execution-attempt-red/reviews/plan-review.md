<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L3b) attempt reducers and baseline rules

- **Plan**: context/changes/asd-oss-t008-oss-02-l3b-add-execution-attempt-red/plan.md
- **Mode**: Deep (done inline, no sub-agent: two new pure files, no callers yet)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
5/5 paths ✓ (contracts.ts, hash.ts, targetProfiles.ts, taskLifecycle.ts, fixtures/baseline-content.v1.json), symbols ✓
(`executionAttemptSchema`, `ACTIVE_ATTEMPT_STATES`, `hashCanonical`, core `typecheck` script), brief↔plan ✓, Progress↔Phase ✓.

## Findings

### F1 — Profile id/version live on the task, not on the baseline

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries, decisions table, Phase 2 contract
- **Detail**: The plan says baselines carry `target_profile_id/version` (`entities.ts:171-175`). Those columns belong to `DeliveryTask` (spec `:117`, "copied from project at creation"). `DeliveryBaseline` has no profile columns, so the readiness check as planned cannot be fed.
- **Fix**: Compare `task.targetProfileId/Version` with the resolved `profile`; keep codes (`unknown_target_profile` when the profile is undefined, `baseline_mismatch`/`target_profile_mismatch` replaced by `unknown_target_profile` detail `target_profile_mismatch`, since no baseline is involved).
- **Decision**: FIXED

### F2 — Unparsable `decidedAt` is undefined behaviour

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — decisions
- **Detail**: Ordering by `decidedAt` with an invalid date gives `NaN` comparisons and an arbitrary winner.
- **Fix**: Accept `string | Date`; a decision with an invalid date makes its kind unapproved (fail closed). Add a test.
- **Decision**: FIXED

### F3 — Reconcile `completed` can be followed by another resolution

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — reconcileAttempt
- **Detail**: State stays untouched after `completed`, so a later `not_started`/`stopped`/`unknown` is still possible. That is intended (the manifest may turn out invalid and the human corrects the observation) but was not written down or tested.
- **Fix**: State it in the contract and add a test: `completed` then `unknown` → `reconciliation_required`; the last reconciliation record wins.
- **Decision**: FIXED

### F4 — `missing_render` for brief-only projects

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — readiness
- **Detail**: A `from_brief` project also needs a render before any task is ready. This is the master-plan rule (ready requires a render/snapshot and both decisions), already listed under Open Risks in the brief.
- **Fix**: none.
- **Decision**: ACCEPTED
