<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L4e) attempt reservation command and pure TaskPackage builder

- **Plan**: context/changes/asd-oss-t013-oss-02-l4e-add-attempt-reservation-c/plan.md
- **Mode**: Deep, done in the main context (no sub-agent: hard RAM rule, the code was already read for research)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 6/6 paths ✓ (`lib/attempts.ts`, `lib/contracts.ts`, `commands/shared.ts`, `commands/tasks.ts`, `commands/index.ts`, `data/validators.ts`), 6/6 symbols ✓ (`reserveAttempt`, `checkAttemptOpen`, `assertRevisionKind`, `lockScopedTask`, `requireLockHeader`, `buildPackageUrl`), brief↔plan ✓

## Findings

### F1 — Lock rule is ambiguous for a manual reserve without a request

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, decisions 2–3
- **Detail**: Decision 2 says "request-bound new key", decision 3 covers only `automatic`. `requireLockHeader` answers 428 when `ctx.request` is missing, so an in-process `manual_handoff` call would always fail.
- **Fix**: State one rule: the header is required and the compare forced exactly when `ctx.request` exists; without a request the row lock alone serialises.
- **Decision**: FIXED

### F2 — Position of the revision-kind and profile checks is not stated

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Decision 1, Phase 2 §3
- **Detail**: 422 `revision_kind_mismatch` and `unknown_target_profile` are promised by the spec but the order table does not place them. A wrong-kind payload can never be a replay, so they belong to the task-level checks.
- **Fix**: Add the full task-level order: status → dependencies → profile + revision kind → baseline → `canTransition`.
- **Decision**: FIXED

### F3 — `trustedExecution.actorUserId` is validated but never used

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decision 9
- **Detail**: The master plan says the execution context persists the authorised actor. `CommandLogMetadata.actorUserId` exists (`packages/shared/src/lib/commands/types.ts:89`), so the audit entry can carry it.
- **Fix**: `buildLog` sets `actorUserId` from `trustedExecution` for an automatic reservation.
- **Decision**: FIXED

### F4 — Progress titles do not match the Success Criteria bullets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Progress`
- **Detail**: The progress contract asks for one row per criterion with a matching title.
- **Fix**: Align the titles.
- **Decision**: FIXED

### F5 — Correction round on a superseded baseline is refused

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Decision 7
- **Detail**: A `changes_requested` task pinned to a baseline that was superseded meanwhile cannot be re-reserved. That is the safe side (no agent run on stale scope) and the human path is clear: cancel or re-plan on the new baseline.
- **Fix**: Keep; record as a limitation in the hand-over.
- **Decision**: ACCEPTED
