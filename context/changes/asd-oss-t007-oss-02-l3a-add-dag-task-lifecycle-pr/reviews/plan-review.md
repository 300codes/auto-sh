<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L3a): DAG, task lifecycle, project status and basic traceability

- **Plan**: context/changes/asd-oss-t007-oss-02-l3a-add-dag-task-lifecycle-pr/plan.md
- **Mode**: Deep (inline verification, no sub-agent — pure lib task with 6 touched files)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
6/6 paths ✓ (lib/dag.ts, lib/contracts.ts, lib/targetProfiles.ts, data/validators.ts, lib/__tests__/contracts.test.ts, spec), 5/5 symbols ✓ (findDependencyCycle, buildDeliveryError, isSameRevision, countsAsAcEvidence, USER_SETTABLE_TASK_STATUSES), brief↔plan ✓

## Findings

### F1 — Forbidden-import check uses a PCRE lookahead under `grep -E`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Success Criteria
- **Detail**: `(?!delivery_os)` is not ERE; the command errors or matches nothing, so the criterion could "pass" vacuously.
- **Fix**: List the import lines and require only `./contracts`, `./targetProfiles`, `./dag`.
- **Decision**: FIXED

### F2 — Typecheck command did not match the package script used by earlier tasks

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Success Criteria
- **Detail**: `packages/core/package.json` has `typecheck: tsc --noEmit`; T006 used `yarn workspace @open-mercato/core typecheck`.
- **Fix**: Use `yarn workspace @open-mercato/core typecheck`.
- **Decision**: FIXED

### F3 — `statusReason` gate could block the reconcile command that clears it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Decision 5
- **Detail**: UA-19 moves `blocked/reconciliation_required` to `ready`/`changes_requested` after a `not_started`/`stopped` resolution; if the context carried the pre-change reason, the gate would reject the legitimate reconcile.
- **Fix**: Define `context.statusReason` as the reason remaining after the calling command's own state change.
  - Strength: keeps one gate for all callers. Tradeoff: callers must pass the post-change reason. Confidence: HIGH. Blind spot: L4 must honour it (noted).
- **Decision**: FIXED

### F4 — Active baseline id missing from input not specified

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decision 9
- **Detail**: If `activeBaselineId` is not among `baselines`, the implementer would guess.
- **Fix**: Treat as no active baseline (`awaiting_approval`, `0/0`).
- **Decision**: FIXED
