<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L1b) target profiles, fixtures and H4 hand-over

- **Plan**: context/changes/asd-oss-t005-oss-02-l1b-add-target-profiles-fixtu/plan.md
- **Mode**: Quick (grounding by hand; autonomous run)
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
5/5 symbols ✓ (`DELIVERY_CONTRACT_VERSION`, `DeliveryErrorResult`, `repoRelativePathSchema`, `declaredTestSchema`, `validationCheckDefinitionSchema`); `handover/` folder exists ✓; brief↔plan ✓.

## Findings

### F1 — Builder default for `changedPaths` and `artifacts` unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; the fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3
- **Detail**: `allowedPaths` are globs, so there is no obvious concrete changed path to derive. If the default is left open, the implementer has to guess, and later `allowedPaths` checks could fail on builder output.
- **Fix**: Default `changedPaths: []` and `artifacts: []`; callers pass concrete paths through overrides.
- **Decision**: FIXED

### F2 — Test files are excluded from `tsc`, so the typecheck does not cover the tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; the fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 success criteria
- **Detail**: `packages/core/tsconfig.json` excludes `**/__tests__/**`. Type errors in the tests surface only through ts-jest diagnostics, so `fixtures/index.ts` must carry the types, not the tests.
- **Fix**: Keep all typed API in `fixtures/index.ts` (covered by tsc). The tests rely on ts-jest diagnostics.
- **Decision**: FIXED (noted in plan)

### F3 — JSON import attribute support is unverified

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — a real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details
- **Detail**: ts-jest emits CommonJS, and TypeScript can reject `with { type: 'json' }` when `module` is not esnext. The plan already defines a fallback.
- **Fix**: Probe first in Phase 2 and keep the fallback path.
- **Decision**: ACCEPTED
