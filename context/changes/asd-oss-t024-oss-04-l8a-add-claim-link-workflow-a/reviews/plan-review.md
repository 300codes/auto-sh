<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-04 (L8a) claim, link_workflow, mark_delivery and closing the attempt on accept

- **Plan**: context/changes/asd-oss-t024-oss-04-l8a-add-claim-link-workflow-a/plan.md
- **Mode**: Deep
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes; REVISE before)
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

Grounding: 6/6 paths ✓, 5/5 symbols ✓ (`claimAttempt`, `lockScopedTask`, `emitTaskSideEffects`, `createDeliveryOsAttemptQueries`, `trustedExecutionSchema`), brief↔plan ✓, Progress↔Phase ✓. Sub-agent confirmed: nothing reads `closedAt`; no schema refinement couples `closedAt` to `state`; no existing assertion breaks as long as closing stays a separate reducer; the reserve replay works in the results harness.

## Findings

### F1 — A workflow-safe command allow-list exists; `trustedExecution` is input a workflow definition could set

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: "What We're NOT Doing", Phase 2 tests
- **Detail**: Research said `registerWorkflowSafeCommands` has no hit; it exists in `packages/core/src/modules/workflows/lib/workflow-safe-commands.ts:53`. `UPDATE_ENTITY` builds a ctx without `request`, so if anybody ever registered these ids, the `!ctx.request` half of the gate would pass and the input-level option would be the only barrier.
- **Fix**: add a static guard test (no file of the module mentions `registerWorkflowSafeCommands`) and state the rule in the spec and hand-over.
- **Decision**: FIXED — plan Phase 2 tests + Phase 3 docs updated; research corrected.

### F2 — Index refresh and audit only happen through `commandBus.execute`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decision 9, Phase 3 hand-over
- **Detail**: `emitTaskSideEffects` only queues `markOrmEntityChange`; the flush and `buildLog` run inside the command bus. A bridge calling `handler.execute` directly would skip both.
- **Fix**: hand-over states "call through `commandBus.execute(id, { input, ctx })` with a ctx that has no `request`".
- **Decision**: FIXED

### F3 — "No API change" is not exact

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: "What We're NOT Doing", Migration Notes
- **Detail**: `api/schemas.ts:117` reuses `executionAttemptSchema` for task responses, so the OpenAPI of the task endpoints gains optional `deliveryAttempts`, and `closedAt`/`outcome` become non-null for result attempts. Additive, but UI/QA must hear about it.
- **Fix**: say so in the plan and list it in the hand-over limitations / patch requests.
- **Decision**: FIXED

### F4 — Flow test must link the workflow before accept

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 tests (results)
- **Detail**: The seeded attempt is `manual_handoff` without `workflowRef`; the reserve replay must not pass `trustedExecution` (403 on manual mode), and `pending` only appears when `link_workflow` ran before accept.
- **Fix**: flow = reserve replay → claim → link_workflow(dispatched) → executor → accept → redelivery → duplicate accept → mark_delivery.
- **Decision**: FIXED

### F5 — Keep closing out of `recordAttemptResult`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 reducers
- **Detail**: `lib/__tests__/attempts.test.ts:371` pins `closedAt: null, outcome: null` after `recordAttemptResult`; the plan already keeps `closeAttempt` separate — make that explicit so the implementer does not fold it in.
- **Fix**: one sentence in Phase 1.
- **Decision**: FIXED
