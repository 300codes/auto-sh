<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L5b) attempts, package and results routes + deliveryOsAttemptQueries

- **Plan**: context/changes/asd-oss-t016-oss-02-l5b-add-attempts-package-and/plan.md
- **Mode**: Deep (claims verified in the main context — hard RAM rule, no sub-agent)
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
Grounding: 6/6 paths ✓ (routeSupport.ts, routeTestKit.ts, commands/evidence.ts, commands/attempts.ts, lib/taskPackage.ts, progress/di.ts), 5/5 symbols ✓ (`reserveAttemptBodySchema`, `idempotencyKeyHeaderSchema`, `packageQuerySchema`, `resultsImportSchema`, `findProjectBaseline`), brief↔plan ✓, Progress↔Phase ✓. `deliveryErrorFromZod` maps a lone `payload_too_large` issue to 413 ✓ (`lib/contracts.ts:130-143`). No import cycle: `commands/tasks.ts` does not import `evidence.ts`.

## Findings

### F1 — Test store cannot evaluate `attemptNumber > 0`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — D7 / tests
- **Detail**: `matches` in `commands/__tests__/baselineTestKit.ts:51-59` supports only equality and `$in`. A `$gt` filter would silently match nothing and the DI test would pass for the wrong reason or fail.
- **Fix**: Add `$gt` support to `matches` (additive, test-only) and name the file in the plan.
- **Decision**: FIXED

### F2 — `listPendingDeliveries` scan is unbounded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — D7
- **Detail**: `limit` bounds the output, not the number of task rows (with full JSONB registers) loaded per call. EXEC may poll this.
- **Fix**: Cap the task scan at 500 rows ordered by `updatedAt` ascending and state the cap in the hand-over.
- **Decision**: FIXED

### F3 — Order of key check versus body validation on R14

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Routes, R14
- **Detail**: The command answers `idempotency_key_required` before schema validation. If the route parses the body first, a request with no key and a bad body answers `validation_failed`, which differs from the in-process path.
- **Fix**: Route checks the header first, then the body; add a test for "no key + bad body → idempotency_key_required".
- **Decision**: FIXED
