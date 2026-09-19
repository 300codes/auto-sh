<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F1 L13b — Stage Artifact and Stage Decision Commands

- **Plan**: context/changes/asd-oss-t045-flow-f1-l13b-add-stage-artifact-and/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after triage)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Evidence gathered by one read-only reviewer sub-agent (drift + safety + pattern + test quality); success criteria re-run by the main session after triage.

## Findings

### F1 — F8 unique-violation test never reached the recovery block

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/stages.test.ts (decide race test)
- **Detail**: The mock pushed the winner row before filtering, so the in-tx plan saw it and answered the ordinary replay; `persist` never threw and `stages.ts` recovery path was untested.
- **Fix**: Compute `found` before pushing the winner (as the F7 variant does) and assert `em.persist` threw exactly once for both the replay and the conflict branch.
- **Decision**: FIXED

### F2 — RBAC grant lookup repeated inside the row-locked transaction

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: commands/stages.ts `planDecisionFor`
- **Detail**: `resolveGrantedFeatures` ran on the probe, again under the project lock and again in recovery — an extra DB round-trip under the lock and a transient RBAC failure could turn a legitimate replay into a 403.
- **Fix**: Resolve grants once before the transaction (`resolveDecisionGrants`) and pass them into `planDecisionFor` for the locked plan and the recovery re-plan.
- **Decision**: FIXED

### F3 — `requireIdempotencyKey` duplicated from `attempts.ts`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: commands/stages.ts
- **Fix**: Export the helper from `attempts.ts` and import it.
- **Decision**: FIXED

### F4 — `flow_not_pinned` message named artifacts only

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: commands/stages.ts `readPinnedSnapshot`
- **Fix**: Message now covers artifacts and decisions.
- **Decision**: FIXED

### F5 — Stale header + active attempt ordering untested

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/stages.test.ts (attempt_active case)
- **Fix**: Added the `STALE_UPDATED_AT` + executing task case expecting 409 `attempt_active`.
- **Decision**: FIXED

### F6 — Tx result casts (`as StageArtifactRef` / `as DecisionSubject`)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: commands/stages.ts artifact/decision outcome mapping
- **Detail**: Casts exist because the tx returns `{ row | null, ref | null }` instead of a discriminated union; the null branch is guarded, no bug hidden.
- **Fix**: Optional: return a discriminated union. Left as is — cosmetic, and the guard is explicit.
- **Decision**: ACCEPTED
