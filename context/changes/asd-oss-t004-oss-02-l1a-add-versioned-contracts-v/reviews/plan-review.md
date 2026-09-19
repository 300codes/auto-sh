<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Delivery OS contracts v1, canonical hash and error catalogue

- **Plan**: context/changes/asd-oss-t004-oss-02-l1a-add-versioned-contracts-v/plan.md
- **Mode**: Deep (claims verified by a direct zod 4.4.3 probe instead of a sub-agent; autonomous run)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
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
Paths: all four target files are new (module folder absent ✓); spec lines 126/165-181/300-339 ✓; `componentContracts.ts:16` ✓; `packages/core/jest.config.cjs` ✓. zod probe: strict variants inside `discriminatedUnion` reject extra keys ✓; custom issue `params.code` survives in `error.issues` ✓. Brief↔plan ✓. Progress↔Phase ✓.

## Findings

### F1 — Top-level error code selection is ambiguous

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach
- **Detail**: "the specific delivery code when every issue carries the same one" leaves mixed cases undefined, so UI/QA could not rely on `code`.
- **Fix**: Deterministic rule: any non-delivery (shape) issue → `validation_failed` (400); otherwise the code of the first issue in zod order; status from the catalogue. All issues stay in `details[]`.
- **Decision**: FIXED

### F2 — Lint criterion has no runnable command

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 success criteria
- **Detail**: `@open-mercato/core` has no `lint` script; root lint is `turbo run lint` over the whole repo (memory rule forbids it here).
- **Fix**: Use `yarn eslint <the four new files>` from the repo root (root `eslint.config.mjs`).
- **Decision**: FIXED

### F3 — Deviation from the task's code names must reach the hand-over

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Key Discoveries
- **Detail**: The task text lists nine code names that the frozen spec renamed. An independent reviewer checking the task text will look for them.
- **Fix A ⭐ Recommended**: Keep the spec catalogue only; record the mapping in research, plan, final decisions and notes. Strength: one frozen vocabulary for UI i18n and QA; matches the T003 decision. Tradeoff: literal mismatch with the task text. Confidence: HIGH. Blind spot: none significant.
- **Fix B**: Add the task names as aliases. Strength: literal match. Tradeoff: two codes for one condition; contract noise rejected in T003. Confidence: MEDIUM.
- **Decision**: FIXED via Fix A (mapping already in research; plan now states the hand-over duty)

### F4 — Cross-field rules do not run when the base shape fails

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 tests
- **Detail**: zod 4 skips `superRefine` when the object shape is invalid (probe confirmed). Negative twins must differ from a fully valid document in exactly one property or they assert the wrong failure.
- **Fix**: State it in the test contract.
- **Decision**: FIXED
