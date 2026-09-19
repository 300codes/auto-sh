<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-06 Final-Commit Regression Suite

- **Plan**: context/changes/asd-oss-t036-add-the-final-commit-regression-suit/plan.md
- **Scope**: Full plan (2 of 2 phases)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after F1 fix)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: `yarn workspace @open-mercato/core jest src/modules/delivery_os/api/__tests__/finalRegression.route.test.ts --maxWorkers=2` → 7/7 pass; `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 53 suites / 1227 tests pass; scoped `tsc --noEmit` over the four touched test files → no errors in them (3 pre-existing errors in routeTestKit.ts / the package self-import line shared by all route tests); eslint on touched files → clean. Manual row 2.4 stays open for the human.

## Findings

### F1 — Restart replay asserted only as "not 201"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: packages/core/src/modules/delivery_os/api/__tests__/finalRegression.route.test.ts (restart describe)
- **Detail**: The replay of the original Idempotency-Key after `unknown` was asserted with `.not.toBe(201)`, which would also pass on a 500.
- **Fix**: Assert the real contract: 200 with the same attemptId, executor counter unchanged.
- **Decision**: FIXED

### F2 — Foreign-scope write with a lock header answers 409, not 404

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: packages/shared/src/lib/crud/optimistic-lock-command.ts:214 (enforceRecordGoneIsConflict) via commands/shared.ts:197
- **Detail**: R3/R4/R12/R13 from a foreign scope with a version header answer the platform "record gone" 409, echoing the caller's own token. It is identical to a never-existing id (the suite asserts equality of status and body), so no existence or version leaks. Frozen platform behaviour in `packages/shared` (not OSS-owned, "do not modify core").
- **Fix**: Keep behaviour; foreign writes are asserted without a header (404) plus an equality check against a never-existing id; recorded in the spec changelog for UI/QA.
- **Decision**: ACCEPTED

### F3 — flowHelpers export names differ from the plan's contract list

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: packages/core/src/modules/delivery_os/api/__tests__/flowHelpers.ts
- **Detail**: `saveDraft`/`createTask`/`setReady` are folded into `freezeDraftBaseline`/`prepareReadyTask`; `getPackageOn`, `storedTask`, `taskVersion`, `projectVersion` added. Same intent, fewer exports.
- **Fix**: None needed.
- **Decision**: DISMISSED

### F4 — R1 cross-scope relies on a scope-honouring query-engine fake

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: flowHelpers.ts useScopedProjectList
- **Detail**: The empty list is real only as far as the fake filters by the tenantId and organization filter the route passes; the real query engine is covered by QA-06 Playwright.
- **Fix**: None; noted for QA-06.
- **Decision**: ACCEPTED
