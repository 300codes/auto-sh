<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-03 (L7a) allowedPaths Rules and Pure Proposal Import Validation

- **Plan**: context/changes/asd-oss-t019-oss-03-l7a-add-allowedpaths-rules-an/plan.md
- **Mode**: Deep (claims verified in the main context: fixture hash, schema rules, callers)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding
Paths 6/6 ✓ (contracts.ts, targetProfiles.ts, dag.ts, baseline.ts, fixtures/index.ts, fixtures.test.ts), symbols 5/5 ✓
(`planProposalV1Schema`, `checkAllowedPathsForProfile`, `findDependencyCycle`, `hashBaseline`, `negativeFixtureStages`),
pre-plan baseline hash `39969f…` reproduced by hashing the baseline-content fixture with planSummary/acTestMap/declaredTests/manualChecks emptied, brief↔plan ✓.

## Findings

### F1 — Two co-existing allowedPaths rules

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: What We're NOT Doing / Phase 1
- **Detail**: The plan leaves `checkAllowedPathsForProfile` (prefix match, used by `commands/tasks.ts:522` for manual
  tasks) next to the new `validateAllowedPaths`. A manual task could then carry `src/*/x` or duplicates that
  `isPathAllowed` will never match, so a later result would fail `path_not_allowed` for a path the operator thought
  allowed. The workstream says the manual API uses the same domain validation as the worker.
- **Fix**: Make `checkAllowedPathsForProfile` delegate to `validateAllowedPaths` (same signature, same top code, detail
  paths stay `String(index)`); existing tests in `targetProfiles.test.ts:118-136` and `commands/__tests__/tasks.test.ts:383`
  stay valid. Keep `isPathWithinProfileRoots` untouched.
  - Strength: one rule for manual and proposal tasks, no pattern proliferation.
  - Tradeoff: manual tasks become stricter for exotic globs (in-spec: they could never match a changed path).
  - Confidence: HIGH — both callers checked.
  - Blind spot: none significant; `allowedPaths.ts` must import only types from `targetProfiles.ts` to avoid a runtime cycle.
- **Decision**: FIXED

### F2 — Pruned AC maps must not hide a pruned manual check silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach §2
- **Detail**: Pruning `acTestMap` and `manualChecks` for vanished AC ids is reported only as `prunedAcIds`; the tests must
  pin that the pruned ids are listed exactly once and that untouched sections (screens, comments, adr, attachments,
  tokens) survive byte-identical.
- **Fix**: Add both assertions to the Phase 2 test list.
- **Decision**: FIXED

### F3 — Replay of an identical manifest against the merged baseline

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach §5
- **Detail**: After import the project points at the merged baseline (new hash), so a replayed plan manifest carries the
  pre-plan hash and would fail `baseline_hash_mismatch` if L7b validated it against the merged baseline. Replay detection
  (by `manifestId` + `manifestHash`) must run before `validatePlanProposal` in L7b.
- **Fix**: Note it in the hand-over for L7b; the pure validator already returns `manifestHash` for that lookup.
- **Decision**: FIXED (documented in plan Critical Implementation Details)
