# OSS-02 (L4c): task commands with DAG, AC and transition validation — Implementation Plan

## Overview

Add `delivery_os.tasks.create` (manual source), `.update` and `.delete` so a delivery lead can add a task to an approved
baseline, edit it, set it `ready` / `blocked` / `cancelled`, and archive it — with every safety rule enforced by the
system, never by the caller (UA-08, UA-09, UA-04).

## Current State Analysis

`commands/shared.ts` and `commands/projects.ts` (T010) provide scope resolution, locked loads, the optimistic-lock
pattern, the audit-log pattern and the attempt/archive classifier. `lib/dag.ts`, `lib/taskLifecycle.ts`,
`lib/baseline.ts`, `lib/targetProfiles.ts` hold all pure rules. No task command exists. See `research.md`.

## Desired End State

Three registered commands; `commands/__tests__/tasks.test.ts` proves the failure paths named in the task; the whole
`delivery_os` jest folder and the scoped typecheck pass. No migration, no new error code, no contract change.

### Key Discoveries:

- `taskCreateSchema` has no `projectId` (`data/validators.ts:177`) — the command input is `{ projectId, ...body }`.
- `validateTaskGraph` reports `other_project` only for nodes it is given (`lib/dag.ts:67`), so dependency ids are loaded
  inside the caller's scope and added as nodes; ids of another tenant stay `unknown_dependency`.
- The lifecycle table allows `executing → ready|blocked` and `blocked → draft` under `reconciliation_required`
  (`lib/taskLifecycle.ts:16`); a user status update must not release a live or unknown run or wipe that reason.
- Lock order from T010: project row, then the project's live task rows.

## Decisions (questions answered autonomously)

| # | Question | Answer | Why |
|---|---|---|---|
| 1 | `plan_proposal` source in create? | Rejected with `400 validation_failed` (`source` / `unsupported_source`) | Plan import is OSS-03 and needs merged-baseline logic |
| 2 | Project lock on task create/update? | Pessimistic row lock on the project (no optimistic header for the project), then all live project tasks | Serializes graph edits → no cycle race; same order as archive |
| 3 | Code for a baseline of another project/scope | `422 foreign_reference`, detail `baselineId` / `foreign_baseline`; same answer when the baseline does not exist | Spec UA-08 list; no existence leak |
| 4 | Dependency in another project / unknown | `422 foreign_dependency` with details `other_project`, `other_baseline`, `unknown_dependency` | Existing `taskGraphCheck` |
| 5 | Which fields are editable when? | `acIds`, `dependsOnTaskIds`, `allowedPaths` only in `draft` or `blocked` **and only while the attempt register is empty** (plan-review F1); otherwise `409 invalid_transition` detail `task_not_editable`. `title`/`description` always | A `ready`/running task's scope was already gated or exported; editing it would bypass the ready gate |
| 6 | User status change with a live/unknown attempt or `executing` | Refused with the archive classifier: `409 attempt_active` / `409 reconciliation_required` | "Agent proposes, system decides": only attempt/reconcile commands release a run |
| 7 | `statusReason` on user status change | `dependency_blocked` is cleared when leaving `blocked`; `reconciliation_required` and `correction_limit_reached` are never cleared here | Only reconcile / review flows own those reasons |
| 8 | Non-active baseline on `→ ready` | `422 baseline_not_approved`, detail `baselineId` / `baseline_not_active`, listed before other readiness details | Task text; T008 note |
| 9 | Correction budget | `requested` = count of `review` evidence of the task with `payload.verdict === 'changes_requested'` and no `manualCheckId`; `max` = `project.limits.maxCorrectionRounds`; loaded on every status change | Fully built `TransitionContext`; helper reusable in OSS-04 |
| 10 | Delete with dependents | `422 foreign_dependency`, details `tasks.<dependentId>.dependsOnTaskIds` / `has_dependents` | No catalogue code fits; task text says reuse, do not add |
| 11 | Delete with attempt | `409 attempt_active` / `409 reconciliation_required` via the shared classifier (T010 decision; `active_attempt` not used) | Frozen catalogue |
| 12 | Events | `delivery_os.task.updated` after commit for create, update and each propagated task; none on delete; no CRUD events; query-index side effect per changed task | Task text + T009/T010 decisions |
| 13 | Command result | `{ taskId, projectId, status, updatedAt, propagatedTaskIds }` | Routes answer `{ id|ok, updatedAt, status }` without a re-read |
| 14 | Undo | None; audit snapshots only | T010 decision |
| 16 | Unknown profile / unreadable baseline content (plan-review F2) | `422 unknown_target_profile`; `422 hash_mismatch` detail `content` / `unreadable_baseline_content` | deterministic error instead of a 500 |
| 15 | `allowedPaths` | `checkAllowedPathsForProfile` with the task's pinned profile → `422 path_not_allowed` | Spec UA-08 |

Addendum after the implementation review: `→ draft|ready` is refused for a task with an accepted result
(`result_awaits_review`) and for `blocked → draft` under a blocked ancestor; unblock propagation runs only on
`→ draft|ready`; the unlocked lookup in `lockTaskForWrite` uses `tx.fork({ keepTransactionContext: true })`.

## What We're NOT Doing

Routes (next task), plan import, attempt/result/review commands, `verified` transitions, i18n files (UI stream),
migrations, new error codes.

## Implementation Approach

One file `commands/tasks.ts`; one new shared helper `lockTaskForWrite` in `commands/shared.ts`; the attempt classifier in
`projects.ts` gains a subject label so tasks reuse it. Inside one `em.transactional`: all loads first (project lock →
task locks → baseline → decisions/evidence), then checks, then mutations; flush at transaction end; side effects and
events after commit.

## Critical Implementation Details

- **State sequencing**: never query after the first scalar mutation (core AGENTS.md). Propagation plans are computed from
  an in-memory copy of the lifecycle list with the new status applied, then written to the locked rows.
- **Unblock**: `planUnblockPropagation` must see the task with its NEW status; `planBlockPropagation` only needs the graph.
- New task id is generated with `randomUUID()` before the graph check so the node can be validated before insert.

## Phase 1: Task commands and tests

### Changes Required:

#### 1. Shared lock helper
**File**: `packages/core/src/modules/delivery_os/commands/shared.ts`
**Intent**: Load a task for write in the agreed lock order and run the optimistic-lock check on the task.
**Contract**: `lockTaskForWrite(tx, ctx, id, scope) → { project, tasks, task }`; unlocked scoped task lookup → project row
lock (archived/foreign → 404) → `lockScopedProjectTasks` → task picked from the locked list; vanished row →
`enforceRecordGoneIsConflict` then `404 not_found (taskId)`; then `enforceCommandOptimisticLockWithGuards` with
`DELIVERY_TASK_RESOURCE_KIND`.

#### 2. Attempt classifier label
**File**: `packages/core/src/modules/delivery_os/commands/projects.ts`
**Intent**: Let task commands reuse `checkProjectArchivable` with task-worded messages; behaviour for projects unchanged.
**Contract**: optional second parameter `subject: 'project' | 'task' = 'project'` affecting only the `error` text.

#### 3. Task commands
**File**: `packages/core/src/modules/delivery_os/commands/tasks.ts` (+ `commands/index.ts` import)
**Intent**: create / update / delete per the decisions table.
**Contract**: ids `delivery_os.tasks.create|update|delete`; create input `{ projectId, source: 'manual', baselineId, title,
description?, acIds, dependsOnTaskIds?, allowedPaths? }`; update input `taskUpdateSchema`; delete input
`{ id } | { body: {id} } | { query: {id} }`; exported pure helpers `countCorrectionRounds(evidence)` and
`checkTaskDeletable(task, liveTasks)`.

#### 4. Tests
**File**: `packages/core/src/modules/delivery_os/commands/__tests__/tasks.test.ts`
**Intent**: cover every case listed in the task plus the safety decisions 5–7.

#### 5. Spec + hand-over notes
**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (changelog line), `context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md`.

### Success Criteria:

#### Automated Verification:
- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/tasks.test.ts --maxWorkers=2` green
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- Scoped typecheck of `@open-mercato/core` reports no error in `delivery_os`
- `yarn generate` runs (command discovery)

#### Manual Verification:
- A human confirms the ready gate and block propagation through the UI once routes and pages exist

## Testing Strategy

Unit tests with the `projects.test.ts` harness; find mocks dispatch on the entity class. Live API evidence comes with the
routes task.

## References

- `context/changes/asd-oss-t011-oss-02-l4c-add-task-commands-with-da/research.md`
- `packages/core/src/modules/delivery_os/commands/projects.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Task commands and tests

#### Automated

- [x] 1.1 tasks.test.ts green
- [x] 1.2 whole delivery_os jest folder green
- [x] 1.3 scoped typecheck clean for delivery_os
- [x] 1.4 yarn generate runs

#### Manual

- [ ] 1.5 Human confirms the ready gate and block propagation through the UI once routes and pages exist
