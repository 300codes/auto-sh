<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L6) In-process Manual End-to-end Flow Test

- **Plan**: context/changes/asd-oss-t017-oss-02-l6-add-the-in-process-manual/plan.md
- **Scope**: Full plan (Phases 1–2 of 2)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 4 observations
- **Method**: one read-only review sub-agent (drift + safety + patterns); success criteria re-run in the main context (16 GB RAM rule).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-run: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 30 suites / 685 tests passed; eslint on both touched test files clean; `grep -nE "activeBaselineId\s*[:=]"` on the new test → no match; `yarn workspace @open-mercato/core typecheck` → exit 0 (package tsconfig excludes `__tests__`; the touched test files were additionally checked with a temporary config: only pre-existing kit errors `em` implicit any, present at HEAD). Manual row 1.6 stays open for a human.

## Findings

### F1 — Ready-refusal legs could not tell which gate fired

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: packages/core/src/modules/delivery_os/api/__tests__/manualFlow.route.test.ts (negative legs)
- **Detail**: `baseline_not_approved` is the top-level code of both the active-baseline gate (commands/tasks.ts ~346) and the per-decision readiness reasons (lib/baseline.ts); asserting only the code would survive deleting either gate.
- **Fix**: Assert `detailCodesOf(body)` exactly: `[baseline_not_active, design_decision_missing]` and `[baseline_not_active, requirements_decision_missing, design_decision_missing]`.
- **Decision**: FIXED

### F2 — "No export" claim leaned on a 404 for a made-up attempt id

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: manualFlow.route.test.ts `expectNoAttemptReserved`; handover addendum
- **Detail**: The 404 holds with or without decisions; the real proof is the refused reserve plus the untouched register.
- **Fix**: Keep the 404 as a side check, make the register/`draft`/no-`persist` assertions the named evidence, and reword the addendum accordingly.
- **Decision**: FIXED

### F3 — Refused commands were outside the zero-write window

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: manualFlow.route.test.ts negative legs
- **Detail**: Spies were cleared after the refused ready/reserve calls.
- **Fix**: Clear spies right after task creation; assert `em.persist` not called and `routeState.writes === 0` after the refused calls (not `transactional`, which reserve opens before its status check).
- **Decision**: FIXED

### F4 — Package GET could mutate the task row in memory unnoticed

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: manualFlow.route.test.ts happy path, package leg
- **Detail**: The mock EM has no dirty tracking.
- **Fix**: Compare `JSON.stringify(storedTask(task.id))` before and after the GET (as package.route.test.ts does for the register).
- **Decision**: FIXED

### F5 — Entity defaults now also supply createdAt/updatedAt in the kit

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/api/__tests__/routeTestKit.ts `entityDefaults`
- **Detail**: Class initializers override the kit's shared `now` for timestamp fields; values may differ by ~1 ms. No test depends on equality; mirrors MikroORM `em.create`.
- **Fix**: None needed.
- **Decision**: DISMISSED — matches real ORM behaviour; all 30 suites green.

### F6 — `clearWriteSpies` duplicated from package.route.test.ts

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: manualFlow.route.test.ts `clearWriteSpies`
- **Detail**: Four-line helper duplicated in two suites.
- **Fix**: Optionally move into routeTestKit.ts.
- **Decision**: SKIPPED — keeps the kit diff minimal; revisit if a third suite needs it.
