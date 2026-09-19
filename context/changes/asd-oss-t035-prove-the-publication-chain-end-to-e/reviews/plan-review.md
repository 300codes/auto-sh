<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-05 (H26) publication chain proof and hand-over

- **Plan**: context/changes/asd-oss-t035-prove-the-publication-chain-end-to-e/plan.md
- **Mode**: Quick (grounding done inline; autonomous run)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL → PASS (F1) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (F2) |
| Plan Completeness | PASS |

## Grounding
Paths: manualFlow/releaseDecision tests, routeTestKit, projects route, evidence route ✓; symbols RESERVABLE_STATUSES, buildScans, OPTIMISTIC_LOCK_HEADER_NAME ✓; brief↔plan ✓.

## Findings

### F1 — "Both gates blocked on B" is false with an all-passed B result

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Implementation Approach, item 5
- **Detail**: `lib/deliveryReport.ts#buildScans` counts manifest checks as scan proof, so a B result with all checks passed makes the publishable gate green on B; the acceptance ("both gates blocked") could not be shown honestly.
- **Fix**: B's result reports `dependency-audit` as `skipped`; then scan evidence on B, new consent, release on B.
- **Decision**: FIXED

### F2 — Project DELETE does not clean append-only rows

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — live smoke
- **Detail**: The CRUD DELETE soft-deletes the project only; evidence/decisions stay in the shared demo DB.
- **Fix**: Hard-delete own rows by project id via `docker exec omhack-postgres psql` like `/tmp/t032/live.ts`.
- **Decision**: FIXED

### F3 — Typecheck command must respect the RAM rule

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 success criteria
- **Detail**: Command was vague; the package typecheck is heavy and must run alone.
- **Fix**: Name `yarn workspace @open-mercato/core typecheck`, run alone after jest.
- **Decision**: FIXED
