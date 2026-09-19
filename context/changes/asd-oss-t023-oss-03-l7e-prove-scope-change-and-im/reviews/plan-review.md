<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-03 (L7e) prove scope-change and immutability rules

- **Plan**: context/changes/asd-oss-t023-oss-03-l7e-prove-scope-change-and-im/plan.md
- **Mode**: Deep (claims verified directly against the code, no sub-agent)
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
Grounding: 6/6 paths ✓ (commands/{attempts,decisions,evidence}.ts, lib/{traceability,projectStatus}.ts, baselineTestKit.ts), 5/5 symbols ✓ (commandRegistry.list, checkDecisionSubject, baseline_not_active, taskUpdateSchema, baselineContentV1Schema), brief↔plan ✓

## Findings

### F1 — Route scan regex misses brace exports

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach §1
- **Detail**: The CRUD routes export write methods as `export { PUT, DELETE }` (`api/tasks/route.ts:70`, `api/projects/route.ts:105`). A declaration-only regex would pass a future `export { DELETE }` on a baselines route.
- **Fix**: Parse `export { … }` lists too and add a positive control that the scanner sees PUT/DELETE on the tasks/projects routes.
- **Decision**: FIXED

### F2 — Core typecheck does not cover the new test file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 success criteria
- **Detail**: `packages/core/tsconfig.json` excludes `**/__tests__/**`, so `yarn workspace @open-mercato/core typecheck` never type-checks `scopeChange.test.ts`.
- **Fix**: Add a scoped temporary tsconfig in /tmp that includes the new test file (criterion 2.3).
- **Decision**: FIXED

### F3 — Mutation check must leave no production diff

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 criterion 1.2
- **Detail**: Temporarily disabling guards to prove the assertions bite risks a leftover edit.
- **Fix**: Confirm with `git diff --stat` after the mutation run.
- **Decision**: FIXED
