<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-05 (H26) publication chain proof and hand-over

- **Plan**: context/changes/asd-oss-t035-prove-the-publication-chain-end-to-e/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS (observation F4) |
| Success Criteria | PASS |

Success criteria re-run: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 52 suites,
1220 tests passed; `yarn workspace @open-mercato/core typecheck` clean; live smoke `SMOKE PASSED` (log in hand-over).
Manual row 2.3 left `[ ]` for a human. Independent reviewer (sub-agent) confirmed the clock makes the evidence and
decision ordering deterministic, and that no delivery rows are seeded directly.

## Findings

### F1 — manual_pending assertion was `toContain`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/publicationFlow.test.ts (release while AC-003 manual_pending)
- **Detail**: Would still pass if another blocker appeared next to `manual_pending`.
- **Fix**: `toEqual(['manual_pending'])`.
- **Decision**: FIXED

### F2 — Hand-over could read as "a new revision blocks publishing"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: handover/OSS-05-H26.md, proof section
- **Detail**: Publishable on B is blocked by the scan `not_run` the test introduces; the voided consent shows as `deploy_decision=missing`.
- **Fix**: State the cause explicitly in the hand-over.
- **Decision**: FIXED

### F3 — Not shown that consent was the only missing piece on B

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/publicationFlow.test.ts (before consent B)
- **Detail**: `revision_mismatch` comes from the consent check, which runs before the report gate.
- **Fix**: R22 on B before the new consent: publishable ✓, releasable blockers exactly `['deploy_decision:deploy=missing']`.
- **Decision**: FIXED

### F4 — File location (commands/__tests__ vs api/__tests__/*.route.test.ts)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: commands/__tests__/publicationFlow.test.ts
- **Detail**: Sibling route tests are in api/__tests__.
- **Fix**: none — the task names this path explicitly (same as executorFlow.test.ts).
- **Decision**: DISMISSED

### F5 — Direct store reads for task version / decision counts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: commands/__tests__/publicationFlow.test.ts (`taskVersion`, release-row counts)
- **Detail**: Reads, not seeding; the same approach as manualFlow (`storedTask`).
- **Decision**: DISMISSED

### F6 — Module-level clock

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/__tests__/publicationFlow.test.ts
- **Detail**: One test only; a later test would inherit an advanced, still-monotonic clock, which is harmless.
- **Decision**: DISMISSED
