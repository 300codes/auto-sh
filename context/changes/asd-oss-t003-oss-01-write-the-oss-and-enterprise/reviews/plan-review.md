<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-01 (T003) OSS and enterprise-boundary specs

- **Plan**: context/changes/asd-oss-t003-oss-01-write-the-oss-and-enterprise/plan.md
- **Mode**: Deep (claims verified directly in code during planning; no sub-agent needed for a docs-only change)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding
Grounding: 6/6 paths ✓ (registry.ts, module-registry.ts, factory.ts, crud.ts, optimistic-lock-headers.ts, extension-points.ts), 2/2 symbols ✓ (`agents:check-budget`, `enforceCommandOptimisticLock`), brief↔plan ✓

## Findings

### F1 — Required lock header breaks idempotent replay of reserve and result import

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, decision 3
- **Detail**: The plan requires the task lock header on reserve and results import. After the first successful call the task `updatedAt` changes, so a client replaying the same `Idempotency-Key` (reserve) or the same manifest (import) with its original header would get 409 `optimistic_lock_conflict` instead of the master-plan replay result (200 existing attempt / 200 `duplicate: true`). Master plan: "Porównanie idempotencji … następuje przed odrzuceniem".
- **Fix**: Reserve checks the idempotency key **before** the lock (a known key never 409s on the lock); results import carries **no** task lock header — concurrency is controlled by attemptId + manifest hash + the partial unique index. The spec states the per-endpoint lock rule explicitly.
- **Decision**: FIXED

### F2 — Lock rule not per-endpoint for append-only writes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach, decision 3
- **Detail**: Evidence POST and baseline creation are append-only; a blanket "custom actions require the header" rule is ambiguous for them.
- **Fix**: API table gets a "Lock" column per endpoint: project lock for baseline create/proposal import, decisions and deploy/release; task lock for reserve (new key), cancel, reconcile, task-status transitions; none for results/evidence/GET.
- **Decision**: FIXED

### F3 — Archive guard location for makeCrudRoute DELETE

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decision 1
- **Detail**: Using `makeCrudRoute` DELETE could suggest the factory's plain soft delete; the master plan requires an active-attempt guard and no cascade.
- **Fix**: Spec states DELETE maps to the `delivery_os.projects.delete` / `delivery_os.tasks.delete` commands (via `actions.delete.commandId`) that enforce the guard and soft-delete only.
- **Decision**: FIXED

### F4 — Verification is grep-only

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Testing Strategy
- **Detail**: Acceptable for docs; a spot check that every cited `file:line` still resolves adds cheap confidence.
- **Fix**: Add a cited-reference spot check to the Phase 1 implementation (no new Progress row; covered by 1.3).
- **Decision**: FIXED
