# FLOW-F1 L13c — Flow Gate on v1 Ready, Reserve and Deploy — Implementation Plan

## Overview

Enforce the server-side flow gate (spec D5 / breakdown C21) inside the three frozen v1 commands that dispatch work or
give publish consent: `delivery_os.tasks.update` → `ready`, `delivery_os.attempts.reserve` (manual and trusted
automatic mode) and `delivery_os.decisions.record` kind `deploy`. For a project pinned to a flow template the
commands load the append-only stage artifact and decision rows, derive stage currency and refuse with the frozen
v1 `422 baseline_not_approved` body whose `details[]` carry one entry per unapproved stage. Unpinned (legacy)
projects never touch the gate, so v1 clients and fixtures keep byte-identical behaviour.

## Current State Analysis

- `lib/flowRules.ts#checkFlowGate(states, requiredStages, { v1Compatible: true })` already produces the exact
  refusal body; `computeStageCurrency` derives currency; both are pure and tested (T040/T043).
- `commands/stages.ts` privately owns the row loaders (`loadStageArtifacts`, `loadStageDecisions`) and mappers
  (`toArtifactRecord`, `toStoredDecision`); nothing else can reuse them.
- `commands/tasks.ts#checkReadyGate` returns a v1 `DeliveryCheckResult` built from `ReadinessReason[]`; its callers
  (`checkStatusChange`) feed it to `canTransition` as `readiness`.
- `commands/attempts.ts` reserve: replay of an existing key returns before the lock; then lock header, v1 checks,
  then `task.executionAttempts = reservation.register`. One path serves both execution modes.
- `commands/decisions.ts#recordDeployDecision`: lock, profile/revision, active baseline, `report_not_green` for
  approvals, then `tx.persist(decision)`.
- The pinned marker columns (`flowTemplateId`, `flowTemplateSnapshot`, `flowTemplateHash`, …) are written together
  by `delivery_os.flow.pin`; no v1 code reads them yet.

## Desired End State

`commands/flowGate.ts` exports the shared loaders and `checkProjectFlowGateV1(em, project, scope)`; the three
commands call it at the documented points; `stages.ts` imports the loaders from it; `flowGate.test.ts` and
`flowRegression.test.ts` are green together with every pre-existing delivery_os suite; core typecheck green; a grep
shows the gate keyed only on `flowTemplateId` being non-null; spec changelog and running hand-over updated.

### Key Discoveries:

- With `v1Compatible` the refusal code is the v1 `baseline_not_approved`, so the flow result can be re-wrapped via
  `buildDeliveryError` into a `DeliveryCheckResult` and thrown by the existing `assertDeliveryCheck` — no new error
  path in the v1 commands.
- `appendOnly.test.ts` scans command sources for property assignment on `*decision*` variables: the loader may
  only map rows, never assign.
- Required stages are taken from the snapshot: the template's stages whose `kind` is an approval stage, in
  `FLOW_APPROVAL_STAGE_ORDER`. For `delivery-default@1` this equals the default list.

## What We're NOT Doing

- No new command, route, ACL feature, event, migration or generated registry (no `yarn generate`).
- No change to `lib/flowRules.ts`, `lib/flowStatus.ts`, F6/F14 or the enterprise worker; internal claim/finish
  commands are not gated (the attempt was already gated at reserve).
- No gate on a `rejected` deploy verdict (recording "no consent" never dispatches or publishes anything).
- No integration spec (`TC-DELIVERY-FLOW-02`) — that is L15; this layer is proven by jest suites.

## Implementation Approach

Extract, then insert. Phase 1 factors the loaders + gate into `commands/flowGate.ts` and wires the three call sites
with one additive line each after the v1 checks (v1 errors keep priority; the gate is the last server-side decision
before the write). Phase 2 adds the two suites. Phase 3 runs the module suite + scoped typecheck once and updates the
spec changelog and the running hand-over.

## Phase 1: Gate helper and call sites

### Overview

Create `commands/flowGate.ts`; move loaders out of `stages.ts`; add the gate call to the three commands.

### Changes Required:

#### 1. `commands/flowGate.ts` (new)

- `loadStageArtifactRows(em, projectId, scope)` / `loadStageDecisionRows(em, projectId, scope)` — moved from
  `stages.ts` (same queries via `findWithDecryption`, same ordering).
- `toStageArtifactRecord(row)` and `toStageDecisionRecord(row)` (the `clientApproved` rule: approved + approver name).
- `isFlowPinned(project)` = `project.flowTemplateId !== null && !== undefined` (the only key).
- Required stages: `FLOW_APPROVAL_STAGE_ORDER` (impl-review F1: the schema requires exactly one stage per kind, so no per-template filter).
- `loadFlowGateStates(em, project, scope)` → `StageCurrencyMap | null` (null when unpinned; snapshot parsed with
  `flowTemplateV1Schema.safeParse`, unreadable snapshot → fail closed).
- `checkProjectFlowGateV1(em, project, scope)` → `Promise<DeliveryCheckResult>`: unpinned → `{ ok: true }` without
  any query; pinned → `checkFlowGate(states, stages, { v1Compatible: true })` re-wrapped with `buildDeliveryError`.
  Unreadable snapshot → `{ ok:false }` with one `stage_not_approved` detail per default stage.

#### 2. `commands/stages.ts`

Replace the private loaders/mappers with imports from `./flowGate`; `toStoredDecision` keeps adding
`idempotencyKey`/`requestHash`/`subjectVersion` on top of `toStageDecisionRecord`. No behaviour change.

#### 3. `commands/tasks.ts`

In `checkReadyGate`, after `readinessFailure(reasons)` is computed: if it is ok, return
`await checkProjectFlowGateV1(tx, project, scope)`; otherwise return the v1 failure (v1 reasons keep priority). `commands/reconcile.ts:88` is the second caller: a reconciled task on a gated project lands in `blocked` (plan-review F1, intended).

#### 4. `commands/attempts.ts`

In reserve, after `canTransition(... 'executing' ...)` and before `if (!reservation.ok) throw` /
`task.executionAttempts = reservation.register`: `assertDeliveryCheck(await checkProjectFlowGateV1(tx, project, scope))`.
Replays of an existing key still return earlier, untouched.

#### 5. `commands/decisions.ts`

In `recordDeployDecision`, inside the `parsed.verdict === 'approved'` block after the `report_not_green` check:
`assertDeliveryCheck(await checkProjectFlowGateV1(tx, project, scope))`.

### Success Criteria:

#### Automated Verification:
- [ ] `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands --maxWorkers=2` green (existing suites unchanged)
- [ ] `grep -n "flowTemplateId" packages/core/src/modules/delivery_os/commands/*.ts` shows the key only in `flowGate.ts` (plus the pin command's write)

## Phase 2: Tests

### Overview

`commands/__tests__/flowGate.test.ts` and `commands/__tests__/flowRegression.test.ts` on the in-memory kit.

### Changes Required:

#### 1. `flowGate.test.ts`

Store = kit store + `stageArtifacts` + `stageDecisions` + `evidence`; project pinned to `DEFAULT_FLOW_TEMPLATE`
(`wordpress-theme@1`), active approved baseline with both v1 decisions, a draft task (for `ready`) and a ready task
(for reserve), green test + scan evidence for the deploy report. Stage rows are seeded directly (id, stageId, version,
contentHash, dependsOn, verdict, decidedAt, clientApproverName).

Cases:
- scope approved, ux pending: `ready`, manual reserve (HTTP + lock header), automatic reserve (in-process trusted),
  approved deploy → all `422 baseline_not_approved`, body parses with `deliveryErrorBodySchema`, `details[].path` =
  `stages.ux|key_visual|design_system_ui`, every `details[].code ∈ FLOW_GATE_DETAIL_CODES`; task status, register
  and decision store unchanged; no events.
- all four approved and current (KV/DS-UI with approver name) → the four commands proceed as in v1.
- new scope version (v2 pending) → refused again; `stages.scope` = `stage_not_approved`, `stages.ux` =
  `stage_dependency_stale`.
- `rejected` deploy verdict on the gated project → recorded (documents the decision).
- pinned id with `flowTemplateSnapshot: null` → refused fail-closed (four `stage_not_approved` entries).
- unpinned project → no query on `DeliveryFlowStageArtifact`/`DeliveryFlowStageDecision`.
- reconcile `not_started` of a reserved attempt on the gated project → task `blocked`, statusReason null (F1).
- `flowGateStages` unit: template without `key_visual` → three stages, canonical order.

#### 2. `flowRegression.test.ts`

Legacy (unpinned) fixtures through every gated command: `ready` happy path, `ready` refused for a missing design
decision with `details` exactly `['design_decision_missing']`, manual reserve, automatic trusted reserve, approved
and rejected deploy. Assertions: results/status/register/decision rows match the v1 expectations and
`findWithDecryption` was never called with the stage entities (no gate effects).

### Success Criteria:

#### Automated Verification:
- [ ] `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/flowGate.test.ts src/modules/delivery_os/commands/__tests__/flowRegression.test.ts --maxWorkers=2` green

## Phase 3: Gate, spec and hand-over

### Changes Required:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` once (all suites).
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` once.
- Spec changelog line (D5 implemented for R10/R12/R14/R20; F14 pending L20) in
  `.ai/specs/2026-09-18-delivery-os-hackathon.md`.
- Append 3–6 lines to `context/changes/delivery-os-oss-domain/handover/FLOW-progress.md` (create if missing).

### Success Criteria:

#### Automated Verification:
- [ ] module suite green under `--maxWorkers=2`
- [ ] core typecheck green

#### Manual Verification:
- [ ] Human confirms UA-48 on the live app once L14 routes exist (R10/R12/R14/R20 answer the gated body)

## Testing Strategy

### Unit Tests:
See Phase 2. Suites share the module-level mocks of `@open-mercato/shared/lib/encryption/find` and `../../events`.

### Integration Tests:
Deferred to L15 (`TC-DELIVERY-FLOW-02`), where routes exist.

### Manual Testing Steps:
None at this layer beyond the Manual row above.

## Performance Considerations

Two extra indexed queries per gated write on pinned projects only; unpinned projects issue none.

## Migration Notes

None.

## References

- `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1 → Server-side gate (D5)
- `/Users/mateuszstopinski/Documents/om-hack/autodev/state/BREAKDOWN.md` → C21, UA-48/49, L13
- `packages/core/src/modules/delivery_os/lib/flowRules.ts`
- `context/changes/delivery-os-oss-domain/handover/FLOW-F1-L13b-stages.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Gate helper and call sites

#### Automated

- [x] 1.1 Create commands/flowGate.ts with shared loaders and checkProjectFlowGateV1
- [x] 1.2 Point stages.ts at the shared loaders
- [x] 1.3 Gate task ready, attempt reserve (both modes) and approved deploy decisions

### Phase 2: Tests

#### Automated

- [x] 2.1 Add commands/__tests__/flowGate.test.ts
- [x] 2.2 Add commands/__tests__/flowRegression.test.ts

### Phase 3: Gate, spec and hand-over

#### Automated

- [x] 3.1 Run the delivery_os module suite and the scoped core typecheck
- [x] 3.2 Update the spec changelog and the running FLOW hand-over

#### Manual

- [ ] 3.3 Human confirms UA-48 on the live routes once L14 lands
