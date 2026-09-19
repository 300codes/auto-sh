<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F1 L12b — Pure Stage-Decision and Flow-Status Rules

- **Plan**: context/changes/asd-oss-t043-flow-f1-l12b-add-pure-stage-decision/plan.md
- **Mode**: Deep (self-review, autonomous run)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 1 warning (fixed), 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (fixed) |
| Plan Completeness | PASS |

## Grounding
5/5 paths ✓ (`lib/flowRules.ts`, `lib/attempts.ts`, `lib/stageArtifacts.ts`, `lib/fixtures/flow/index.ts`, `packages/shared/src/security/features.ts`), 4/4 symbols ✓ (`computeStageCurrency`, `checkFlowGate`, `flowGateBlockers`, `hasAllFeatures`), brief↔plan ✓, Progress↔Phase ✓ (1.1, 2.1–2.3 match the Success Criteria bullets).

## Findings

### F1 — Replay lookup scoped to the stage while the unique key is per project

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, decision 1
- **Detail**: `delivery_flow_stage_decisions_project_idempotency_uq` is `(tenant, organization, project, idempotency_key)` (`data/entities.ts:501`). The request body carries no `stageId`, so the same key + same body sent to another stage would hash equal and be answered as a duplicate of the other stage's decision, while the insert would violate the index.
- **Fix**: Replay searches the project's decision rows (all stages) by key; a hit with the same `stageId` and hash is a duplicate, anything else is `idempotency_conflict`.
- **Decision**: FIXED

### F2 — Unbound open threads on the stage block approval

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, decision 4
- **Detail**: Threads without a confirmed design version (`artifactId: null`) block approval of any artifact of that stage until triaged or deferred. This fails closed (addendum: blocking comments must be resolved or explicitly deferred) at the cost of extra triage clicks in the demo.
- **Decision**: ACCEPTED (fail-closed is the safer default; UI surfaces the thread list)

### F3 — Legacy `nextAction: none` vs `pin_template`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Implementation Approach, decision 10
- **Detail**: The intake row is the only signal distinguishing a new unpinned project from a legacy one. Adam's wizard creates the intake before pinning, so the heuristic holds; documented in the hand-over notes.
- **Decision**: ACCEPTED
