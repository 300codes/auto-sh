<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-05 L9a — pure delivery report rules

- **Plan**: context/changes/asd-oss-t031-oss-05-l9a-add-pure-delivery-report/plan.md
- **Mode**: Deep (self-review, autonomous session)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after F1, F3 fixes)
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
6/6 paths ✓ (`lib/contracts.ts`, `lib/acProof.ts`, `lib/traceability.ts`, `lib/projectStatus.ts`, `lib/evidenceRules.ts`, `lib/fixtures/index.ts`), 4/4 symbols ✓ (`clampTraceabilityLimit`, `buildProgress`, `deriveDeploymentVerificationStatus`, `proveAcceptanceCriteria`), brief↔plan ✓. `deliveryDocumentSchemas` is consumed only by `fixtures.test.ts` and `contracts.test.ts` (blast radius: tests only).

## Findings

### F1 — Row limit applies to expanded rows, not the traceability skeleton

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach / Phase 1 change 2
- **Detail**: `buildTraceability` applies its own `limit` to skeleton links. If the report passed the caller's limit through, the skeleton would be cut before test expansion and `totalRows` would undercount. The skeleton must be built with `MAX_TRACEABILITY_ROWS`; the caller's limit applies to the expanded rows; `totalRows` counts expanded rows.
- **Fix**: State in the plan that the skeleton call uses `MAX_TRACEABILITY_ROWS` and the report's own limit/truncation is computed over the expanded rows. A skeleton above 1000 links is an accepted bound (demo budget: ≤ 8 AC × 6 tasks).
- **Decision**: FIXED

### F3 — Report schema must expose `.shape`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 change 1
- **Detail**: `contracts.test.ts:481` iterates `Object.values(deliveryDocumentSchemas)` and reads `schema.shape`. The report schema must therefore be a top-level `z.object` (a `superRefine` on it is fine in zod v4, as `resultManifestV1Schema` shows), not a `z.union`/`z.pipe`.
- **Fix**: Note the constraint in the plan.
- **Decision**: FIXED

### F2 — Revision kind vs profile is not validated by the pure builder

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 change 2
- **Detail**: A caller may pass a snapshot revision for a git profile. The builder would report everything `missing`. The spec assigns `422 invalid_revision` to the route (R22), so the builder stays pure and the route validates with `assertRevisionKind`.
- **Fix**: Note it in the plan as a route responsibility; no builder change.
- **Decision**: ACCEPTED
