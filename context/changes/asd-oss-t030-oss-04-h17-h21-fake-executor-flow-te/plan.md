# OSS-04 H17/H21 — fake-executor flow, QA scenarios and hand-over: Implementation Plan

## Overview

This plan proves that the OSS-04 commands work together the way the EXEC bridge will call them. A fake executor
counts its runs and drives the full attempt lifecycle. The three QA scenarios from the workstream become deterministic
tests. The H21 hand-over tells QA, EXEC and UI exactly how to use the result. **No production code changes.**

## Current State Analysis

- All OSS-04 commands exist: `delivery_os.attempts.reserve|claim|link_workflow|mark_delivery|cancel|reconcile`,
  `delivery_os.results.accept`, `delivery_os.evidence.record`, and the read service
  `createDeliveryOsAttemptQueries` (`getAttempt`, `buildTaskPackage`, `listPendingDeliveries`), in
  `packages/core/src/modules/delivery_os/commands/`.
- `commands/__tests__/results.test.ts:339` already has a small bridge test. It starts from an already reserved
  `manual_handoff` attempt, and it does not cover `mark_delivery failed` followed by a replay that signals pending again.
- `reconcile.test.ts:334` covers `unknown` without an executor. `scopeChange.test.ts:378` covers a relabelled
  manifest, but not a result on a task pinned to the new baseline.
- `lib/acProof.ts` `proveAcceptanceCriteria` filters evidence by `baselineId` and exact `sourceRevision`.
- `lib/fixtures/builders.ts` `buildResultManifest(taskPackage)` is the deterministic fake executor output.
- `listPendingDeliveries` is the only recovery scan. It lists only attempts that have
  `completionDelivery = 'pending'` and a result. It never lists anything that should be run again.

## Desired End State

- `commands/__tests__/executorFlow.test.ts` exists and passes. It covers:
  1. **Main flow**, starting from a `ready` task: reserve `automatic` (issueTrustedExecution) → claim →
     link_workflow → the executor builds the manifest from `buildTaskPackage` once → `results.accept` (adapter) →
     `mark_delivery failed` → replay accept (duplicate, `evidence.recorded` again with `completionDelivery: 'pending'`,
     the pending list still contains the attempt) → `mark_delivery delivered` → the pending list is empty.
     Executor calls === 1, exactly one evidence row.
  2. **QA (a)**: a replay of the same manifest does not create new rows or change the status, returns the same
     `evidenceId`, and the executor is not called again. A different manifest on the same attempt answers `409 result_conflict`.
  3. **QA (b)**: after a scope change (v2 active, new task on v2), the executor's manifest built for v1 is sent for the
     v2 attempt. It is rejected with `422 baseline_mismatch`, nothing is written, and `proveAcceptanceCriteria` for v2
     shows `missing`. The v1 result is kept only as v1 evidence.
  4. **QA (c)**: unknown after a restart. The attempt is claimed and has no result. A "restart" (new harness) runs
     the recovery scan (`listPendingDeliveries`), which returns [], and `getAttempt` shows `claimed`. Reconcile
     `unknown` in-process (trusted) blocks the task (`reconciliation_required`). A redelivered job's reserve/claim is
     refused. Executor calls stay at 1.
  5. **Revision inheritance**: evidence of the task commit A proves the AC on A. `proveAcceptanceCriteria` on
     integration revision B returns `missing` with no evidenceId.
- `context/changes/delivery-os-oss-domain/handover/OSS-04-H21.md` has the commit SHAs, the DTO v1 note, what works,
  the test command and its output, the limitations, the Progress rows with evidence, the QA recipes for
  TC-DELIVERY-006/007 with curl bodies, the EXEC/UI patch requests, the demo-app supervision note and the live smoke
  transcript.

### Key Discoveries:

- Automatic reserve needs no `request` and an issued trusted option (`commands/attempts.ts:88`). The new attempt id
  is `randomUUID()`, so the executor must read the package through `buildTaskPackage` with the returned attemptId.
- Reserve needs the requirements+design approvals (`loadCorrectionBudget` / ready gate) and `activeBaselineId === task.baselineId`.
- `results.accept` duplicate path returns `completionDelivery` of the stored attempt (`commands/evidence.ts:186`),
  so after `mark_delivery failed` the replay re-signals `pending` (failed keeps `pending`; see `lib/attempts.ts:272`).
- `claim` by the same `workerRef` on an already claimed attempt returns `changed: false` (`lib/attempts.ts:227`). A bridge
  that runs the CLI whenever claim does not throw would run it again after a restart. The fake bridge therefore runs
  the executor **only when `claim.changed === true`**, and the hand-over states that rule as an EXEC patch request (plan-review F1).
- A redelivered reserve with the same key returns `created: false` (existing) before any gate, even on an unknown
  attempt. The claim then answers `409 reconciliation_required`, so the bridge skips.
- The harness pattern (mocked `findWithDecryption`, in-memory store, `matches`) is copied from `results.test.ts`.

## What We're NOT Doing

- No production code, migration, event, ACL, DI, validator, fixture or contract change.
- No edits in the master plan / Progress, UI, enterprise, QA integration specs or the demo app.
- No real workflow engine or real-DB concurrency test (QA's scope; noted as a limitation).

## Implementation Approach

One new jest file with its own in-memory harness, the same one `results.test.ts` uses. The executor is a
`jest.fn` that calls `queries.buildTaskPackage` + `buildResultManifest`. The "bridge job" helper performs
reserve → claim → link → run → accept and returns 'executed' | 'skipped'. That lets redelivery and restart be
simulated by calling it again. The hand-over is written after the tests pass and the live smoke has run.

## Phase 1: Fake-executor flow and QA scenario tests

### Changes Required:

#### 1. New test file

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/executorFlow.test.ts`

**Intent**: Deterministic proof of the bridge call order and the three QA scenarios plus revision non-inheritance.

**Contract**: Uses only public command ids, `createDeliveryOsAttemptQueries`, `buildResultManifest`,
`proveAcceptanceCriteria`, `issueTrustedExecution` and `baselineTestKit` helpers. Every scenario asserts
`executor.mock.calls.length === 1` where applicable.

### Success Criteria:

#### Automated Verification:

- New flow test passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/executorFlow.test.ts --maxWorkers=2`
- Scoped delivery_os suite green: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Typecheck of core clean for the new file: scoped `tsc -p /tmp/t030/tsconfig.json` (extends core tsconfig, includes only the new test + generated, like T027/T028) — a full core tsc is too heavy for the 16 GB machine

## Phase 2: Live smoke and OSS-04 H21 hand-over

### Changes Required:

#### 1. Live smoke

**Intent**: On :3100 (core built, dev:app restarted), use the HTTP API to exercise cancel (R17), reconcile `unknown` then
`completed` (R18) and evidence R19 (a test row, a duplicate, and a foreign baseline 422). Keep the transcript in `/tmp/t030/live.log`.

#### 2. Hand-over

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-04-H21.md`

**Intent**: The single document QA/EXEC/UI read for OSS-04. It contains the sections listed in the Desired End State.

### Success Criteria:

#### Automated Verification:

- Live smoke script exits 0 and the log shows the expected status codes
- Hand-over file exists with the test output excerpt and the smoke transcript
- `git status` shows only OSS-owned paths and the change folder

#### Manual Verification:

- QA replays TC-DELIVERY-006/007 recipes against a real DB (joint acceptance 4.3–4.5)

## Testing Strategy

Unit-level, deterministic, in-memory store. Real-DB concurrency and the workflow resume are QA/EXEC integration scope.

## References

- `commands/__tests__/results.test.ts:339` (existing bridge block), `reconcile.test.ts`, `scopeChange.test.ts`
- `context/changes/delivery-os-oss-domain/handover/OSS-04-L8a…L8f`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fake-executor flow and QA scenario tests

#### Automated

- [x] 1.1 New flow test passes
- [x] 1.2 Scoped delivery_os suite green
- [x] 1.3 Typecheck of core clean for the new file

### Phase 2: Live smoke and OSS-04 H21 hand-over

#### Automated

- [x] 2.1 Live smoke script exits 0 and the log shows the expected status codes
- [x] 2.2 Hand-over file exists with the test output excerpt and the smoke transcript
- [x] 2.3 git status shows only OSS-owned paths and the change folder

#### Manual

- [ ] 2.4 QA replays TC-DELIVERY-006/007 recipes against a real DB (joint acceptance 4.3–4.5)
