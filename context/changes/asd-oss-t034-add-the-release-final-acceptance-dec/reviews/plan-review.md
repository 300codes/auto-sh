<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-05 (L9d): release decision and route R21

- **Plan**: context/changes/asd-oss-t034-add-the-release-final-acceptance-dec/plan.md
- **Mode**: Deep (verified inline, no sub-agent — single-file pattern already mapped)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 5/5 paths ✓ (decisions.ts, deploy-decisions/route.ts, schemas.ts, decisions.test.ts, handover dir), 4/4 symbols ✓ (releaseDecisionSchema, deriveDeploymentVerificationStatus, isSameRevision, makeHarness services), brief↔plan ✓

## Findings

### F1 — Typecheck command is vague

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 success criteria
- **Detail**: "tsc --noEmit -p . (or the package typecheck script)" leaves the runner open; `packages/core/package.json` has `typecheck: tsc --noEmit`.
- **Fix**: Use `yarn workspace @open-mercato/core typecheck`.
- **Decision**: FIXED

### F2 — Newer failed deployment on the same revision not tested

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Tests
- **Detail**: The named row can be verified while the report uses the newest deployment on the revision; the risk is listed in the brief but not covered by a test.
- **Fix**: Add a command test expecting `report_not_green` with a `deployment` blocker.
- **Decision**: FIXED

### F3 — Unparsable stored payload behaviour unspecified

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach — Verified rule
- **Detail**: Stored payload is jsonb; the plan did not say what a payload that fails the schema means.
- **Fix**: `safeParse` failure counts as unverified (same as the report builder).
- **Decision**: FIXED
