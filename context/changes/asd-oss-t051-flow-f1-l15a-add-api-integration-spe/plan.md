# TC-DELIVERY-FLOW-01/02/09 — F1 flow on the real database — Implementation Plan

## Overview

Three self-contained Playwright API specs drive the F1 routes against the running local app (:3100) and its Postgres
(:5442): the intake wizard (FLOW-01), stage approvals plus the v1 dispatch/publish gate (FLOW-02) and upstream-change
invalidation with an active attempt (FLOW-09). A shared spec-local helper carries the seeding and SQL teardown.

## Current State Analysis

- `TC-DELIVERY-OSS-001.spec.ts` (T050) is the model: `readFileSync` fixtures, `caller()` wrapper, `createUserFixture`
  + `setUserAclInDb`, `createOrganizationInDb`, SQL hard-delete teardown that also clears `entity_indexes` and
  `search_tokens`, and an `afterAll` count assertion. Its `deleteProjectsInDb` already deletes the three F1 tables.
- Route behaviour is fixed by the jest route tests (`api/__tests__/{intake,flowPin,flowStatus,stageArtifacts,stageDecisions}.route.test.ts`)
  and the fixture shapes by `api/__tests__/stageRouteKit.ts`.
- Check ordering that shapes the scenarios (research):
  - `commands/attempts.ts:229-236`: reserve validates the task lifecycle (`ready → executing`) before the flow gate,
    so a draft task never reaches the gate on R14.
  - `commands/decisions.ts:178-192`: deploy consent needs a green report (`report_not_green`) before the flow gate.
  - `commands/tasks.ts:376`: task `ready` runs the flow gate last, after v1 readiness.
  - `commands/stages.ts:330`: a new artifact version refuses active/unknown attempts via `checkProjectArchivable(tasks,'stage')`
    (`409 attempt_active`); `cancel_requested` is still active (`contracts.ts:607`), reconcile `stopped` closes it.
  - `lib/stageArtifacts.ts:211`: Scope content platform must equal the frozen profile → wordpress-theme projects.
  - `lib/flowRules.ts`: gate detail codes `stage_not_approved` (missing/pending/rejected) and `stage_dependency_stale`.
- The wordpress-theme profile (`lib/targetProfiles.ts:110-138`) uses `snapshot` revisions, allowed roots such as
  `templates/**`, checks `smoke-tests` (test) + `lint`, no scans; `buildResultManifest` derives snapshot result revisions.

## Desired End State

```
BASE_URL=http://localhost:3100 npx playwright test --config .ai/qa/tests/playwright.config.ts \
  packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-0{1,2,9}*.spec.ts --retries=0
```
passes; `/tmp/t050-counts.sh` prints identical counts before and after; each failure path asserts `status` and
`body.code`; a sibling-organisation user gets 404 on every F1 id in every spec; the delivery_os jest suite is still green.

## What We're NOT Doing

- No changes outside `__integration__/`; no domain fixes (report them).
- No foreign-tenant user (T050 already proves tenant isolation on v1; the sibling org is the F1 requirement).
- No live Figma/WordPress; no UI.

## Implementation Approach

Decisions (self-answered planning questions):

| Question | Choice | Why |
|---|---|---|
| Profile for FLOW-02/09 | `wordpress-theme@1`, snapshot base revision, `allowedPaths: ['templates/**']`, `changedPaths: ['templates/index.html']` | Fixture stays unchanged, matches the WP demo; fallback to react-vite with a platform override only if the profile blocks the v1 seed |
| Reaching the gate on R14/R20 | Seed a **legacy** v1 project first (task A verified → green report, task B ready, task C draft), then pin | Reserve and deploy check lifecycle/report before the gate; pinning an in-flight project is the addendum's bypass risk |
| Shared code | `flowSpecKit.ts` in `__integration__` (not `.spec.ts`, so discovery ignores it) | Three specs share seeding, calls, teardown; the task allows one helper |
| Foreign scope | one sibling org user with `delivery_os.*` per spec | Cheapest 404 proof for every new route |
| "old hash 409" (FLOW-02) | wrong `subjectHash` → `409 subject_hash_mismatch`; superseded artifact → `409 stage_artifact_stale` proven in FLOW-09 | Both 409 codes covered once |
| attempt_active (FLOW-09) | reserve → cancel (`cancel_requested`, still active) → artifact `409 attempt_active` → reconcile `stopped` (closes the attempt, releases the task; `unknown` would block it) → artifact 201 | Mirrors R17/R18 contract |
| manage-only 403 (FLOW-02) | assert status 403 and no new decision row; the body comes from the route guard, not the flow error schema | Review F2 |
| Registries | `createRegistry()` per spec file, passed to every kit helper | Playwright may cache modules across files in one worker (review F3) |
| Parallel work | kit by me, then three subagents write one spec each; I run specs sequentially | Disjoint files; one heavy command at a time |

## Phase 1: Shared kit

### Changes Required:

**File**: `packages/core/src/modules/delivery_os/__integration__/flowSpecKit.ts`

**Intent**: spec-local helpers shared by the three specs: `caller`, `sql`, fixture loaders via `readFileSync`
(`intake.v1.json`, `scoping-proposal.v1.json`, `stage-artifact.scope.v1.json`, `baseline-content.v1.json`), project
creation (wordpress-theme), pin, artifact/decision helpers, v1 seed (`seedLegacyFlow`: draft → baseline → decisions →
tasks → ready/reserve/result/review), sibling-org user creation, SQL teardown + count (T050 shape) and constants.

**Contract**: exports only; no `.spec.ts` suffix; never names internal command ids; `deleteProjectsInDb` also clears
`delivery_intakes`, `delivery_flow_stage_artifacts`, `delivery_flow_stage_decisions`, indexes/tokens and action logs.

### Success Criteria:

#### Automated Verification:
- `yarn tsc --noEmit -p packages/core` is not needed; the specs compile under Playwright's transform when run.

## Phase 2: Three specs (parallel subagents)

**File**: `TC-DELIVERY-FLOW-01-intake.spec.ts` — UA-30/31, proposals: empty default (`updatedAt` = project createdAt),
PUT without lock 428, save `brief`/resume, stale 409 while concurrent project PUT 200, `proposals` stripped, chosen ≠
profile 422 `target_profile_frozen`, proposals import 201 → replay 200 duplicate → other hash 409 `idempotency_conflict`
→ projectId mismatch 422 `foreign_reference`, `submitted` with unanswered blocking question 422 `intake_step_invalid`;
sibling org 404 on GET/PUT intake and POST proposals; SQL: one `delivery_intakes` row, brief encrypted at rest not asserted
(local tenant has encryption off).

**File**: `TC-DELIVERY-FLOW-02-stage-approvals.spec.ts` — UA-32/35/36/37/48: legacy seed, pin 201/200/409, scope
artifact 201/duplicate 200, F8 400/201/200/409/409(hash), UX artifact pending → task C ready 422, task B reserve 422,
deploy consent 422 (all `baseline_not_approved`, details codes in the set), GET /flow pendingApprovals=[ux] and gates
closed; approve UX, KV without clientApproval 422, with 201, DS/UI 201; manage-only user 403; then task C ready 200,
task B reserve 201, deploy consent 201, GET /flow gates ok; history listings; sibling org 404 on pin, artifacts, decisions, flow.

**File**: `TC-DELIVERY-FLOW-09-upstream-change.spec.ts` — UA-38: full chain approved, task ready; new Scope version 201
→ GET /flow ux/key_visual/design_system_ui `stale`, gates closed, R14 reserve 422 with `stage_dependency_stale`
details; F9 history keeps old decisions; approving scope v1 → 409 `stage_artifact_stale`; approve v2 then reserve on a
ready task → cancel → new UX artifact 409 `attempt_active` → reconcile `stopped` → artifact 201; sibling org 404.

### Success Criteria:

#### Automated Verification:
- Each spec passes against :3100 with `--retries=0`.
- Counts identical before/after (`/tmp/t050-counts.sh`).
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green.

#### Manual Verification:
- Human acceptance of FLOW-01/02/09 rows in the master plan Progress (OSS owner records after evidence).

## References

- Model spec: `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-OSS-001.spec.ts`
- Route kits: `packages/core/src/modules/delivery_os/api/__tests__/{stageRouteKit,flowHelpers}.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared kit

#### Automated

- [x] 1.1 flowSpecKit.ts written and used by all three specs

### Phase 2: Three specs

#### Automated

- [x] 2.1 TC-DELIVERY-FLOW-01-intake.spec.ts passes on :3100
- [x] 2.2 TC-DELIVERY-FLOW-02-stage-approvals.spec.ts passes on :3100
- [x] 2.3 TC-DELIVERY-FLOW-09-upstream-change.spec.ts passes on :3100
- [x] 2.4 Row counts identical before/after the three runs
- [x] 2.5 delivery_os jest suite green (--maxWorkers=2)

#### Manual

- [ ] 2.6 Human acceptance of FLOW-01/02/09 in the master plan
