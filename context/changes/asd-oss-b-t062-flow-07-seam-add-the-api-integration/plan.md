# TC-DELIVERY-FLOW-07-publications Implementation Plan

## Overview

One new Playwright API spec proves the F14 publication seam against Postgres (scoping, the append-only rows, the
transactional derived `deployment` evidence, the flow gate) and the FLOW-08 jest regression is rerun. No production code changes.

## Current State Analysis

- F14 route `api/projects/[id]/publications/route.ts` (POST 201/200 duplicate, GET newest first) and the jest chain test
  `commands/__tests__/publicationChain.test.ts` exist; only in-memory route tests cover them.
- `__integration__/TC-DELIVERY-OSS-001.spec.ts` is the pattern: `caller()` helper, uploaded PNG for the draft, SQL
  teardown by project id incl. `entity_indexes`/`search_tokens`/`action_logs`, foreign tenant via SQL + `createUserFixture` + `setUserAclInDb`.
- Flow gate (`checkProjectFlowGateV1`) guards tasks, decisions and attempts on a pinned project, so all four stages
  must be approved before the baseline/task/attempt/R20 steps; F14 re-checks with `loadFlowGateStates`.

## Desired End State

`TC-DELIVERY-FLOW-07-publications.spec.ts` is discovered by `npx playwright test --list --config .ai/qa/tests/playwright.config.ts`,
typechecks, and (after merge + server restart) runs green. Jest `delivery_os` + `module-decoupling` stay green.

### Key Discoveries

- Publication POST checks the project before reading the body (`publications/route.ts` POST) → foreign POST answers 404.
- Replay is detected before the lock check (`commands/publications.ts` recordPublicationInTransaction) → replay without a lock header answers 200.
- `createFakeDeployAdapter()` (`lib/fixtures/flow/fakes.ts`) gives deterministic PublicationResult v1 bodies; verified only with an evidence id.
- New table `delivery_publications` must join the teardown and the leftover count.

## What We're NOT Doing

- No change to routes/commands/contracts; no run against :3100 (lane A's server) and no second dev server.
- No `TC-DELIVERY-UI-*`/`EXEC-*` edits; no F2 comment-thread scenarios.

## Implementation Approach

Decisions (answered autonomously):
1. Fixtures: `baseline-content.v1.json` read with `readFileSync` + `import.meta.url`; stage artifacts built inline
   (scope from `stage-artifact.scope.v1.json` via `readFileSync`); no JSON-import-attribute modules imported.
2. Publication bodies from `createFakeDeployAdapter()` — the same seam the WP host will call.
3. Revision: `snapshot` base revision (WordPress profile), like the jest chain test.
4. Pinned scenario: approve all four stages → deliver → R20 → re-version Key Visual and approve it → F14 422
   `stage_not_approved` (UI stale) → record UI v2 → still 422 → approve UI v2 → F14 201. This is "before the last approval / after".
5. Foreign tenant: SQL tenant + org, `createUserFixture` + `setUserAclInDb(['delivery_os.*'])`, probes GET/POST → 404 and no leak.
6. Per-test `test.setTimeout(180_000)`; stage-decision Idempotency-Keys carry `randomUUID()`; the replay resends the same body object (fake adapter bodies differ per call).
7. Teardown: SQL by project id (publications, stage rows, evidence, …, action_logs, index tables); `afterAll` asserts zero leftovers.

## Phase 1: Integration spec

### Changes Required

#### 1. New spec
**File**: `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-07-publications.spec.ts`
**Intent**: Two describes (legacy chain + isolation; pinned project gate) per the scenario in the task.
**Contract**: statuses/codes asserted: F14 201/200 duplicate, R21 422 `deployment_unverified` then 201, GET two rows
newest first (`verified` then `unverified`), foreign 404, F14 422 `stage_not_approved`; DB checks: one `deployment`
evidence per new publication, none after a refusal/replay.

### Success Criteria

#### Automated Verification
- Playwright lists the spec without errors
- Scoped typecheck green: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`

#### Manual Verification
- Spec passes against a server running lane B code (after merge + restart)

## Phase 2: FLOW-08 regression

### Success Criteria

#### Automated Verification
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2 --ci` green
- `yarn workspace @open-mercato/core jest src/__tests__/module-decoupling --maxWorkers=2` green

> Addendum (impl review F1): `commands/publications.ts` now assigns `id: randomUUID()` to the publication row; `commands/__tests__/publications.test.ts` stops faking that id. Found while verifying the spec's expected statuses.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. See `references/progress-format.md`.

### Phase 1: Integration spec

#### Automated

- [x] 1.1 Playwright lists the spec without errors
- [x] 1.2 Scoped typecheck green

#### Manual

- [ ] 1.3 Spec passes against a server running lane B code (after merge + restart)

### Phase 2: FLOW-08 regression

#### Automated

- [x] 2.1 jest delivery_os green
- [x] 2.2 jest module-decoupling green
