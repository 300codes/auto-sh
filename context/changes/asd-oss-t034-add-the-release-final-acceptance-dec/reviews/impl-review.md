<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-05 (L9d): release decision and route R21

- **Plan**: context/changes/asd-oss-t034-add-the-release-final-acceptance-dec/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated); manual 1.4 pending for a human |

## Findings

### F1 — Command and report used different deployment payload parsers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/decisions.ts (verified check)
- **Detail**: The command parsed with the strict ingest schema, the report with its loose schema; a stored row missing e.g. `checkedAt` would be green in the report and `deployment_unverified` in the command.
- **Fix**: Export `isVerifiedDeploymentPayload` from `lib/deliveryReport.ts` and use it in the command.
- **Decision**: FIXED

### F2 — Missing tests for deployment_incomplete, invalid_revision, reject of a non-deployment row, foreign-org evidence

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: packages/core/src/modules/delivery_os/commands/__tests__/decisions.test.ts
- **Detail**: Three rejection paths untested; the "another organization" case failed at the project lookup, not proving the evidence query is scoped.
- **Fix**: Added three tests incl. a deployment row with the same project id and a foreign organization → 404.
- **Decision**: FIXED

### F3 — Deploy decisions loaded without ordering

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/decisions.ts (deploy consent lookup)
- **Detail**: The report orders by `decidedAt, id`; on equal `decidedAt` (only possible for seeded rows) the command could pick another latest row.
- **Fix**: Pass `orderBy: { decidedAt: 'asc', id: 'asc' }`.
- **Decision**: FIXED

### F4 — Result-manifest acceptance does not take the project lock

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: commands/evidence.ts results path (pre-existing, also affects R20)
- **Detail**: The plan's premise "every writer takes the project lock" holds for R19 evidence but not for result acceptance, so a result committed in the same instant can be missed by the gate.
- **Fix**: Documented as a known limit in the hand-over; changing the result path's lock order is outside this task (pre-existing behaviour, shared by R20).
- **Decision**: ACCEPTED — recorded in OSS-05-L9d hand-over as an OSS-06 candidate

### F5 — Foreign-scope route test stops at the project lookup

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: api/__tests__/releaseDecision.route.test.ts
- **Detail**: Covered by the new command-level foreign-org evidence test (F2).
- **Decision**: FIXED (via F2)
