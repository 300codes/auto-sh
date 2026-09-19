<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-04 (L8f) review evidence, verified / changes_requested transitions and correction limit

- **Plan**: context/changes/asd-oss-t029-oss-04-l8f-add-review-evidence-with/plan.md
- **Mode**: Deep (claims verified directly against the code by the reviewer, no sub-agent — memory budget of the machine)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
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
Grounding: 5/5 paths ✓, 6/6 symbols ✓ (`changesRequestedOutcome`, `checkVerification`, `lockScopedProjectTasks`, `applyPropagation`, `countCorrectionRounds`, `DeliveryEvidence.createdAt`), brief↔plan ✓, Progress↔Phase ✓. R12 → `verified` refusal is already pinned in `commands/__tests__/tasks.test.ts:496`.

## Findings

### F1 — The hash replay can swallow a legitimate second review

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — order for a review ("replay answers with the task's current status")
- **Detail**: The replay key is (project, kind, task, attempt, payload hash) for the whole life of the project. A reviewer who sends the same words again after a *new* result on the same revision (an agent that changed nothing), or a human who flips a manual verdict approved → changes_requested → approved, would get `duplicate: true` and the task would stay in `awaiting_review` / the verdict would stay `changes_requested`. For other kinds this cannot happen (they never move state).
- **Fix**: For reviews a hash match is a replay only when the matching row is the newest row among the task's `review` and `result_manifest` rows (nothing happened since). Otherwise the body is a new review. Needs the task's rows before the replay answer — one query under the project lock, still no storage read.
- **Decision**: FIXED — added to the plan as D15 and to the review order.

### F2 — "task rows or project-level rows" needs two queries

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — evidence loading
- **Detail**: `taskId IN (id, NULL)` never matches NULL in SQL, and the unit-test matcher has no `$or`. The plan does not say how both sets are read.
- **Fix**: Two scoped queries: rows of the task; `test` rows of the project + pinned baseline with `taskId: null`. Reuse the first set for the correction count (`countCorrectionRounds`) instead of calling `loadCorrectionBudget` again.
- **Decision**: FIXED — plan updated.

### F3 — Tie on `createdAt`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details — ordering
- **Detail**: Two rows in the same millisecond have no defined order. Writers are serialized by the project lock, so this is theoretical.
- **Fix**: Sort by `createdAt`, then `id`, so the order is at least deterministic.
- **Decision**: FIXED — plan updated.
