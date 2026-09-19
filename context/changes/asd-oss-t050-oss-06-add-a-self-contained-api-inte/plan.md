# TC-DELIVERY-OSS-001 — v1 manual flow on the real database — Implementation Plan

## Overview

Add one self-contained Playwright API spec that drives the frozen v1 delivery_os routes (R1–R22) against the running
local app (:3100) and its Postgres (:5442), proving the SQL-level behaviour the in-memory route tests cannot: tenant/org
scoping filters, the `(project, content_hash)` unique index, the platform optimistic-lock conflict body, JSONB attempt
register writes and the report query. Fix whatever real defect it uncovers.

## Current State Analysis

- 56 delivery_os jest suites run the real route handlers and commands over `api/__tests__/routeTestKit.ts` (in-memory
  store). SQL never executes there.
- Live evidence so far comes from throw-away scripts outside the repo (`handover/smoke/live-h9-manual-flow.ts`,
  `/tmp/t035/live.ts`, `/tmp/t027/live.ts`) — not runnable by CI, not in the integration discovery.
- `packages/core/src/modules/delivery_os/__integration__/` does not exist yet on this branch.
- Integration conventions (`.ai/qa/AGENTS.md`, `.ai/skills/om-integration-tests/SKILL.md`): specs in module
  `__integration__`, helpers from `@open-mercato/core/helpers/integration/*`, fixtures created in the test via API and
  cleaned in `finally`, no seeded-data reliance, `npx playwright test --config .ai/qa/tests/playwright.config.ts <path>`.

## Desired End State

`BASE_URL=http://localhost:3100 npx playwright test --config .ai/qa/tests/playwright.config.ts packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-OSS-001.spec.ts --retries=0`
passes twice in a row, a `count(*)` over all `delivery_*` tables and `attachments` is identical before and after, and
the same run fails when the organisation filter of `findScopedProject` is removed (then restored).

### Key Discoveries:

- Payload shapes for the whole chain are proven in `handover/smoke/live-h9-manual-flow.ts` and `/tmp/t035/live.ts`
  (draft from `lib/fixtures/baseline-content.v1.json`, manifest from `lib/fixtures/builders.ts#buildResultManifest`).
- Lock header `x-om-ext-optimistic-lock-expected-updated-at`; stale → platform `409 optimistic_lock_conflict`.
- Claim is trusted-only (`delivery_os.attempts.claim`, no HTTP route) — `lib/attempts.ts:238-242` sets
  `state: 'claimed', claimedAt, workerRef`.
- Baseline create: `commands/baselines.ts:190-243` — identical content → `200 duplicate:true`; unique violation is
  caught and answered as duplicate.
- Scope filter: `commands/shared.ts:122-135` (`findScopedProject`) and `:137-162`.
- `dbFixtures.ts` gives `withClient` (pg, reads `DATABASE_URL` from `apps/mercato/.env` = the dev server's DB) and
  `createOrganizationInDb`; `authFixtures.ts` gives role/user/ACL helpers.
- The dev stack runs `scripts/watch-packages.mjs`, so a source edit in core is rebuilt into `dist` and picked up by
  `next dev` — the scope-filter mutation proof needs no manual build.

## What We're NOT Doing

- No FLOW F1+ routes (intake/stages) — separate TC-DELIVERY-FLOW-* specs.
- No new shared helper under `packages/core/src/helpers/integration/` (spec-local helpers only).
- No ephemeral environment run (the task mandates the real local stack; the 16 GB rule forbids a second app).
- No UI assertions.

## Implementation Approach

One spec file, four independent `test()`s, each building its own project through a spec-local `seedReadyTask()` helper
and deleting its rows in `finally`:

1. **Manual flow and publication chain** — project → real PNG upload → draft → manual baseline → requirements +
   design decisions → task (AC-001, AC-002) → ready → reserve (201, same-key replay 200 same attemptId, same key
   different body 409 `idempotency_conflict`) → GET package ×2 (identical, no row change) → results (201, replay 200 same
   evidenceId, one evidence row in SQL) → human review approved → task `verified` → R22 row with `evidenceId` for AC →
   R20 deploy consent → unverified deployment evidence → R21 `422 deployment_unverified`.
2. **Foreign organisation and foreign tenant** — org B in the admin tenant (DB org + API role/user + ACL
   `delivery_os.*`) and tenant C (DB tenant + org, user created by superadmin) probe every id of the owner's project
   (project, baseline, task, attempt, evidence) on read and write routes: all `404`, no `403`, no leak; lists hide
   the project; owner rows unchanged (SQL `updated_at`).
3. **Stale lock and baseline uniqueness** — stale project/task header → `409` platform body
   (`code: optimistic_lock_conflict`); sequential identical baseline freeze with the current header → `200
   duplicate:true` same id; two parallel identical freezes → no 5xx, every answer in {201, 200 duplicate same id, 409
   optimistic_lock_conflict} (the row lock + header check run before the identical-content lookup), at most one 201 and
   exactly one row per `(project, content_hash)` in SQL.
4. **Cancel then reconcile a claimed attempt** — reserve, flip the attempt to `claimed` via SQL (documented: claim has
   no HTTP route), cancel → `cancel_requested`/`stop_unconfirmed`, reserve refused `409 attempt_active`, reconcile
   `stopped` → task `ready`, new reservation 201.

Every test calls `test.slow()` (global timeout is 20 s; no per-test timeout override, as TC-CRM-072).

Cleanup: append-only tables have no delete route, so the spec hard-deletes its own rows by project id with `withClient`
(same approach as the existing DB fixtures); attachments/users/roles through the API, orgs/tenant/ACL rows via SQL.

## Phase 1: Write and run the spec

### Overview

Author the spec, run it against :3100, adapt to reality, fix real defects.

### Changes Required:

#### 1. Integration spec

**File**: `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-OSS-001.spec.ts`

**Intent**: Real-DB regression net for the v1 manual flow and the SQL-only negatives listed above.

**Contract**: Uses only public HTTP routes plus `withClient` for count/cleanup/claim-flip; imports fixtures from
`@open-mercato/core/modules/delivery_os/lib/fixtures/*`; no seeded demo record besides the login accounts.

#### 2. Defect fixes (conditional)

**File**: `packages/core/src/modules/delivery_os/**`

**Intent**: Only if the spec reveals a real defect; frozen v1 wire format stays; jest regression next to the code.

### Success Criteria:

#### Automated Verification:

- Spec passes on the local stack: `BASE_URL=http://localhost:3100 npx playwright test --config .ai/qa/tests/playwright.config.ts <spec> --retries=0`
- Spec passes a second consecutive run
- Row counts of `delivery_*` tables and `attachments` identical before/after the runs
- Removing the organisation filter from `findScopedProject` makes the spec fail; restored afterwards (`git diff` clean on shared.ts) — confirm the watcher rebuilt `packages/core/dist/modules/delivery_os/commands/shared.js` before the mutated run and after the restore, then re-run green

#### Manual Verification:

- Human reviews the spec's coverage against Progress row 6.2

---

## Phase 2: Regression and hand-over

### Overview

Prove nothing else broke and record the evidence.

### Changes Required:

#### 1. Hand-over

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-06-polish.md`, `OSS-06-final.md`

**Intent**: Append command, runner, duration and result; update §4 row 6.2 and §6 limitation about in-memory tests.

### Success Criteria:

#### Automated Verification:

- delivery_os jest green: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Scoped typecheck green: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`

#### Manual Verification:

- Human accepts Progress 6.2 / FLOW-08 based on the recorded evidence

## Testing Strategy

The spec itself is the test. Jest regression only for a defect fix.

## References

- `context/changes/delivery-os-oss-domain/handover/smoke/live-h9-manual-flow.ts`
- `context/changes/delivery-os-oss-domain/handover/OSS-05-H26.md`, `OSS-04-L8c-cancel.md`, `OSS-04-L8d-reconcile.md`
- `packages/core/src/modules/customers/__integration__/TC-CRM-072.spec.ts` (DB org + restricted user pattern)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Write and run the spec

#### Automated

- [x] 1.1 Spec passes on the local stack
- [x] 1.2 Spec passes a second consecutive run
- [x] 1.3 Row counts identical before/after the runs
- [x] 1.4 Scope-filter mutation makes the spec fail; restored

#### Manual

- [ ] 1.5 Human reviews the spec's coverage against Progress row 6.2

### Phase 2: Regression and hand-over

#### Automated

- [x] 2.1 delivery_os jest green
- [x] 2.2 Scoped typecheck green
- [x] 2.3 Hand-over sections appended

#### Manual

- [ ] 2.4 Human accepts Progress 6.2 / FLOW-08 based on the recorded evidence
