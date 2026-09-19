<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L3a): DAG, task lifecycle, project status and basic traceability

- **Plan**: context/changes/asd-oss-t007-oss-02-l3a-add-dag-task-lifecycle-pr/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 0 critical, 8 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (after fixes) |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after fixes) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run after fixes: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 9 suites, 293 tests passed; `yarn workspace @open-mercato/core typecheck` exit 0; `tsc` over `src/modules/delivery_os/**` including tests exit 0; `eslint packages/core/src/modules/delivery_os` clean; imports of the four modules limited to `./contracts`, `./dag`, `./targetProfiles`.

## Findings

### F1 — Reconcile `completed` after `unknown` could not reach `awaiting_review`
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence · **Location**: lib/taskLifecycle.ts TASK_TRANSITIONS.blocked
- **Detail**: UA-19 `unknown` parks the task in `blocked/reconciliation_required`; a later `completed` must end in `awaiting_review`, which the table rejected.
- **Fix**: add `blocked → awaiting_review` (not user-settable, so command-only).
- **Decision**: FIXED

### F2 — Escalation to `blocked/correction_limit_reached` rejected by its own reason gate
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence · **Location**: lib/taskLifecycle.ts canTransition
- **Detail**: with the post-change reason `correction_limit_reached`, `awaiting_review → blocked` was refused.
- **Fix**: exempt `to === 'blocked'` from the escalation gate.
- **Decision**: FIXED

### F3 — Unchanged status through R12 rejected
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence · **Location**: lib/taskLifecycle.ts canTransition
- **Detail**: a PUT resending `executing` while editing the title would get 409.
- **Fix**: identity check first (plan decision 4 already said no-op).
- **Decision**: FIXED

### F4 — Correction limit bypass via blocked → draft → ready → executing
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality · **Location**: lib/taskLifecycle.ts checkCorrectionBudget
- **Detail**: only the `changes_requested → executing` edge was checked, and `started` counted edges a round-trip could avoid.
- **Fix**: budget is `{ requested, max }` (recorded `changes_requested` review verdicts, append-only) checked on every `→ executing`.
- **Decision**: FIXED

### F5 — Malformed budget disabled the limit
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: lib/taskLifecycle.ts
- **Detail**: `NaN`/negative numbers made `>=` always false.
- **Fix**: non-integer or negative → `invalid_transition/correction_budget_unknown`; `changesRequestedOutcome` escalates.
- **Decision**: FIXED

### F6 — Ready allowed under a blocked ancestor unless reason was `dependency_blocked`
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: lib/taskLifecycle.ts
- **Fix**: `→ ready` refused whenever `blockedAncestorIds` is non-empty.
- **Decision**: FIXED

### F7 — Traceability materialised every row before truncating
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: lib/traceability.ts
- **Fix**: lazy `emit` counts all rows, builds only up to `limit`.
- **Decision**: FIXED

### F8 — `NaN` dates and ties in "latest" selection
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: lib/projectStatus.ts latestBy
- **Fix**: unparseable dates sort oldest; a same-instant rejection beats an approval.
- **Decision**: FIXED

### F9 — Propagation could send in-flight tasks to `draft` on unblock
- **Severity**: 🔍 OBSERVATION · **Location**: lib/taskLifecycle.ts planBlockPropagation
- **Fix**: propagate only to `draft`/`ready` descendants (others cannot legally have started while an ancestor is unverified).
- **Decision**: FIXED

### F10 — Test name overstated non-disclosure of unknown dependencies
- **Severity**: 🔍 OBSERVATION · **Location**: lib/__tests__/dag.test.ts
- **Detail**: top-level code is `foreign_dependency` for both, but detail codes differ; callers must pass only in-scope tasks (noted for L4).
- **Fix**: renamed test.
- **Decision**: FIXED

### F11 — Duplicate task ids not reported by validateTaskGraph
- **Severity**: 🔍 OBSERVATION · **Location**: lib/dag.ts
- **Decision**: DISMISSED — tasks come from DB rows with a uuid primary key.

### F12 — `total = 0` reports `coverage_gap` rather than a separate state
- **Severity**: 🔍 OBSERVATION · **Location**: lib/projectStatus.ts
- **Decision**: DISMISSED — deliberate fail-closed (never `verified` with zero AC); baselines require ≥ 1 AC (`missing_acceptance_criteria`), so it is unreachable for stored baselines.
