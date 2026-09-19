<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L5a): project, baseline, decision and task API routes

- **Plan**: context/changes/asd-oss-t015-oss-02-l5a-add-project-baseline-deci/plan.md
- **Mode**: Deep (claims verified in the main context — hard RAM rule, no sub-agent)
- **Date**: 2026-09-19
- **Verdict**: SOUND after fixes (was REVISE)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 6/6 paths ✓ (`commands/projects.ts`, `commands/shared.ts`, `data/validators.ts`, `lib/projectStatus.ts`,
`shared/lib/crud/route-mutation-guard.ts`, `customers/api/interactions/complete/route.ts`), 5/5 symbols ✓
(`resolveDeliveryScope`, `parseDeliveryInput`, `projectListQuerySchema`, `runRouteMutationGuards`,
`resolveFeatureCheckContext`), brief↔plan ✓. `CrudCtx` (`factory.ts:486-493`) is structurally a
`CommandRuntimeContext`, so `resolveDeliveryScope(ctx)` is callable from `buildFilters` (D5 confirmed). The dispatcher
checks features with the same `rbacService` + `resolveFeatureCheckContext` pair (D10 confirmed).

## Findings

### F1 — Per-source feature check must fail closed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Route support; Decision D10
- **Detail**: R7/R10 POST declare only `projects.view` in `metadata`, so the in-handler check is the only write gate. The plan does not say what happens when `rbacService` cannot be resolved or the caller has no user id.
- **Fix**: `requireDeliveryFeatures` answers `403 forbidden` when the service is missing, throws, or returns anything but `true`; add a test.
- **Decision**: FIXED

### F2 — Changed project command result breaks existing assertions

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — change 1
- **Detail**: `commands/__tests__/projects.test.ts:218,326,465` assert `toEqual({ projectId })`. The mocked EM never runs the ORM `onUpdate` hook, so `updatedAt` must be read from the entity after the flush and the tests need a deterministic value.
- **Fix**: Name the three assertions in the plan; serialize `project.updatedAt.toISOString()`.
- **Decision**: FIXED

### F3 — Task text says 422 for proposal sources, plan answers 400

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Decision D6
- **Detail**: The task description asks for a "422 not-yet-supported code". The frozen catalogue has no such code and the spec changelog (T011, T012) already fixes `400 validation_failed` / `unsupported_source`.
- **Fix A ⭐ Recommended**: Keep the 400 and state the deviation in the hand-over and final decisions. · Strength: no contract churn, UI/QA already have this in the changelog · Tradeoff: differs from the task wording · Confidence: HIGH · Blind spot: none significant.
- **Fix B**: Add an additive 422 code. · Strength: matches the task wording · Tradeoff: a code that disappears in OSS-03 · Confidence: MED.
- **Decision**: FIXED via Fix A (already D6; deviation will be reported)

### F4 — Live list depends on the query engine knowing the new entity

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3
- **Detail**: R1 goes through the query engine with `E.delivery_os.delivery_project`; jest mocks the engine, so only the live run proves column names and the `name ilike` filter.
- **Fix**: Make the live run assert the created project is found by `?search=` and that `includeArchived=true` returns the archived row.
- **Decision**: FIXED
