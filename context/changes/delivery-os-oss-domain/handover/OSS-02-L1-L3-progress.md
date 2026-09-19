# OSS-02 progress note — layers L1–L3 done (T004–T008)

> Pure contracts, data layer and domain rules are in place. **Commands, routes, ACL, events, DI and setup (L4+) are
> not implemented yet**, so the frozen API paths still return 404. Nothing in the master plan was ticked; a human
> accepts Progress rows after seeing the evidence below.

- **Commit:** `<SHA — filled in by the orchestrator after commit>` (T008, on top of `f15db049c`)
- **Contract version:** `DELIVERY_CONTRACT_VERSION = 1` (unchanged by T008; no new error codes, 54 codes)
- **Profile versions:** `react-vite@1`, `open-mercato-module@1`, `wordpress-theme@1` (unchanged)

## What exists

| Layer | Task | Content |
|---|---|---|
| L1a | T004 | `lib/contracts.ts`, `lib/hash.ts` — schemas v1, error catalogue, canonical hash |
| L1b | T005 | `lib/targetProfiles.ts`, `lib/fixtures/**`, `lib/resultAcceptance.ts`, H4 hand-over |
| L2 | T006 | five entities, migration `Migration20260919003425_delivery_os`, `data/validators.ts`, module registration |
| L3a | T007 | `lib/dag.ts`, `lib/taskLifecycle.ts`, `lib/projectStatus.ts`, `lib/traceability.ts` |
| L3b | T008 | `lib/attempts.ts`, `lib/baseline.ts` |

## Evidence towards master-plan Progress 2.1 (rules level only)

Run on 2026-09-19, local runner (no compose `app` container):

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 11 suites, 372 tests passed.
- `yarn workspace @open-mercato/core typecheck` → exit 0, no output.
- `npx eslint` on the four new files → clean.

| Acceptance item of OSS-02 | Rule that decides it | Test |
|---|---|---|
| unknown schema rejected | `parseVersioned` | `contracts.test.ts`, `fixtures.test.ts` |
| cycle / foreign scope rejected | `validateTaskGraph` | `dag.test.ts` |
| one key reserves one attempt | `reserveAttempt` (created / existing / `idempotency_conflict`; replay wins over active, limit and unknown) | `attempts.test.ts` |
| one active attempt, limit 16 without trimming history | `reserveAttempt` | `attempts.test.ts` |
| unknown run never restarts by itself, blocks archive | `reconcileAttempt`, `isArchiveBlocked` | `attempts.test.ts` |
| `completed` never yields `verified` | `reconcileAttempt` → `await_manifest` | `attempts.test.ts` |
| ready needs an approved baseline (both decisions for this hash + version), a render, known ACs and required tests | `checkTaskReadiness` | `baseline.test.ts` |
| a draft edited after approval does not change the baseline | `buildBaselineContent` (deep clone) | `baseline.test.ts` |

Still open for 2.1 / 2.2: stale-update rejection (optimistic locking) and "GET does not mutate" need the L4 commands
and routes; the export test with real decisions comes with them.

## For the L4 commands (next OSS task)

- Parse `task.executionAttempts` with `parseAttemptRegister`, call the reducer under the task row lock, persist
  `result.register`. `reserveAttempt` takes `baseRevision` and derives `baseCommit`; `payload` is the validated
  request body (`{ mode, baseRevision }`), `newAttemptId` a fresh uuid, `now` an ISO string.
- Reserve order in the command: replay check (`outcome: 'existing'` → 200) happens inside the reducer before the
  active/limit checks; task-level checks (`task_not_ready`, `dependency_not_verified`) stay in the command and must run
  **after** an `existing` replay was ruled out.
- `reconcileAttempt` returns `taskEffect`; map it through `canTransition`: `release_task` → `ready` (or
  `changes_requested` after a correction round) with `statusReason: null`, `block_task` → `blocked` /
  `reconciliation_required`, `await_manifest` → run the UA-12 acceptance in the same transaction.
- OSS-04 result acceptance needs its **own** gate (not `checkAttemptOpen`): accept a manifest on active states, and on
  `reconciliation_required` / `cancel_requested` only when `reconciliation.resolution === 'completed'`.
- A cancelled attempt reconciled as `not_started`/`stopped` closes with `outcome: 'cancelled'` (the observation stays in
  `reconciliation.resolution`), so a late manifest answers `attempt_cancelled`.
- `checkTaskReadiness` does not compare the task's baseline with `project.activeBaselineId`; if the command should
  refuse tasks pinned to a superseded baseline, it adds that check itself.
- A `rejected` decision voids the approval of the same `contentHash` whatever `subjectVersion` it names; approvals count
  only for the exact hash + version.
- GET package and claim share `checkAttemptOpen`.
- `checkTaskReadiness` result is the `readiness` field of `TransitionContext`; pass the profile from
  `getTargetProfile(task.targetProfileId, task.targetProfileVersion)`.
- `buildBaselineContent(project.draftSpec)` also returns `openCommentIds`; the UI may warn before approval.

## For UI

- Readiness errors carry **all** reasons in `details[]`; detail codes: `requirements_decision_missing`,
  `design_decision_missing`, `requirements_rejected`, `design_rejected`, `requirements_decision_invalid`,
  `design_decision_invalid`, `missing_render`, `missing_required_tests`,
  `unknown_ac`, `missing_acceptance_criteria`, `target_profile_mismatch`, `baseline_mismatch`, `hash_mismatch`.
