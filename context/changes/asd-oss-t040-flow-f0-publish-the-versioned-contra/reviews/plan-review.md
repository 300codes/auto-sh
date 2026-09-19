<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F0 contract delta

- **Plan**: context/changes/asd-oss-t040-flow-f0-publish-the-versioned-contra/plan.md
- **Mode**: Quick (autonomous self-review; no human available)
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
5/5 paths ✓ (lib/contracts.ts, lib/fixtures/index.ts, lib/__tests__/, .ai/specs/2026-09-18-delivery-os-hackathon.md, context/changes/delivery-os-oss-domain/handover/), symbols ✓ (parseVersioned, deliveryErrorCodes, addDeliveryIssue, designScreenSchema, acceptanceCriterionSchema), brief↔plan ✓

## Findings

### F1 — `thread_not_found` duplicates the frozen no-oracle rule
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — error codes
- **Detail**: v1 answers `404 not_found` for foreign and missing records alike (T036 decision). A dedicated code would create a second 404 body shape for the same situation.
- **Fix**: remove `thread_not_found`; triage answers `404 not_found`.
- **Decision**: FIXED

### F2 — Domain-stage negatives cannot be rejected in F0 jest
- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — fixtures / tests
- **Detail**: Acceptance says new schemas must reject the negative fixtures in jest. Cases like "chosen platform differs from the frozen profile" or "dependency stale against the DB" need a project row, so a `domain` stage would leave those fixtures unasserted.
- **Fix**: F0 negative fixtures are schema-stage only (`expected.stage: 'schema'`); domain rejections are listed in the spec Integration Coverage as F1/F2 tests with their error codes. Keep the schema-detectable variants: dependency not upstream (fixed stage order), template cycle/duplicate stage, duplicate thread key, reject without reason, verified publication without evidence, unknown schema version, intake invalid step.
- **Decision**: FIXED

### F3 — Report `flow` section is defined but not asserted against the v1 report fixture
- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: End-State Alignment
- **Location**: Phase 1
- **Detail**: To prove additivity, the test should show `deliveryReportV1Schema.extend({ flow: deliveryReportFlowSectionSchema.optional() })` still parses the v1 report fixture.
- **Fix**: add that assertion to `flowContracts.test.ts`.
- **Decision**: FIXED
