<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F1 L13b — Stage Artifact and Stage Decision Commands

- **Plan**: context/changes/asd-oss-t045-flow-f1-l13b-add-stage-artifact-and/plan.md
- **Mode**: Deep (claims verified directly against the code during research; no sub-agent — memory rule)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
9/9 paths ✓ (`commands/{flow,intake,projects,index,attachments}.ts`, `lib/{stageArtifacts,stageDecisions,flowRules}.ts`, `scopeChange.test.ts`), 3/3 symbols ✓ (`rbacService.getGrantedFeatures`, `checkProjectArchivable`, `collectAttachmentReferences`), brief↔plan ✓.

## Findings

### F1 — Stage entities have no `deletedAt`; loaders must not copy the project filter

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — helpers `loadStageArtifacts` / `loadStageDecisions`
- **Detail**: `DeliveryFlowStageArtifact` / `DeliveryFlowStageDecision` carry no `deletedAt` column; a `where` copied from `findScopedProject` (`deletedAt: null`) would be a MikroORM error at runtime and would silently return no rows through the test kit's `matches` (which treats a missing key as `null` and would match). The kit also ignores `orderBy`, so version/decision ordering must be done in code.
- **Fix**: Filter by `{ projectId, tenantId, organizationId }` only; sort artifacts by `version` and decisions by `decidedAt, id` in the mappers.
- **Decision**: FIXED

### F2 — `decide` fails closed to 403 when `rbacService` is unregistered — every test needs the fake

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — harness
- **Detail**: `makeHarness` registers no `rbacService`; with the planned fail-closed default every approval in the suite would answer 403 unless the local harness registers `{ getGrantedFeatures }`. Also, an empty `approverFeatures` list must pass without touching RBAC (the `qa`/`implementation` stages list `[]`, and `hasAllFeatures([], [])` is true) — the command should skip the RBAC call when the stage lists no features so a missing service cannot block a stage that needs none.
- **Fix**: Harness registers a configurable fake `rbacService.getGrantedFeatures` defaulting to `['delivery_os.stages.approve']`; the command resolves grants only when `templateStage.approverFeatures.length > 0`.
- **Decision**: FIXED

### F3 — Append-only static scan rejects property assignment on `*ecision*` variables

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — `commands/stages.ts`
- **Detail**: `appendOnly.test.ts` flags any line matching `\b[A-Za-z]*(?:aseline|vidence|ecision)[A-Za-z]*\.[A-Za-z]+\s*=`. Names such as `decisionRow.x = …` or `planDecision.currency = …` fail the scan even when they are not row mutations. The plan mentions the scan but gives no naming rule.
- **Fix**: Build rows with a single `tx.create(...)` literal, never assign afterwards; keep local names free of `decision`/`baseline`/`evidence` when a property assignment is unavoidable (e.g. `outcome`, `written`, `created`).
- **Decision**: FIXED

### F4 — `unknown_ac` acceptance criterion is not reachable through F7 v1 content

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Key Discoveries / Phase 2
- **Detail**: The task acceptance lists an `unknown_ac` case. Neither v1 content schema carries AC references, so the command can only produce it for content that does not exist yet. Adding an AC field to `designScreenSchema` would touch the frozen v1 draft/baseline screen contract.
- **Fix**: Keep the plan's approach (collector yields `[]`, resolved Scope AC set passed through, lib test covers the rule, command test documents the reachable `foreign_reference` path); record in the spec changelog and the hand-over as a limitation with a v2 proposal (`acIds` on design screens, additive).
- **Decision**: ACCEPTED

### F5 — Attempt guard ordering versus the optimistic lock is unspecified in the spec

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — `createArtifactCommand` step 6
- **Detail**: Both refusals are 409; the plan runs the domain plan (422s) → attempt guard → lock check. A stale header with an active attempt answers `attempt_active`, which is the more actionable message.
- **Fix**: Keep the plan order and state it in the hand-over.
- **Decision**: ACCEPTED
