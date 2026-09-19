# FLOW-F1 L12b — Pure Stage-Decision and Flow-Status Rules Implementation Plan

## Overview

Add the pure decision logic behind F8 (`POST /projects/:id/stages/:stageId/decisions`), F6 (`GET /projects/:id/flow`),
the in-process `deliveryOsFlowQueries.flowStatus` seam and F15 (`flow` section of the R22 report) of the Flow delta v1
(`.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1). No ORM, no routes, no commands: the L13 command
loads rows, calls these functions under the project lock and persists the outcome; the read route only assembles.

## Current State Analysis

- F0 schemas in `lib/contracts.ts` (block "Flow delta v1"): `stageDecisionRequestSchema` (schema-level
  `reason_required`), `stageDecisionResponseSchema`, `flowStatusV1Schema`, `flowBlockerSchema` (kinds incl.
  `attempt_active`, `intake_incomplete`, `template_not_pinned`), `flowPendingApprovalSchema`, `flowNextActionSchema`,
  `deliveryReportFlowSectionSchema`, `commentThreadTriageStatusSchema`.
- `lib/flowRules.ts`: `computeStageCurrency(template, artifacts, decisions, { openThreadsByStage })`,
  `checkFlowGate(states | null, stages, { v1Compatible })`, `flowGateBlockers(states | null)`, record types
  `StageArtifactRecord` / `StageDecisionRecord`.
- `lib/stageArtifacts.ts` (T042) shows the module shape to mirror: `plan*` returning `{ ok: true, duplicate, … } | failure`.
- `lib/attempts.ts`: `isAttemptActive`, `hasUnreconciledAttempt`, `ACTIVE_ATTEMPT_STATES` on the project attempt register.
- Platform wildcard ACL helper: `hasAllFeatures(granted, required)` from `@open-mercato/shared/security/features`
  (already imported by core modules, e.g. `customers/components/detail/useDealsAccess.ts`).
- Entity `DeliveryFlowStageDecision` (T041) carries `idempotencyKey`, `requestHash`, `templateHash`,
  `deferredThreadKeys`, encrypted client approver fields.
- `contracts.test.ts` pins the 54 v1 codes; every code used here (`forbidden`, `idempotency_conflict`,
  `subject_hash_mismatch`, `stage_artifact_stale`, `stage_not_approved`, `stage_dependency_stale`,
  `client_approval_required`, `blocking_comments_open`, `reason_required`, `foreign_reference`) already exists.

## Desired End State

`lib/stageDecisions.ts` and `lib/flowStatus.ts` export pure functions; `lib/__tests__/stageDecisions.test.ts` and
`lib/__tests__/flowStatus.test.ts` cover every code positively and negatively with the F0 fixtures. The FlowStatus
built from fixture-equivalent rows parses with `flowStatusV1Schema` and matches `flow-status.v1.json` on stage
currency and gates; a legacy project yields `template: null`, both gates ok and one informational blocker.

### Key Discoveries:

- `computeStageCurrency` already treats a client-required stage approved without `clientApproved` as `pending`
  (`flowRules.ts` `isEffectiveApproval`), so the decision rule must refuse such approvals up front
  (`client_approval_required`) instead of recording a decision that never counts.
- The F0 fixture `flow-status.v1.json` lists all 8 template stages; non-approval stages have `currency: null`,
  empty blockers, `openThreads: 0`; `currentStageId` is the first non-approved approval stage.
- Under jest, avoid `structuredClone` before `hashCanonical` (host-realm objects); use JSON round-trip.

## What We're NOT Doing

- No commands, routes, events, ACL feature ids, DI registration, migrations or entity changes (L13/L14).
- No route-level `stages.approve` check (route concern; the command re-checks the snapshot `approverFeatures` here).
- No `flow_not_pinned` / `stage_unknown` / lock handling / actual `Idempotency-Key` header parsing (command/route).
- No comment-import or triage rules (L12c / F2), only the read-side thread record the decision rule consumes.
- No change to any F0 schema, fixture or the 54-code pin.

## Implementation Approach

Decisions made autonomously (recorded in the final report):

1. **Request hash** = `hashCanonical(parsed StageDecisionRequest)` on the zod output (optional fields normalised to
   `null`/`[]` first so `{}` vs `{ reason: null }` hash alike). Replay looks up the **project's** decision rows (all
   stages — the unique index is `(project, idempotency_key)`) by `idempotencyKey`: same `stageId` and same hash →
   `duplicate` with the existing record and its current currency; another stage or another hash →
   `idempotency_conflict` (409). A new key always plans a new row (approve → reject → approve = three rows).
2. **Check order for F8**: approver features (`forbidden` 403, snapshot `approverFeatures` via `hasAllFeatures`,
   `manage` alone is insufficient — an empty `approverFeatures` list means any holder of the route feature) → replay
   → artifact identity (`foreign_reference` 422 with `foreign_artifact` detail when `artifactId` is not an artifact of
   this project and stage) → `stage_artifact_stale` 409 (artifact is not the stage's current version) →
   `subject_hash_mismatch` 409 (hash or version differ from the artifact) → verdict-specific checks.
3. **Rejections are always recordable** once the subject binds: `reason_required` (defensive re-check of the schema
   rule) is the only verdict check; upstream currency and threads are irrelevant to saying "no".
4. **Approvals** additionally need: every template upstream of the stage `approved` and the artifact bound to its
   current hash (`stage_not_approved` / `stage_dependency_stale` from `computeStageCurrency`, one detail per stage,
   `stage_not_approved` wins when both occur) → `client_approval_required` when the snapshot stage has
   `requiresClientApproval` and no `clientApproval` → `blocking_comments_open` for every thread that is
   `sourceStatus: open`, `triageStatus ∉ { resolved, deferred }`, bound to this artifact **or** unbound
   (`artifactId: null`) on this stage, and not listed in `deferredThreadKeys` (one detail per thread).
5. **Deferrals**: every `deferredThreadKeys` entry must name a thread of this stage (else `foreign_reference` with
   `unknown_thread` details); the plan returns hash-bound deferral records
   `{ threadKey, artifactId, contentHash, reason }` (reason = request `reason` or the constant
   `DEFERRED_BY_STAGE_DECISION`) only for threads that are currently open and un-triaged, so the command can set
   `triageStatus: deferred` on exactly those rows. Deferrals bind to the artifact hash; a new version clears them.
6. **Plan output** for a new row: `{ ok: true, duplicate: false, requestHash, record: { stageId, artifactId,
   subjectHash, subjectVersion, verdict, reason, clientApproved, deferredThreadKeys }, currency, deferrals }`,
   where `currency` is recomputed with the new decision appended (placeholder id, `decidedAt = now`). Client approver
   name/role/evidence are **not** echoed in the plan output; the command copies them from the parsed request into
   the encrypted columns.
7. **FlowStatus input** = in-memory rows: `{ project: { projectId, template: FlowTemplateV1 | null, templateRef,
   workflowInstanceId, updatedAt }, intakeStep | null, artifacts, decisions, threads (open counts per stage or thread
   records), attempts: AttemptRegister }`. Output for every template stage in template order: approval stages carry
   the currency map state; other stages get `currency: null`, `blockers: []`.
8. **Blockers and gates**: top-level `blockers` = `intake_incomplete` (intake exists and step ≠ `submitted`) +
   `flowGateBlockers(states)` + one `attempt_active` per active or reconciliation-required attempt (`ref` =
   attemptId). `gates.dispatchable` = flow gate **and** no attempt blocker (an unknown process must be reconciled
   before dispatch); `gates.publishable` = flow gate only (deploy consent is a v1 rule). Legacy (template null):
   `stages: []`, `pendingApprovals: []`, blockers `[template_not_pinned]` + attempt blockers, both gates
   `{ ok: true, blocking: [] }`.
9. **pendingApprovals** = approval stages with currency `pending` whose current artifact awaits a decision or a
   client approval, in template order, with the snapshot's `approverFeatures` and `requiresClientApproval`.
10. **currentStageId / nextAction**: template null → `pin_template` when an intake exists (new project before pin),
    `none` for a legacy project (never nudge v1 projects into the flow). Pinned: intake not submitted →
    `complete_intake`; else first approval stage not `approved` in template order decides: `missing` →
    `create_artifact`, `rejected` → `fix_rejection`, `stale` → `create_artifact`, `pending` with open threads →
    `resolve_comments`, `pending` → `approve_stage`; all approved → `currentStageId` = first non-approval stage of
    the template (or null) and `nextAction` = `dispatch` (or `none` while an attempt blocker exists).
11. **updatedAt** = max of project `updatedAt`, artifact `createdAt` (optional on the record) and decision `decidedAt`.
12. **Report section**: `buildDeliveryReportFlowSection({ templateRef, states })` → `null` for legacy projects,
    otherwise the four approval stages with `currency`, `approvedArtifact`, latest `decisionId`, `clientApproved`
    and `gate` = the publishable flow gate.

## Phase 1: Stage-decision rules

### Changes Required:

#### 1. `packages/core/src/modules/delivery_os/lib/stageDecisions.ts` (new)

**Intent**: pure rules for F8, mirroring `stageArtifacts.ts`.

**Contract**: exports `DEFERRED_BY_STAGE_DECISION`, `hashStageDecisionRequest(request)`,
`checkStageApprover(grantedFeatures, templateStage)`, `findReplayedStageDecision(existing, stageId, idempotencyKey)`,
`blockingThreadsFor(threads, stageId, artifactId)`, `planStageDecision({ request, idempotencyKey, stageId, template,
grantedFeatures, artifacts, decisions, threads, now })` → `{ ok: true, duplicate: true, existing, currency } |
{ ok: true, duplicate: false, requestHash, record, currency, deferrals } | failure`. Existing decision rows are
`StageDecisionRecord & { idempotencyKey, requestHash }`; thread rows are `CommentThreadRecord = { threadKey, stageId,
artifactId | null, sourceStatus, triageStatus }`.

#### 2. `lib/__tests__/stageDecisions.test.ts` (new)

Fixture-driven: positive fixture approves `key_visual` with client approval; every code negative; approve → reject →
approve as three keys = three rows with latest-wins currency; replay duplicate / conflict; stale downstream
(new scope version → approving the old UX artifact fails `stage_dependency_stale`, approving a UX bound to the old
scope fails `stage_artifact_stale`); deferral records hash-bound; no approver PII in the output.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/stageDecisions.test.ts --maxWorkers=2` green

## Phase 2: Flow-status rules and report section

### Changes Required:

#### 1. `packages/core/src/modules/delivery_os/lib/flowStatus.ts` (new)

**Contract**: exports `FlowStatusInput`, `buildFlowStatus(input): FlowStatusV1`, `buildDeliveryReportFlowSection(input)
: DeliveryReportFlowSection | null`, plus `attemptBlockers(register)` and `pendingApprovalsFor(template, states)` helpers.

#### 2. `lib/__tests__/flowStatus.test.ts` (new)

Rows equivalent to `flow-status.v1.json` → output parses with `flowStatusV1Schema`, stage currency, blockers, gates,
pendingApprovals, currentStageId, nextAction and updatedAt equal the fixture; legacy input → `template: null`, both
gates ok, `template_not_pinned`; attempt active → `attempt_active` blocker and dispatchable false; stale downstream
after a new scope version; intake not submitted → `complete_intake`; report section for pinned and legacy.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/flowStatus.test.ts --maxWorkers=2` green
- flowContracts / flowFixtures / stageArtifacts / contracts suites still green
- scoped typecheck of the new files (temporary tsconfig with jest/node types) and eslint on `delivery_os/lib` clean

## Testing Strategy

Unit only (pure functions). FLOW-02/04/09 integration specs ship with the L13 commands.

## References

- Spec rows F6, F8, F15 and "Server-side gate (D5)", "Currency (D6)", "Comment import rules": `.ai/specs/2026-09-18-delivery-os-hackathon.md`
- `lib/flowRules.ts`, `lib/stageArtifacts.ts` (plan/failure style), `lib/attempts.ts`
- BREAKDOWN UA-33 / UA-36 / UA-44 rows

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Stage-decision rules

#### Automated

- [x] 1.1 stageDecisions jest suite green

### Phase 2: Flow-status rules and report section

#### Automated

- [x] 2.1 flowStatus jest suite green
- [x] 2.2 flowContracts / flowFixtures / stageArtifacts / contracts suites still green
- [x] 2.3 scoped typecheck and eslint clean
