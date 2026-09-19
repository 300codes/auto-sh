<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L4c) task commands

- **Plan**: context/changes/asd-oss-t011-oss-02-l4c-add-task-commands-with-da/plan.md
- **Mode**: Deep (claims verified directly against the code in the main context; no sub-agent because of the machine's RAM rule)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 6/6 paths ✓, symbols ✓ (`taskGraphCheck`, `planBlockPropagation`, `planUnblockPropagation`, `collectReadinessReasons`, `checkAllowedPathsForProfile`, `enforceRecordGoneIsConflict`), brief↔plan ✓, Progress↔Phase ✓

## Findings

### F1 — Scope edits allowed on a `blocked` task that already ran

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decisions #5
- **Detail**: `blocked` is also reached from `executing` / `awaiting_review` (correction limit, reconciliation). Allowing `acIds` / `allowedPaths` edits there changes the scope after a package was exported and evidence recorded.
- **Fix**: Scope fields are editable only when status is `draft` or `blocked` AND the attempt register is empty (unreadable register counts as not empty).
- **Decision**: FIXED

### F2 — Missing error paths for unknown profile and unreadable baseline content

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3
- **Detail**: `getTargetProfile` can return `undefined` and stored baseline content may not parse; the plan did not say which code answers.
- **Fix**: unknown profile → `422 unknown_target_profile`; content that fails `baselineContentV1Schema` → `422 hash_mismatch` detail `content` / `unreadable_baseline_content` (create, scope edit) and the same detail inside the readiness failure (→ ready).
- **Decision**: FIXED

### F3 — Dependency on a `cancelled` task is accepted

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decisions #4
- **Detail**: Such a task can never be reserved (`dependency_not_verified`), but nothing unsafe happens and the user can edit the dependency.
- **Fix**: none; document in hand-over.
- **Decision**: ACCEPTED

### F4 — Propagation bumps `updatedAt` of descendants

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details
- **Detail**: Open forms on descendants get a 409 afterwards; this is the intended conflict signal and `task.updated` is emitted per descendant so the UI can refresh.
- **Fix**: none; note for UI in hand-over.
- **Decision**: ACCEPTED
