<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-04 H17/H21 — fake-executor flow, QA scenarios and hand-over

- **Plan**: context/changes/asd-oss-t030-oss-04-h17-h21-fake-executor-flow-te/plan.md
- **Mode**: Deep (inline code verification, no sub-agent — small test-only plan)
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
Grounding: 5/5 paths ✓ (commands/attempts.ts, evidence.ts, reconcile.ts, attemptQueries.ts, lib/acProof.ts), 6/6 symbols ✓ (buildResultManifest, proveAcceptanceCriteria, issueTrustedExecution, createDeliveryOsAttemptQueries, markAttemptDelivery keeps pending on failed, reserve automatic trusted gate), brief↔plan ✓

## Findings

### F1 — Restart re-run hole: an idempotent claim by the same worker does not throw

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Desired End State item 4 (QA c)
- **Detail**: `claimAttempt` returns `alreadyClaimed` (command result `changed: false`) for the same workerRef (`lib/attempts.ts:227`). A bridge modelled on `results.test.ts` only skips when claim throws, so after a restart with the same worker id it would run the CLI a second time. That contradicts "no second executor call".
- **Fix**: The fake bridge runs the executor only when `claim.changed === true`. Scenario (c) asserts this, and the hand-over adds it as an EXEC patch request. There are no production changes: the domain already reports the fact.
- **Decision**: FIXED

### F2 — Typecheck command would run a full core tsc

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 success criteria
- **Detail**: A full `tsc --noEmit` of core is too heavy for the machine's memory budget (ENVIRONMENT hard rule).
- **Fix**: Use a scoped `/tmp/t030/tsconfig.json`, as T027/T028 did.
- **Decision**: FIXED

### F3 — Overlap with the bridge block in results.test.ts

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1
- **Detail**: `results.test.ts:339` already covers part of the flow, starting from a reserved manual attempt. The new file starts from a `ready` task with an automatic reserve, reads the real package, and covers failed delivery → replay re-signal. It is a superset flow, and the existing tests stay as unit coverage.
- **Fix**: Keep both; do not edit results.test.ts.
- **Decision**: DISMISSED (intended layering)
