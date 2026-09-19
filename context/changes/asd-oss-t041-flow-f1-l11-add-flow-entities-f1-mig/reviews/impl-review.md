<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F1 L11 — flow entities, F1 migration, encryption map and validators

- **Plan**: context/changes/asd-oss-t041-flow-f1-l11-add-flow-entities-f1-mig/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-09-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Evidence: independent read of the diff against the spec table (columns, uniques, indexes, nullability all match in
entities, SQL and snapshot); encryption entity ids resolve via `resolveEntityIdFromMetadata` and field names via
`findKey` (snake → camel); jsonb encryption has precedent in sales. Automated: core data jest 87/87, core typecheck
green, delivery_os jest 59 suites / 1304 tests green, db:generate `delivery_os: no changes`.

## Findings

### F1 — Path stage validated by enum, spec wants 422 stage_unknown from the pinned template first

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: packages/core/src/modules/delivery_os/data/validators.ts (stageArtifactCreateCommandSchema)
- **Detail**: an unknown `stageId` fails the command schema with 400; the F7 route must check the path stage against the pinned template before parsing (422 `stage_unknown`).
- **Fix**: route-layer responsibility (later F1 layer); recorded in hand-over notes.
- **Decision**: ACCEPTED

### F2 — trustedExecution must never be forwarded from request bodies

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: validators.ts (scopingProposalImportCommandSchema, flowInstanceLinkCommandSchema, stageArtifactCreateCommandSchema)
- **Detail**: same pattern as v1 commands; F1 routes need the equivalent of the `attempts.route.test.ts` forged-trustedExecution test.
- **Fix**: noted for the route layer.
- **Decision**: ACCEPTED

### F3 — Artifact source type duplicated the contract enum

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/core/src/modules/delivery_os/data/entities.ts (DeliveryFlowStageArtifactSource)
- **Detail**: hand-written union could drift from `stageArtifactSourceSchema`.
- **Fix**: derive from `StageArtifactV1['source']`.
- **Decision**: FIXED

### F4 — Path/body stage mismatch reported as foreign_reference

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: validators.ts (stageArtifactCreateCommandSchema)
- **Detail**: spec lists no dedicated code for "path stageId must equal body"; `foreign_reference` (422) is the closest existing v1 code and avoids adding error codes (contracts.test pins them).
- **Decision**: DISMISSED — intentional, recorded in plan decisions.
