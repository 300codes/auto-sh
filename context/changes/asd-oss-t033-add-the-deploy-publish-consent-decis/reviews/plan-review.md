<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-05 (L9c) deploy decision and route R20

- **Plan**: context/changes/asd-oss-t033-add-the-deploy-publish-consent-decis/plan.md
- **Mode**: Quick (grounding + targeted code checks, done inline)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding
5/5 paths ✓ (decisions.ts, baselines decisions route, schemas.ts, baselineTestKit.ts, spec), symbols ✓ (deployDecisionSchema, deliveryOsReportQueries, report_not_green/baseline_not_active in catalogue, delivery_os.deploy.approve, source_revision column), brief↔plan ✓. Progress↔Phase ✓.

## Findings

### F1 — Report read outside the transaction: consistency argument not written down

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details — report read timing
- **Detail**: `buildReport` forks the root EM, so it cannot see uncommitted rows of our tx and could in theory miss a concurrent evidence write. Verified: `commands/evidence.ts:509` and `commands/attempts.ts:148` take `lockScopedProject` (FOR UPDATE) before writing, so once R20 holds the project row lock no evidence/result can commit until the decision commits; everything committed earlier is visible. The plan should state this so nobody moves the report read before the lock.
- **Fix**: Add the serialization argument to Critical Implementation Details.
- **Decision**: FIXED

### F2 — Audit log label reuses "Record baseline decision" for deploy

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Command
- **Detail**: `buildLog` uses `delivery_os.audit.decisions.record` / "Record baseline decision"; an audit reader cannot tell a publish consent from a scope approval.
- **Fix**: For kind deploy use key `delivery_os.audit.decisions.deploy` with fallback "Record deploy decision" and parent resource = project; list the key for UI's i18n in the hand-over.
- **Decision**: FIXED
