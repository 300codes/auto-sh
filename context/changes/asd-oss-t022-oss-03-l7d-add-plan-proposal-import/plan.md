# OSS-03 (L7d): Plan-Proposal Import Implementation Plan

## Overview

Add `delivery_os.tasks.import_plan` and wire it on R10 (`POST /api/delivery_os/projects/:id/tasks`,
`source: 'plan_proposal'`). A `PlanProposal v1` prepared for the project's active, approved baseline becomes, in one
transaction under the project row lock, one merged baseline (version n+1, `parentBaselineId`, plan section, frozen
AC→test map) and N draft tasks keyed by `proposalTaskKey`. The import is idempotent by `manifestId` + manifest hash
and never flips `activeBaselineId` — a human approves the merged baseline before any task can become `ready`.

## Current State Analysis

See `research.md`. `validatePlanProposal` (pure) already produces the merged content and ordered task drafts; the
requirements import (`commands/baselines.ts`) is the persistence/idempotency pattern; R10 already gates
`plan_proposal` on `delivery_os.results.import` but answers `400 unsupported_source`. `checkReadyGate` already refuses
`ready` for tasks of a non-active or undecided baseline.

## Desired End State

`POST …/tasks { source: 'plan_proposal', manifest }` with a valid lock header answers
`201 { baselineId, version, contentHash, duplicate: false, tasks: [{ id, proposalTaskKey, updatedAt }], projectUpdatedAt }`;
the same manifest again answers `200 duplicate: true` with the same ids and no writes (even with a stale/missing
header); any rejected plan leaves zero new rows. Verified by jest in the `delivery_os` scope and a live smoke on :3100.

### Key Discoveries

- `validatePlanProposal` does not record `{ manifestId, manifestHash }` in `importedManifests`, which the replay lookup
  (`findImportedManifest`) needs → additive change in `lib/proposals.ts` plus an identity-only `parsePlanProposal`.
- After an approved merged baseline becomes active, an identical replay would fail `baseline_not_approved` /
  `baseline_hash_mismatch` — replay lookup must run before every baseline check (T019 note).
- Ids must exist before flush (tasks reference the merged baseline and each other) → pre-generate with `randomUUID`
  like `delivery_os.tasks.create` does.

## Decisions (planning questions answered autonomously)

| # | Question | Choice | Why |
|---|----------|--------|-----|
| 1 | Where does the command live? | New `commands/planImport.ts`, registered in `commands/index.ts`; small helpers exported from `baselines.ts` / `tasks.ts` | `tasks.ts` is 687 lines; keeps the diff reviewable |
| 2 | Error precedence | 404 → 400/422 manifest schema + `foreign_project` → replay 200 / 409 `idempotency_conflict` → 428 → platform 409 → 422 `foreign_baseline` / unreadable → 422 `baseline_not_approved` → `validatePlanProposal` (hash mismatch, profile, content) | Same as R7 import (T021); approval before content so the agent is not asked to fix a plan for a baseline a human still has to approve |
| 3 | `baseline_not_approved` rule | referenced baseline must be `project.activeBaselineId` (`baseline_not_active`) AND `resolveActiveBaseline` true for its hash+version (`<kind>_decision_missing`…) | Task text; reuses the ready-gate vocabulary |
| 4 | Replay result | lowest-version baseline carrying the `manifestId`; tasks = live tasks pinned to it with a `proposalTaskKey` of the manifest, manifest dependency order | Archived tasks are neither returned nor re-created (the partial unique ignores `deleted_at`); pinned by a test (plan review F2) |
| 5 | Unique violation (version/hash/task key race) | re-run the replay lookup on a fresh EM; found with same hash → duplicate, else rethrow | Task requires recovery; one code path for all three uniques |
| 6 | Does the import touch the project? | Yes: shallow-spreads `architectureSummary`, `planSummary`, `acTestMap`, `declaredTests` over the stored `draftSpec` record (the draft is never parsed here — plan review F1), bumps `updatedAt`, returns `projectUpdatedAt`; never writes `activeBaselineId` | Mirrors T021; a later manual freeze keeps the plan section; unattended client continues without a GET |
| 7 | Existing tasks of the parent baseline | untouched | Scope-change rules are a separate L7 item |
| 8 | DAG check | `taskGraphCheck` over live project tasks + new nodes, under `lockScopedProjectTasks` | Same domain validation as manual tasks |
| 9 | Body cap on R10 | `readCappedRouteBody`, 1 000 000 bytes, for both sources (413 `payload_too_large`) | ≤100 tasks fit easily; additive error |
| 10 | Events | `emitBaselineCreated`, project `updated` side effect, per task `created` side effect + `delivery_os.task.updated`, all after commit, none on duplicate | Existing event ids only |
| 11 | Audit | one log entry on the merged baseline (`delivery_os.audit.tasks.import_plan`), snapshot carries manifest identity, parent id and task ids | One business action = one audit row |
| 12 | `attachmentIds` of the merged baseline | copied from the parent | Same renders; keeps attachment retention intact |

## What We're NOT Doing

- No migration, entity, event, ACL or DI change; no UI/i18n (patch request to UI in the hand-over).
- No design-manifest import, no scope-change handling of tasks pinned to older baselines, no auto-approval.
- No change to `delivery_os.tasks.create` behaviour for `manual`.

## Phase 1: Domain — identity, merged content and the import command

### Changes Required

#### 1. `lib/proposals.ts`
**Intent**: add `parsePlanProposal(manifest, projectId)` (schema + `foreign_project` + hash → identity) and make
`validatePlanProposal` append `{ manifestId, manifestHash }` to `importedManifests` of the merged content.
**Contract**: `PlanProposalIdentity = { ok: true, manifest, manifestId, manifestHash }`; merged content keeps parent
entries (dedupe by `manifestId`). Additive; update `lib/__tests__/proposals.test.ts`.

#### 2. `commands/baselines.ts`, `commands/tasks.ts`
**Intent**: export `listProjectBaselines`, `findImportedManifest`, `emitBaselineCreated`; export
`readBaselineContent`, `foreignBaselineError`, `unreadableBaselineError` and extract `loadBaselineDecisionRecords`
from `checkReadyGate`. No behaviour change.

#### 3. `commands/planImport.ts` (new) + `commands/index.ts`
**Intent**: the command per decisions 2–12.
**Contract**: `PlanImportCommandResult = { baselineId, projectId, version, contentHash, parentBaselineId, duplicate,
manifestId, manifestHash, tasks: [{ id, proposalTaskKey, updatedAt }], projectUpdatedAt }`. Input
`{ projectId, source: 'plan_proposal', manifest }` parsed with `taskCreateSchema`.

#### 4. Tests
`commands/__tests__/planImport.test.ts` (+ `tasks` in `baselineTestKit` `emptyStore()`, `persist` routes `'proposalTaskKey' in row` first; whole delivery_os scope re-run — plan review F3): success (one transaction, one
baseline with parent link, N tasks, deps resolved, `activeBaselineId` unchanged, draft synced, events); negatives
foreign baseline / unknown AC / path escape / false test mapping / cycle / hash mismatch / unapproved / not active →
422 with `persist` never called; 428/409 lock; replay without header → duplicate, no writes; `idempotency_conflict`;
unique-violation recovery; foreign org 404.

### Success Criteria

#### Automated Verification
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- test files type-check with a temporary tsconfig

## Phase 2: R10 wiring, schemas, spec and hand-over

### Changes Required

#### 1. `api/projects/[id]/tasks/route.ts`, `api/schemas.ts`
**Intent**: COMMAND_BY_SOURCE dispatch, capped body, `operation: 'custom'` for the import, 201/200 by `duplicate`,
`planImportResponseSchema`, openApi responses/errors (409, 413, 428 added).

#### 2. `api/__tests__/tasks.route.test.ts`
manage-only 403; 201 shape parsed by the schema; re-import 200 same ids, no duplicate tasks; rejected plan writes
nothing; imported task `→ ready` answers 422 `baseline_not_approved` until the merged baseline has both decisions and
is active; 413.

#### 3. Docs
Spec UA-07 row, command table, changelog entry; hand-over
`context/changes/delivery-os-oss-domain/handover/OSS-03-L7d-plan-import.md`.

### Success Criteria

#### Automated Verification
- delivery_os jest scope green; `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` and lint of core pass

#### Manual Verification
- Live smoke on :3100: import → 201, replay → 200, tampered → 409, task ready → 422 (evidence only; human accepts)

## Testing Strategy

Unit tests with EM spies (above). Integration spec files belong to QA (`TC-DELIVERY-004`); hand-over lists the scenario.

## References

- `commands/baselines.ts:261`, `lib/proposals.ts:362`, `commands/tasks.ts:321,487`, spec UA-07.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain — identity, merged content and the import command

#### Automated

- [x] 1.1 delivery_os jest scope green
- [x] 1.2 test files type-check with a temporary tsconfig

### Phase 2: R10 wiring, schemas, spec and hand-over

#### Automated

- [x] 2.1 delivery_os jest scope green; core typecheck and lint pass

#### Manual

- [ ] 2.2 Live smoke on :3100: import → 201, replay → 200, tampered → 409, task ready → 422
