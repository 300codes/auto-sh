# OSS-02 (L6) In-process Manual End-to-end Flow Test Implementation Plan

## Overview

Add one jest suite, `packages/core/src/modules/delivery_os/api/__tests__/manualFlow.route.test.ts`, that walks the whole
OSS-only manual path through the real route handlers and the real registered commands: create project → edit draft →
manual baseline → requirements + design decisions → manual task → ready → reserve → export package → import result →
project detail. Negative legs prove that `ready`, reserve and export are impossible without both decisions. This is the
BN-01 proof the H10 gate needs ("legal export with real decisions") and the base for the H9 hand-over (next task).

## Current State Analysis

- Every route R2–R16 already has its own route test, but each one **seeds** its preconditions (`makeProject({ activeBaselineId })`,
  `seedReadyTask()` in `api/__tests__/attemptRouteKit.ts:12`), so no test proves the chain end to end or that the
  decision gate is the only way to an exportable package.
- `api/__tests__/routeTestKit.ts` gives an in-memory store behind `findWithDecryption`/`findOneWithDecryption`, an `em`
  whose `create`/`persist` land rows in the store, jest spies for the write methods (`EM_WRITE_METHODS`), a command bus
  that calls the real `commandRegistry` handlers, session/scope/RBAC mocks and `apiRequest`/`expectFrozenError` helpers.
  It already handles projects, baselines, decisions, tasks, evidence and attachments, so no new kit is needed.
- The mock `em` does not run the ORM `onUpdate` hook, so `updatedAt` only changes where a command sets it. The flow must
  therefore always send the version returned by the previous response (`updatedAt`, `projectUpdatedAt`,
  `taskUpdatedAt`), which is exactly what a real client does.
- Gates in code: `commands/tasks.ts:346` (ready → `422 baseline_not_approved` when the task baseline is not
  `project.activeBaselineId`), `commands/attempts.ts:73` (`409 task_not_ready` outside ready/changes_requested),
  `commands/decisions.ts:189` (the only writer of `activeBaselineId`, needs both kinds approved for the hash).
- `lib/projectStatus.ts` derives `draft → awaiting_approval → planning → in_progress` with progress `{proven,total,unit,percent}`.
- The OSS/enterprise import guard already exists: `__tests__/module-registration.test.ts` ("has no module file importing
  enterprise or delivery-cezar code"), scanning every source file under `delivery_os`, which will include the new test.
- The spec coverage table (`.ai/specs/2026-09-18-delivery-os-hackathon.md`, row "OSS-only manual flow") still names a
  planned `commands/__tests__/manualFlow.test.ts`.

## Desired End State

`yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` is green and contains a suite that:
- drives R2, R3, R7, R8 (×2), R10, R12, R14 (×2), R15, R16 (×2) and R5 with the versions each response returned;
- asserts `activeBaselineId` is `null` after the requirements decision and equals the baseline id only after the design
  decision, and that `delivery_os.baseline.approved` was emitted exactly once;
- asserts the package GET leaves every `EM_WRITE_METHODS` spy and `routeState.writes` untouched;
- asserts one evidence row after a `201` + `200 duplicate:true` import, and the project detail status/progress with the
  AC denominator from the baseline;
- proves in separate legs that without both decisions `ready` answers `422 baseline_not_approved`, reserve answers
  `409 task_not_ready`, and no package can be exported (`404 attempt_not_found`, empty attempt register).
`grep -n "activeBaselineId" manualFlow.route.test.ts` shows reads only, never an assignment or seed override.

### Key Discoveries:

- `api/__tests__/decisions.route.test.ts:88` — the second decision needs the `projectUpdatedAt` returned by the first.
- `api/__tests__/attemptRouteKit.ts:23` — `reserve({ lock, key, taskId })` defaults the lock to the seeded
  `UPDATED_AT`; the flow passes the real task version explicitly.
- `api/__tests__/baselines.route.test.ts:44` — attachment rows must exist in `routeState.store.attachments`
  (`draftAttachmentRows`) — the in-process stand-in for `POST /api/attachments` of the attachments module.
- `lib/fixtures/builders.ts` — `buildResultManifest(taskPackage)` builds a valid manifest from the exported package.

## What We're NOT Doing

- No new test kit, no change to existing kits unless the flow uncovers a real gap.
- No OSS-03/04 scope (proposal import, attachment byte hashing, cancel/reconcile, evidence route, report).
- No duplicate enterprise-import test: the existing registration test already covers every file including the new one.
- No H9 hand-over document (next task, together with the OSS-only gate); only a short addendum line in the existing
  OSS-02 progress hand-over.
- No live-server run: T015/T016 already recorded a live transcript of the same chain; this task is the repeatable
  in-process proof.
- No change to shared planning docs under `context/changes/autonomous-software-delivery/`.

## Implementation Approach

One `describe` with a small set of local step helpers (create project, save draft, freeze baseline, decide, create task,
set ready) that call the imported route handlers and return the parsed body; each helper feeds the version from its
response into the next call. The happy path is one `it` because every step depends on the previous one; negative legs
are separate `it`s that reuse the same helpers up to their fork point. Session is the admin wildcard (`ALL_FEATURES`)
because per-feature 403s are already pinned by route-metadata tests. Any defect found is fixed in OSS-owned files only
with a regression assertion in the flow.

## Phase 1: Manual flow suite

### Overview

Write the suite, run it, fix what it uncovers.

### Changes Required:

#### 1. Flow test

**File**: `packages/core/src/modules/delivery_os/api/__tests__/manualFlow.route.test.ts`

**Intent**: Prove BN-01 through the real handlers with real decisions, plus the three negative legs.

**Contract**: Same `jest.mock` preamble as the other route tests (i18n, encryption find, DI container, auth, org scope,
`../../events` with a jest spy). Imports handlers from `../projects/route` (POST, PUT), `../projects/[id]/route` (GET),
`../projects/[id]/baselines/route` (POST), `../baselines/[id]/decisions/route` (POST), `../projects/[id]/tasks/route`
(POST), `../tasks/route` (PUT), plus `reserve`/`getPackage` from `attemptRouteKit` and `buildResultManifest`.
Legs:
- happy path (all steps above, status/progress checkpoints: `draft` after draft save, `awaiting_approval` after baseline
  and after the first decision, `planning` after activation, `in_progress` with `proven 0 / total = baseline AC count`
  at the end);
- requirements-only: ready → `422 baseline_not_approved`, `activeBaselineId` still null, task stays `draft`;
- reserve before ready (after both decisions): `409 task_not_ready`, no attempt appended;
- decisions skipped: ready refused, reserve refused, package for any attempt id → `404 attempt_not_found`, register empty,
  zero decisions and no `baseline.approved` event. Reserve is refused here by the status gate (`409 task_not_ready`)
  because the task can never leave `draft`; the second line of defence (`422 baseline_not_active` for a ready task on a
  non-active baseline) stays covered by `commands/__tests__/attempts.test.ts` and needs a seeded ready task, which this
  suite must not use.

#### 2. Defect fixes (conditional)

**File**: OSS-owned files under `packages/core/src/modules/delivery_os/{commands,lib,api,data}/` only.

**Intent**: Fix any real defect the flow uncovers at its root; record it in the task notes.

**Contract**: Behaviour-preserving for the frozen v1 DTO/error catalogue unless the defect is in it.

### Success Criteria:

#### Automated Verification:

- New suite passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os/api/__tests__/manualFlow.route.test.ts --maxWorkers=2`
- Whole delivery_os scope green: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- `grep -nE "activeBaselineId\s*[:=]" manualFlow.route.test.ts` finds no assignment/seed override (reads via `.toBe`/`toMatchObject` on responses only)
- ESLint clean on the new file: `yarn eslint packages/core/src/modules/delivery_os/api/__tests__/manualFlow.route.test.ts` (run from the repo root so the flat config applies)
- Core typecheck passes (scoped): `yarn workspace @open-mercato/core typecheck` (run once, alone, in the foreground)

#### Manual Verification:

- A human reads the flow test as the BN-01 evidence and accepts Progress 2.3 (co-acceptance 2.4 stays open)

---

## Phase 2: Spec and hand-over sync

### Overview

Point the spec coverage row at the real test and add a short addendum to the OSS-02 progress hand-over.

### Changes Required:

#### 1. Spec coverage table

**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`

**Intent**: Replace the planned `commands/__tests__/manualFlow.test.ts` with `api/__tests__/manualFlow.route.test.ts`
and name the negative legs in the Asserts column.

**Contract**: Row "OSS-only manual flow (enterprise disabled)" of the integration-coverage table.

#### 2. Hand-over addendum

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md`

**Intent**: Append an "Addendum — L6 manual flow (T017)" with the command, result, legs and Progress rows.

**Contract**: Append-only section at the end of the file.

### Success Criteria:

#### Automated Verification:

- `grep -n "manualFlow.route.test.ts" .ai/specs/2026-09-18-delivery-os-hackathon.md` finds the row
- `grep -n "T017" context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md` finds the addendum

## Testing Strategy

### Unit Tests:

- The suite itself is the deliverable; the existing per-route tests stay untouched.

### Integration Tests:

- QA owns TC-DELIVERY-010 (Playwright, OSS-only); this suite is its in-process twin.

### Manual Testing Steps:

1. Read the happy-path `it` top to bottom: each HTTP step, its status and the version hand-off are visible.

## References

- Master plan: `context/changes/autonomous-software-delivery/plan.md` (BN-01, Progress 2.1–2.4)
- Breakdown: L6 row, UA-01…UA-15
- Kits: `api/__tests__/routeTestKit.ts`, `api/__tests__/attemptRouteKit.ts`, `commands/__tests__/baselineTestKit.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Manual flow suite

#### Automated

- [x] 1.1 New suite passes
- [x] 1.2 Whole delivery_os scope green
- [x] 1.3 No activeBaselineId assignment in the test
- [x] 1.4 ESLint clean on the new file
- [x] 1.5 Core typecheck passes (scoped)

#### Manual

- [ ] 1.6 A human reads the flow test as the BN-01 evidence and accepts Progress 2.3

### Phase 2: Spec and hand-over sync

#### Automated

- [x] 2.1 Spec coverage row points at manualFlow.route.test.ts
- [x] 2.2 Hand-over addendum for T017 present
