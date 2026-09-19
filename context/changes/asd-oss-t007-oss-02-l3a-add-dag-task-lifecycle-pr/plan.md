# OSS-02 (L3a): DAG, task lifecycle, project status and basic traceability — Implementation Plan

## Overview

Add the deterministic "system decides" rules for tasks and projects as pure functions in
`packages/core/src/modules/delivery_os/lib/`. The L4 commands (task create/update, attempts, results, review
evidence) and the L5 routes will call them; the UI reads their output (status, progress, traceability rows).
No I/O, no MikroORM, no DI, no enterprise, no other-module imports.

## Current State Analysis

- `lib/contracts.ts` holds the v1 schemas, `deliveryErrorCodes` (53 codes), `buildDeliveryError`,
  `DeliveryCheckResult`, `isSameRevision`, `SourceRevision`, `DeliveryEvidenceKind`.
- `lib/dag.ts` already exports `findDependencyCycle(nodes)` (iterative DFS, returns the cycle path, self-loop →
  `['A','A']`) and `checkAcyclic(nodes)`; both are used by `lib/__tests__/{targetProfiles,fixtures}.test.ts`.
  They stay unchanged; the new task-graph API is layered on top.
- `lib/targetProfiles.ts#countsAsAcEvidence(kind)` — only `result_manifest`, `test`, `review` count.
- `data/validators.ts` defines `taskStatusSchema`, `TaskStatus` and `USER_SETTABLE_TASK_STATUSES`
  (`draft ready blocked cancelled`). It imports `@open-mercato/shared/lib/boolean`, so lib modules should not import
  it; the status enum moves to `contracts.ts` and validators re-export it (same public exports).
- Frozen spec `.ai/specs/2026-09-18-delivery-os-hackathon.md`: task statuses and `status_reason`
  (`reconciliation_required`, `dependency_blocked`); UA-09 (only user-settable statuses via R12, `verified` through
  R12 → `409 invalid_transition`); UA-13 (review `changes_requested` → `changes_requested`, after
  `limits.maxCorrectionRounds` → `blocked`; review `approved` → `verified` only with an accepted result on the pinned
  baseline and every task AC proven on the result revision, else `422 missing_required_tests`); UA-19 (reconcile
  `not_started/stopped` → `ready` or `changes_requested`, `unknown` → `blocked/reconciliation_required`,
  `completed` → `awaiting_review`, never `verified`); ProjectDetail `progress { proven, total, unit }`,
  DeliveryReport `progress { proven, total, unit: 'ac' }`.
- Master plan "Lifecycle i reguły awarii": `draft → ready → executing → awaiting_review → changes_requested →
  executing → verified`, plus `blocked`, `cancelled`; `verified` needs evidence for the current baseline and
  sourceRevision; max two correction rounds then explicit escalation; a block stops the task and its descendants,
  independent tasks continue; the graph rejects a cycle and a foreign-project dependency; unknown process state →
  `blocked/reconciliation_required`, checked before retry; percent only with an explicit denominator.

## Desired End State

Four modules with typed, deterministic outputs and paired positive/negative unit tests:

- `dag.ts`: `validateTaskGraph(tasks, projectId)` → typed problems; `taskGraphCheck(...)` → `DeliveryCheckResult`;
  `descendantsOf(taskId, tasks)`.
- `taskLifecycle.ts`: `TASK_TRANSITIONS`, `canTransition(from, to, context)`, `changesRequestedOutcome`,
  `planBlockPropagation`, `planUnblockPropagation`.
- `projectStatus.ts`: `deriveProjectStatus(input)` → `{ status, progress: { proven, total, unit: 'ac', percent },
  taskCounts, attention }`.
- `traceability.ts`: `buildTraceability(input)` → `{ rows, totalRows, truncated, issues }`.

Verify: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` green, core typecheck
clean, `grep` shows no forbidden imports.

### Key Discoveries:

- `lib/dag.ts:5` — `findDependencyCycle` returns the first cycle path; reuse it (self-dependencies are reported
  separately and removed before cycle detection).
- `lib/contracts.ts:96` — `buildDeliveryError(code, error, details)`; all helpers return `DeliveryCheckResult`.
- `lib/contracts.ts#isSameRevision` compares git SHA or snapshot hash+workspace.
- `lib/targetProfiles.ts:184` — `countsAsAcEvidence`.
- `lib/__tests__/contracts.test.ts:651` — pins the full error catalogue; adding a code updates that expectation.

## What We're NOT Doing

- No commands, routes, events, DB access (L4/L5).
- No baseline readiness check (`baseline_not_approved`, `missing_render`, `missing_required_tests` for `ready`):
  that is `lib/baseline.ts` (next L3 task). `canTransition(→ ready)` only consumes its result via
  `context.readiness`.
- No per-check AC proof (`passed/failed/not_run/missing/manual_pending`) — that is `deliveryReport.ts` (OSS-05). The
  verified gate consumes the caller-computed `unprovenAcIds`.
- No deploy decisions logic beyond "release applies to the latest result revision" in project status.
- No change to `findDependencyCycle`/`checkAcyclic`, fixtures, entities or migrations.

## Implementation Approach

Pure functions over minimal structural input types (`Pick`-like shapes with plain ids), so commands can pass
entity rows and tests can pass literals. Every rule failure maps to a catalogue code through `buildDeliveryError`,
with `details[]` carrying the precise sub-reason. Fail closed: when a gate's input is absent, the transition is
rejected, never allowed by default.

Decisions (self-answered planning questions, autonomous mode):

1. **Status enum location** — move `taskStatusSchema`/`TaskStatus`/`USER_SETTABLE_TASK_STATUSES` to
   `contracts.ts`, re-export from `validators.ts` (public exports unchanged; lib stays free of `shared` imports).
2. **Escalation code** — add `correction_limit_reached: 409` to `deliveryErrorCodes` (additive v1 change, allowed
   by R3), spec table + changelog updated. A top-level code lets the UI show "escalate to a human" distinctly.
3. **Correction counting** — the context carries `correction: { started, max }` (`started` = number of
   `changes_requested → executing` transitions already made; `max` = `project.limits.maxCorrectionRounds`). The
   command derives `started`; missing context → rejected. `changes_requested → executing` with `started >= max` →
   `correction_limit_reached`; `awaiting_review → changes_requested` with `started >= max` is also rejected and
   `changesRequestedOutcome` tells the review command to move to `blocked/correction_limit_reached` instead (spec
   UA-13).
4. **Transition table** (identity = no-op allowed; `verified`, `cancelled` terminal):
   - `draft → ready | blocked | cancelled`
   - `ready → draft | executing | blocked | cancelled`
   - `executing → awaiting_review | ready | changes_requested | blocked` (no `cancelled`: cancel the attempt and
     reconcile first — plan: active attempt blocks removal)
   - `awaiting_review → changes_requested | verified | blocked | cancelled`
   - `changes_requested → executing | blocked | cancelled`
   - `blocked → draft | ready | changes_requested | cancelled`
5. **Gates in `canTransition`** (order): unknown table edge → `invalid_transition`; `source: 'status_update'` with a
   non-user-settable target → `invalid_transition`; `statusReason = reconciliation_required` and target
   `ready | executing | changes_requested` → `reconciliation_required`; `statusReason = correction_limit_reached`
   and target other than `cancelled` → `correction_limit_reached`; `statusReason = dependency_blocked` with
   `context.blockedAncestorIds` non-empty and target `draft | ready` → `invalid_transition` (detail
   `dependency_blocked`); `→ ready` requires `context.readiness.ok` (absent → `invalid_transition`, detail
   `readiness_not_checked`; failed → returned as is); correction rules (decision 3); `→ verified` requires
   `context.verification` (below). `context.statusReason` is the reason that will remain on the task after the
   calling command's own state change (e.g. the reconcile command passes `null` once it resolved the attempt as
   `not_started`/`stopped`), so the gate never blocks the command that clears it.
6. **Verified gate** — `verification: { taskBaselineId, resultRevision, evidence[{ id, kind, baselineId,
   sourceRevision }], unprovenAcIds }`. Only `countsAsAcEvidence` kinds count. No counting evidence at all →
   `missing_required_tests`; counting evidence exists but none for `taskBaselineId` → `baseline_mismatch`; none
   for that baseline on `resultRevision` → `missing_required_tests` (detail `revision_mismatch`);
   `unprovenAcIds` non-empty → `missing_required_tests` (details per AC).
7. **Block propagation** — `planBlockPropagation(taskId, tasks)` returns `{ taskId, from, to: 'blocked',
   statusReason: 'dependency_blocked' }` for each descendant that is not already blocked and whose status allows
   `→ blocked` in the table (terminal and executing descendants untouched); independent tasks never appear.
   `planUnblockPropagation(taskId, tasks)` returns descendants with reason `dependency_blocked` and no other
   blocked ancestor → `draft` (the ready gate must be re-checked by the operator; safe default).
8. **Graph problems** — `self_dependency` (maps to `cycle`), `cycle` with path, `unknown_dependency` and
   `foreign_dependency` (`reason: 'other_project' | 'other_baseline'`; both map to `foreign_dependency`, unknown
   never reveals whether an id exists elsewhere). Baseline comparison only when both nodes carry `baselineId`
   (spec: same project and baseline).
9. **Project status** — precedence: `archived` (deletedAt) → `draft` (no baseline) → `awaiting_approval` (no
   active baseline) → `planning` (no non-cancelled task on the active baseline) → `in_progress` (a non-cancelled
   task not verified) → `coverage_gap` (all tasks done, some AC unproven) → `released` (latest release decision
   approved and its revision equals the latest `result_manifest` revision on the active baseline) → `verified`.
   Progress `{ proven, total, unit: 'ac', percent }`: `total` = AC count of the active baseline; an AC is proven
   when at least one non-cancelled task on the active baseline covers it and all such tasks are verified;
   `percent = null` when `total = 0`, else `Math.floor(proven * 100 / total)`. Archived projects keep computing
   (readable reports). Tasks on other baselines never count. An `activeBaselineId` absent from `baselines` is
   treated as no active baseline (`awaiting_approval`, progress `0/0`), never guessed. `attention` lists blocked and
   reconciliation-required task ids.
10. **Traceability** — input one project + baseline; rows `{ requirementId, acId, taskId, taskStatus, evidenceId,
    evidenceKind, countsAsAcEvidence, sourceRevision, rawReportHash }` ordered baseline requirements → their AC →
    tasks (input order) → evidence (input order); requirement without AC and AC without tasks and task without
    evidence produce rows with nulls. Records of another project/baseline are excluded. A task AC id not in the
    baseline yields an `unknown_ac` issue AND a row with `requirementId: null`. `limit` is clamped to
    `1..MAX_TRACEABILITY_ROWS (1000)`; `truncated = totalRows > limit`.

### Implementation review addendum (2026-09-19)

Applied after `reviews/impl-review.md`: the table gains `blocked → awaiting_review` (UA-19 `completed` after an
`unknown`); an unchanged status is a no-op checked first (R12 forms may resend the current status); the correction
budget is `{ requested, max }` where `requested` counts recorded `changes_requested` review verdicts (append-only) and
is checked on every `→ executing` (`requested > max` rejects) and on `awaiting_review → changes_requested`
(`requested >= max` rejects), malformed numbers fail closed; `blocked/correction_limit_reached` may still move to
`blocked`; `→ ready` is refused while any ancestor is blocked regardless of the task's own reason; propagation only
touches `draft`/`ready` descendants; project status treats unparseable dates as oldest and lets a same-instant
rejection win; traceability counts rows beyond the limit without materialising them.

## Phase 1: Contract additions, DAG and task lifecycle

### Overview

Move the status enum, add the escalation code, add task-graph validation and the lifecycle rules with tests.

### Changes Required:

#### 1. Contracts

**File**: `packages/core/src/modules/delivery_os/lib/contracts.ts`, `data/validators.ts`,
`lib/__tests__/contracts.test.ts`, `.ai/specs/2026-09-18-delivery-os-hackathon.md`

**Intent**: Make the task status vocabulary available to pure lib code and add the escalation code.

**Contract**: `contracts.ts` exports `taskStatusSchema`, `TaskStatus`, `USER_SETTABLE_TASK_STATUSES`,
`TASK_STATUS_REASONS` (`reconciliation_required`, `dependency_blocked`, `correction_limit_reached`) and
`deliveryErrorCodes.correction_limit_reached = 409`; `validators.ts` re-exports the three status exports
unchanged. Spec error table + changelog entry.

#### 2. DAG

**File**: `packages/core/src/modules/delivery_os/lib/dag.ts`, `lib/__tests__/dag.test.ts`

**Intent**: Validate a project's task graph and compute descendants for block propagation.

**Contract**: `TaskGraphNode = { id, projectId, baselineId?, dependsOnTaskIds }`; `TaskGraphProblem` union
(`self_dependency`, `cycle {path}`, `unknown_dependency`, `foreign_dependency {reason}`);
`validateTaskGraph(tasks, projectId): TaskGraphProblem[]`; `taskGraphCheck(tasks, projectId): DeliveryCheckResult`;
`descendantsOf(taskId, tasks): string[]` (transitive dependents, cycle-safe, excludes the task itself).

#### 3. Task lifecycle

**File**: `packages/core/src/modules/delivery_os/lib/taskLifecycle.ts`, `lib/__tests__/taskLifecycle.test.ts`

**Intent**: One transition table and gate function used by every status-changing command.

**Contract**: `TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]>`; `TransitionContext = { source:
'status_update' | 'command', statusReason?, readiness?, correction?, verification?, blockedAncestorIds? }`;
`canTransition(from, to, context): DeliveryCheckResult`; `changesRequestedOutcome(correction)`;
`planBlockPropagation(taskId, tasks)`, `planUnblockPropagation(taskId, tasks)` (tasks carry `status`,
`statusReason`). Rules per decisions 4–7.

### Success Criteria:

#### Automated Verification:

- DAG and lifecycle tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2`
- Contracts catalogue test updated and passing (same command)

---

## Phase 2: Project status and traceability

### Overview

Derived project status/progress and the basic traceability projection.

### Changes Required:

#### 1. Project status

**File**: `packages/core/src/modules/delivery_os/lib/projectStatus.ts`, `lib/__tests__/projectStatus.test.ts`

**Intent**: Compute project status and AC progress from plain records, never storing or inventing numbers.

**Contract**: `deriveProjectStatus({ project: { deletedAt, activeBaselineId }, baselines: [{ id, acIds }], tasks:
[{ id, baselineId, status, statusReason, acIds, deletedAt? }], evidence: [{ id, kind, baselineId, sourceRevision,
createdAt }], decisions: [{ kind, verdict, sourceRevision, decidedAt }] })` → `{ status, progress, taskCounts,
attention }` per decision 9. Archived tasks (`deletedAt`) are ignored.

#### 2. Traceability

**File**: `packages/core/src/modules/delivery_os/lib/traceability.ts`, `lib/__tests__/traceability.test.ts`

**Intent**: Build the requirement → AC → task → evidence batch for one project and baseline.

**Contract**: `buildTraceability({ projectId, baseline: { id, projectId, requirements, acceptanceCriteria }, tasks,
evidence, limit })` → `{ rows, totalRows, truncated, issues }`; `MAX_TRACEABILITY_ROWS = 1000`; per decision 10.

### Success Criteria:

#### Automated Verification:

- Status and traceability tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2`
- Core typecheck clean: `yarn workspace @open-mercato/core typecheck`
- No forbidden imports in the four modules: `grep -hn "^import\|from '" lib/{dag,taskLifecycle,projectStatus,traceability}.ts` lists only `./contracts`, `./targetProfiles`, `./dag`

---

## Testing Strategy

### Unit Tests:

Expectations come from the master-plan rules, each negative paired with a positive:
- DAG: 2-node and 3-node cycles (path reported) vs a diamond (valid); self-dependency; foreign project and other
  baseline vs same project; unknown id; descendants of a middle node exclude ancestors and independent tasks; cycle
  safety.
- Lifecycle: the full happy path; every illegal pair (sampled from the complement of the table, all of them);
  `verified` via `status_update` rejected; verified without evidence / other baseline / other revision / unproven AC
  rejected vs a proven case; reference_material does not count; third correction start rejected with
  `correction_limit_reached` vs second allowed; `reconciliation_required` blocks ready/executing vs cancel allowed;
  `ready` needs readiness; propagation touches descendants only.
- Project status: each status in precedence; `total = 0` → `percent: null`; archived; cancelled/other-baseline
  tasks don't prove; release voided by a newer result revision.
- Traceability: full chain rows; unknown AC reported and kept; truncation with `totalRows`; foreign records
  excluded; limit clamping.

### Manual Testing Steps:

None — pure functions; UI/route acceptance happens in L4/L5 and with QA.

## Performance Considerations

Demo budget is ≤ 8 AC and ≤ 6 tasks; all functions are linear or O(V+E) over the inputs; traceability is bounded by
`MAX_TRACEABILITY_ROWS`.

## Migration Notes

No DB change. Additive contract change: new error code `correction_limit_reached` (UI needs i18n key
`delivery_os.errors.correction_limit_reached`).

## References

- Master plan: `context/changes/autonomous-software-delivery/plan.md` → "Lifecycle i reguły awarii"
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` → UA-08/09/13/19/20, error catalogue
- Existing: `packages/core/src/modules/delivery_os/lib/dag.ts:5`, `lib/contracts.ts`, `lib/targetProfiles.ts:184`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract additions, DAG and task lifecycle

#### Automated

- [x] 1.1 DAG and lifecycle tests pass
- [x] 1.2 Contracts catalogue test updated and passing

### Phase 2: Project status and traceability

#### Automated

- [x] 2.1 Status and traceability tests pass
- [x] 2.2 Core typecheck clean
- [x] 2.3 No forbidden imports in the four modules
