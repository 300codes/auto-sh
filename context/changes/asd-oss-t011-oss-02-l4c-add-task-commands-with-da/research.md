---
date: 2026-09-19T03:45:00+0200
researcher: autodev (Claude)
git_commit: b23615b733b4a4c50983426d0f94b428ef08ee28
branch: dev-mateusz
repository: open-mercato
topic: "How to build delivery_os task commands on the existing command/lib layer"
tags: [research, codebase, delivery_os, commands, dag, task-lifecycle]
status: complete
last_updated: 2026-09-19
last_updated_by: autodev (Claude)
---

# Research: delivery_os task commands (create / update / delete)

## Research Question

How should `delivery_os.tasks.create|update|delete` be built on top of `commands/shared.ts`, `commands/projects.ts`,
`lib/dag.ts`, `lib/taskLifecycle.ts`, `lib/baseline.ts`, `lib/attempts.ts` and the `projects.test.ts` mocking pattern —
which helpers exist, which data must be loaded under which locks, and which catalogue error codes apply?

Scope was tight, so the code was read directly in the main context (no sub-agents; the machine has a hard RAM rule).

## Summary

Everything the commands need already exists as pure helpers; `commands/tasks.ts` is orchestration only:
load under locks (project → project tasks), validate with the lib helpers, mutate last, flush in the transaction,
emit after commit. No new error codes, no contract change, no migration.

## Detailed Findings

### Command layer (`packages/core/src/modules/delivery_os/commands/`)
- `shared.ts`: `resolveDeliveryScope` (tenant from auth, org from auth or selected org with platform scope, else
  `403 forbidden`), `resolveDeliveryEm` (fork), `parseDeliveryInput` (zod → frozen `{error, code, details[]}`),
  `assertDeliveryCheck`, `deliveryHttpError`, `requireScopedProject/Task`, `lockScopedProject`,
  `lockScopedProjectTasks` (PESSIMISTIC_WRITE, ordered by id), `lockProjectForWrite` (row lock, then
  `enforceCommandOptimisticLockWithGuards`, `enforceRecordGoneIsConflict` when the row vanished).
  `notFoundError` is private — a task variant of `lockProjectForWrite` belongs in `shared.ts` next to it.
- `projects.ts`: pattern for `prepare` / `execute` / `captureAfter` / `buildLog`, snapshot + JSON-compare change list,
  `emitCrudSideEffects` with `indexer: { entityType: E.delivery_os.delivery_project }`, event emitted after the write.
  `checkProjectArchivable(tasks)` already classifies attempts: `reconciliation_required` (unknown attempt, status reason,
  unreadable register) wins over `attempt_active` (reserved / claimed / cancel_requested attempt, `executing` task).
  Lock order decided in T010: **project, then tasks**.
- `index.ts` imports `./projects`; add `./tasks`. Command files need `yarn generate` (gitignored output).

### Validators (`data/validators.ts:173-210`)
- `taskCreateSchema` is a discriminated union on `source` (`manual` | `plan_proposal`); it has **no `projectId`** —
  the route `/projects/:id/tasks` supplies it, so the command input is `{ projectId, ...body }`.
- `taskUpdateSchema`: `{ id, title?, description?, acIds?, dependsOnTaskIds?, allowedPaths?, status? }`, self-dependency
  already mapped to `cycle` by `superRefine`. `status` accepts all eight statuses; the user-settable gate is
  `canTransition(..., { source: 'status_update' })` → `409 invalid_transition / not_user_settable` (spec UA-09).

### Domain helpers
- `lib/dag.ts`: `taskGraphCheck(nodes, projectId)` → `cycle` (cycle, self) or `foreign_dependency`
  (details `unknown_dependency`, `other_project`, `other_baseline`). It only reports `other_project` when the foreign
  task is in the node list, so the command must load dependency ids **within the caller's scope** and add them as nodes;
  another tenant's task stays `unknown_dependency` (no existence leak).
- `lib/taskLifecycle.ts`: `canTransition(from, to, ctx)`, `findBlockedAncestors`, `planBlockPropagation`
  (descendants in `draft|ready` → `blocked/dependency_blocked`), `planUnblockPropagation` (descendants blocked with
  `dependency_blocked` and no other root block → `draft`). Note the table allows `executing → ready|blocked` and
  `blocked → draft` even with `statusReason: reconciliation_required`; the command must not let a user status update
  release a live or unknown run, nor wipe that reason.
- `lib/baseline.ts`: `collectReadinessReasons` / `checkTaskReadiness({task, baseline, decisions, profile})`; does not
  compare with `project.activeBaselineId` (T008 note) — the command adds that.
- `lib/targetProfiles.ts`: `getTargetProfile(id, version)`, `checkAllowedPathsForProfile(profile, paths)` → `path_not_allowed`.
- Review evidence payload: `reviewEvidencePayloadSchema.verdict` is `approved | changes_requested` (`data/validators.ts:256`).

### Error codes (catalogue `lib/contracts.ts:22-77`, spec UA-04/08/09)
`foreign_reference` 422 (baseline of another project/scope), `unknown_ac` 422, `cycle` 422, `foreign_dependency` 422,
`path_not_allowed` 422, `baseline_not_approved` / `missing_render` / `missing_required_tests` 422, `invalid_transition` 409,
`attempt_active` / `reconciliation_required` 409, `optimistic_lock_conflict` 409 (platform body), `not_found` 404.
The task text's `active_attempt` is superseded by the T010 decision (`attempt_active`).

### Test pattern (`commands/__tests__/projects.test.ts:1-200`)
Mocks `resolveTranslations`, `findWithDecryption` / `findOneWithDecryption` and `../../events`; an `em` mock whose
`transactional` runs the callback on itself; handlers fetched from `commandRegistry`; `catchHttpError`; lock header via
`OPTIMISTIC_LOCK_HEADER_NAME`. For tasks the find mocks must dispatch on the entity class.

## Code References
- `packages/core/src/modules/delivery_os/commands/shared.ts:131-167` — lock helpers
- `packages/core/src/modules/delivery_os/commands/projects.ts:124-155` — attempt/archive classification
- `packages/core/src/modules/delivery_os/lib/dag.ts:67-124` — graph validation
- `packages/core/src/modules/delivery_os/lib/taskLifecycle.ts:140-210` — transitions and propagation
- `packages/core/src/modules/delivery_os/lib/baseline.ts:214-282` — readiness
- `.ai/specs/2026-09-18-delivery-os-hackathon.md:302-303` — UA-08/UA-09 contract

## Architecture Insights
Locking the project row first serializes every graph edit of a project, so cycle checks cannot race; all reads happen
before the first mutation (core AGENTS.md: no finds between scalar mutation and flush).

## Historical Context
- T010 decisions: error catalogue naming, scope resolution, optimistic lock inside the transaction, no undo, no CRUD events.
- T008/T009 notes: readiness inputs; `verified` must stay server-gated.

## Open Questions
None blocking. Plan import (`source: plan_proposal`) is OSS-03 and stays outside this command.
