# OSS-06 Final-Commit Regression Suite Implementation Plan

## Overview

Add `packages/core/src/modules/delivery_os/api/__tests__/finalRegression.route.test.ts`: one jest file that drives the
real delivery_os route handlers (over the routeTestKit in-memory store) through the five scenarios master-plan row 6.2
names — cross-tenant, stale approval, duplicate callback, restart/unknown and the OSS-only manual_handoff flow — so the
final commit carries one re-runnable piece of OSS evidence for 6.2 (Playwright coverage stays with QA-06).

## Current State Analysis

Each scenario is already covered somewhere, but spread over per-route tests and command-level tests:
- Cross-scope 404s are asserted per route (`projects.route.test.ts`, `reconcile.route.test.ts`, …), mostly on seeded
  rows, with a single foreign session at a time. The project list (R1) goes through the query engine mock and is only
  checked by call arguments.
- Stale approval: `decisions.route.test.ts:95-105` (lock 409, `subject_hash_mismatch` 409).
- Duplicate callback: `manualFlow.route.test.ts` (evidence count, duplicate true) and `commands/__tests__/executorFlow.test.ts`
  (re-emitted `delivery_os.evidence.recorded` with `completionDelivery: 'pending'`, command level).
- Restart/unknown: `reconcile.route.test.ts` (route) and `executorFlow.test.ts` QA scenario (c) (executor counter, command level).
- OSS-only: `manualFlow.route.test.ts` + `__tests__/module-registration.test.ts:181-200` (FORBIDDEN_IMPORT_PATTERN scan).

There is no `api/__tests__/executorFlow` test; the executor-counter pattern lives in `commands/__tests__/executorFlow.test.ts`.
Flow helpers (createProject → saveDraft → freezeBaseline → decide → createTask → setReady) are duplicated inline in
`manualFlow.route.test.ts` and `commands/__tests__/publicationFlow.test.ts`.

## Desired End State

`yarn workspace @open-mercato/core jest src/modules/delivery_os/api/__tests__/finalRegression.route.test.ts --maxWorkers=2`
passes with five named `describe` blocks, each asserting HTTP status/codes and store row counts; the full delivery_os
suite still passes; the spec's Integration Coverage table lists the file as OSS evidence for 6.2.

### Key Discoveries:

- `routeTestKit.ts` resolves every service per request (`createRequestContainer`), so a "restart" is simply a new
  request — no in-memory worker state survives between calls.
- `routeState.queryEngine.query` is a `jest.fn`; a scope-honouring `mockImplementation` (filter `store.projects` by
  `options.tenantId` and `options.filters.organization_id.$eq`, map to snake_case rows) lets R1 answer a real empty list.
- Decision with an outdated hash → `409 subject_hash_mismatch` (`commands/decisions.ts:85-98`); stale lock → platform
  `409 optimistic_lock_conflict`.
- Automatic mode is rejected publicly (HTTP), so the route-level "executor" is a test counter that runs only when a
  reservation answers `201` with a new attempt; a replayed key answers `200` and must not run it.
- `apps/mercato/src/modules.ts` is plain data (imports only `parseBooleanWithDefault` and the committed
  `official-modules.generated.ts`), so it can be required in `jest.isolateModules` with the `OM_ENABLE_ENTERPRISE_MODULES*`
  env vars unset to assert the OSS-only module list.

## What We're NOT Doing

- No change to production code, routes, contracts, DTO versions or migrations.
- No refactor of existing tests' behaviour; `manualFlow.route.test.ts` and `publicationFlow.test.ts` keep their inline helpers.
- No Playwright/TC-DELIVERY specs (QA-owned), no edits to master-plan Progress.
- No live smoke against :3100 (this task is an in-process regression gate; earlier tasks already smoked the live routes).

## Implementation Approach

Extract two small shared test helpers, then write the suite:
1. `api/__tests__/flowHelpers.ts` — route-driven flow helpers (project, draft, baseline, decisions, task, ready,
   reserve, package, result import, readProject) and a scope-honouring project-list query engine; used only by the new file.
2. `__tests__/enterpriseBoundary.ts` — move `FORBIDDEN_IMPORT_PATTERN` and `listSourceFiles` out of
   `module-registration.test.ts` (which then imports them — identical assertions) so the new suite reuses the exact
   decoupling assertion.
3. `finalRegression.route.test.ts` — five describes:
   - **cross-tenant**: build a full flow in tenant A/org A (result imported, evidence recorded), then for each of
     tenant B/org A, tenant A/org B, tenant B/org B: R1 empty, R5/R6/R9/R11 404, R3/R4/R12/R13 404, R7/R8/R10 404,
     R14/R15/R16 404, R19 404, R20/R21 404, R22 404; store row counts unchanged. Tenant/org sent in a create body and
     inside a manifest are ignored (row scoped to the session; import accepted under the session scope).
   - **stale approval**: stale lock header → 409 `optimistic_lock_conflict`; outdated `subjectHash` → 409
     `subject_hash_mismatch`; decisions row count unchanged; `activeBaselineId` still null.
   - **duplicate callback** (workflow-linked attempt, see Critical Implementation Details): same manifest twice → 201 then 200 `duplicate: true`, one evidence row, two
     `delivery_os.evidence.recorded` emits, second `duplicate: true, completionDelivery: 'pending'`; changed manifest → 409 `result_conflict`.
   - **restart**: executor counter increments only on 201 reservations; reconcile `unknown` → task blocked; fresh key
     → 409 `reconciliation_required`, task and project archive → 409; replay of the old key does not run the executor; counter stays 1; attempts length 1.
   - **manual_handoff**: `modules.ts` with enterprise env unset contains `delivery_os` from core and no
     `@open-mercato/enterprise` entry; delivery_os source has no forbidden import; the manual flow reaches evidence
     and project `in_progress` with progress counters, all via routes.
4. Add the file to the spec Integration Coverage table (new row "Final-commit regression (row 6.2)") and a changelog line.

## Critical Implementation Details

- **Duplicate event payload** (plan-review F1): `completionDelivery` is `'pending'` only for a workflow-linked attempt
  (`lib/attempts.ts:399`); a manual_handoff attempt emits `null`. Scenario 3 therefore reserves in `automatic` mode, claims and
  links the workflow through the registered commands with `issueTrustedExecution` (exactly what the EXEC bridge does —
  HTTP cannot), then posts the same manifest twice through the HTTP results route R16. `emitDeliveryOsEvent` is mocked;
  the payload is its 2nd argument.
- **OSS-only module list** (plan-review F2): if requiring `apps/mercato/src/modules.ts` fails to transform from core jest,
  fall back to a text assertion over the same file and note it in the hand-over.
- `jest.mock` of `../../events` must precede imports, as in the other route tests.

## Phase 1: Shared helpers

### Changes Required:

#### 1. Flow helpers
**File**: `packages/core/src/modules/delivery_os/api/__tests__/flowHelpers.ts`
**Intent**: Route-driven helpers for the manual flow and a scope-honouring R1 query engine implementation.
**Contract**: exports `createProject`, `saveDraft`, `readProject`, `freezeBaseline`, `decide`, `createTask`, `setReady`,
`prepareReadyTask` (returns `{ projectId, baselineId, contentHash, version, taskId, taskUpdatedAt }`), `reserveOn`,
`exportPackageOn`, `importResult`, `useScopedProjectList()`.

#### 2. Enterprise boundary helper
**File**: `packages/core/src/modules/delivery_os/__tests__/enterpriseBoundary.ts` (+ import in `module-registration.test.ts`)
**Intent**: Single source of the decoupling assertion.
**Contract**: exports `FORBIDDEN_IMPORT_PATTERN`, `listSourceFiles`, `findEnterpriseImports(root)`.

### Success Criteria:

#### Automated Verification:
- module-registration test still passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os/__tests__/module-registration.test.ts --maxWorkers=2`

## Phase 2: Regression suite and spec row

### Changes Required:

#### 1. Suite
**File**: `packages/core/src/modules/delivery_os/api/__tests__/finalRegression.route.test.ts`
**Intent**: The five describes above, ≤ ~400 lines.

#### 2. Spec
**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`
**Intent**: Integration Coverage row + changelog entry naming the file as OSS evidence for 6.2.

### Success Criteria:

#### Automated Verification:
- New suite passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os/api/__tests__/finalRegression.route.test.ts --maxWorkers=2`
- Full delivery_os suite passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Core typecheck of touched files passes: `yarn workspace @open-mercato/core tsc --noEmit -p .` (or the package typecheck script)

#### Manual Verification:
- A human accepts master-plan rows 6.2/6.3 together with QA-06 Playwright evidence

## Testing Strategy

Route-level only (the suite itself is the test). Failure paths are the point: 404 across scope, 409 stale, 409 conflict, 409 reconciliation_required.

## References

- `packages/core/src/modules/delivery_os/api/__tests__/{routeTestKit,attemptRouteKit,manualFlow.route.test,reconcile.route.test}.ts`
- `packages/core/src/modules/delivery_os/commands/__tests__/{executorFlow,publicationFlow}.test.ts`
- Master plan `context/changes/autonomous-software-delivery/plan.md:613-614`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared helpers

#### Automated

- [x] 1.1 module-registration test still passes

### Phase 2: Regression suite and spec row

#### Automated

- [x] 2.1 New suite passes
- [x] 2.2 Full delivery_os suite passes
- [x] 2.3 Core typecheck of touched files passes

#### Manual

- [ ] 2.4 A human accepts master-plan rows 6.2/6.3 together with QA-06 Playwright evidence
