# OSS-05 (H26): publication chain proof and hand-over — Implementation Plan

## Overview

OSS-05 delivered the report (R22), deploy consent (R20) and release (R21) in four slices (L9a–L9d), each with its own
unit/route tests on seeded rows. Nothing yet proves the *chain* a real user walks: from a manual baseline through an
accepted result, scan and deployment evidence to a release, and that a new revision voids the old consent. This task
adds that proof, runs it live on :3100 and writes the H26 hand-over for UI-05 and QA-05.

## Current State Analysis

- Route handlers exist for every step: projects, baselines, baseline decisions, tasks, attempts (reserve), package,
  results, evidence (`api/projects/[id]/evidence`), report, deploy-decisions, release-decisions.
- `api/__tests__/routeTestKit.ts` gives an in-memory store behind the real routes and the real command bus;
  `manualFlow.route.test.ts` already drives project → baseline → decisions → ready → reserve → package → result.
- The fake executor (`lib/fixtures/builders.ts#buildResultManifest`) derives the result revision from the attemptId,
  so a second attempt yields a second git revision (B). A task goes back to reservable through an agent review
  `changes_requested` (`RESERVABLE_STATUSES = ['ready','changes_requested']`).
- Report gates (`lib/deliveryReport.ts#buildGates`): manual_pending AC, missing deploy decision and unverified
  deployment are release-only blockers; AC/scan/revision blockers block both gates.
- Deployment verification: a deployment row is `verified` only when it carries `verification.status = verified` of
  the same buildId; the report uses the newest deployment row on the revision.

## Desired End State

- `packages/core/src/modules/delivery_os/commands/__tests__/publicationFlow.test.ts` passes in the scoped jest run
  and drives only real route handlers (and through them real commands) for the full chain, including the revision
  change voiding old decisions and a manual_pending AC blocking release until a human review.
- `/tmp/t035/live.ts` runs against http://localhost:3100 and prints status codes per step; the output is recorded in
  the hand-over. It deletes its own rows by project id.
- `context/changes/delivery-os-oss-domain/handover/OSS-05-H26.md` exists; spec changelog has an H26 entry.

### Key Discoveries:

- `api/__tests__/releaseDecision.route.test.ts` seeds rows directly; the new test must create them via routes.
- Live requests need the `x-om-optimistic-lock`-style header from `OPTIMISTIC_LOCK_HEADER_NAME` with the project
  `updatedAt` for R20/R21 (428 otherwise).
- `ctx.auth.sub` must be a signed-in user for human reviews of manual checks (403 otherwise).

## What We're NOT Doing

- No change to domain code, contracts (DTO v1), routes, migrations or UI/i18n files.
- No real preview target: deployment evidence is fixture-shaped (url on example.test), verification is posted as
  evidence by the caller.
- No edits to the master plan or its Progress; manual acceptance rows remain for humans.
- No integration Playwright spec (QA owns `TC-DELIVERY-*`); only curl recipes in the hand-over.

## Implementation Approach

Self-answered planning questions (autonomous mode, recommended options):
1. Test level → route handlers over the routeTestKit store (same as manualFlow), so the proof covers parsing, scope,
   locks and commands together. (Recommended; direct command calls would skip the HTTP contract UI-05 uses.)
2. Revision B → second attempt on the same task after an agent `changes_requested` review (the real correction
   loop), not a seeded row.
3. Manual check → task covers AC-001..AC-003; AC-003 is manual (MC-visual-001); the report stays release-blocked
   (`manual_pending`) until a human review with `manualCheckId` is posted on the revision.
4. Unverified → verified deployment → two deployment evidence rows (the second with verification of the same
   buildId); release on the unverified row is 422 `deployment_unverified`, on the verified row 201.
5. Negative checks inside the flow: release before deploy consent refused (`deploy_decision_missing`). Revision B's
   result reports the required `dependency-audit` scan check as `skipped` (manifest checks count as scan evidence in
   `buildScans`, so an all-passed B would be publishable): the report on B then has both gates blocked, old A
   decisions `appliesToRevision:false`, deploy consent on B is 422 `report_not_green`; after a passed scan evidence on
   B and a verified deployment on B, release on B is 422 `revision_mismatch` (consent only on A) until a new deploy
   consent on B, and the manual check must be re-verified on B.
6. Live smoke → tsx script with fetch, same steps via HTTP, hard-deletes its own rows by project id; output pasted in hand-over.
7. Hand-over → one file, tables and curl recipes; SHA = HEAD at writing time (the task commit lands later).

## Phase 1: Publication flow test

### Changes Required:

#### 1. Flow test

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/publicationFlow.test.ts`

**Intent**: One describe with the happy chain and its failure points, plus one case for the manual_pending gate,
using `routeTestKit` mocks (paths `../../api/__tests__/routeTestKit`).

**Contract**: Uses only exported route handlers (`POST/PUT/GET`) and kit helpers; asserts DeliveryReport v1 schema
on every report response; asserts `appliesToRevision:false` for old deploy/release decisions on B and both gates
blocked on B.

### Success Criteria:

#### Automated Verification:

- Scoped jest run passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Core typecheck passes: `yarn workspace @open-mercato/core typecheck` (run alone, after jest, never in parallel)

---

## Phase 2: Live smoke and hand-over

### Changes Required:

#### 1. Live smoke script (outside repo)

**File**: `/tmp/t035/live.ts`

**Intent**: Log in, create project/baseline/decisions/task, reserve, fetch package, post result, scan, R22, R20,
deployment (unverified, verified), R21 (422 then 201), second revision via review + reserve + result, R22 on B,
R21 on B refused, new consent, R21 on B 201; print status per step; delete its rows with SQL through
`docker exec omhack-postgres psql` (evidence/decisions are append-only; the CRUD DELETE only soft-deletes the project),
as `/tmp/t032/live.ts` did.

#### 2. Hand-over and spec changelog

**Files**: `context/changes/delivery-os-oss-domain/handover/OSS-05-H26.md`, `.ai/specs/2026-09-18-delivery-os-hackathon.md`

**Intent**: Commit table L9a–L9d, DTO notes, R20/R21 table, QA-05 curl recipes for TC-DELIVERY-009, limitations,
Progress 5.1/5.4 evidence, i18n key request for UI; changelog entry.

### Success Criteria:

#### Automated Verification:

- Live smoke exits 0 with the expected status codes
- Hand-over file exists and `git status` shows no change under `context/changes/autonomous-software-delivery/`

#### Manual Verification:

- A human confirms 5.4 (release acceptance) on the demo instance

## Testing Strategy

Route-level flow test is the unit of proof; live smoke confirms the same chain against Postgres.

## References

- `packages/core/src/modules/delivery_os/api/__tests__/manualFlow.route.test.ts`
- `packages/core/src/modules/delivery_os/api/__tests__/releaseDecision.route.test.ts`
- `context/changes/delivery-os-oss-domain/handover/OSS-05-L9{a,b,c,d}-*.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Publication flow test

#### Automated

- [x] 1.1 Scoped jest run passes
- [x] 1.2 Core typecheck of the new file passes

### Phase 2: Live smoke and hand-over

#### Automated

- [x] 2.1 Live smoke exits 0 with the expected status codes
- [x] 2.2 Hand-over file exists and no master-plan file is modified

#### Manual

- [ ] 2.3 A human confirms 5.4 (release acceptance) on the demo instance
