# OSS-02 (L5b): attempts, package and results routes + `deliveryOsAttemptQueries` — Implementation Plan

## Overview

Expose the last three manual-flow routes of the frozen spec (R14 reserve attempt, R15 export TaskPackage, R16 import
result) and register the read-only DI service `deliveryOsAttemptQueries` that the enterprise executor uses. All domain
logic already exists in commands and `lib/`; this task wires it, proves it with route tests and a live run.

## Current State Analysis

- Commands `delivery_os.attempts.reserve` (`commands/attempts.ts`) and `delivery_os.results.accept`
  (`commands/evidence.ts`) are complete and unit-tested. No HTTP surface yet.
- `buildTaskPackageV1` (`lib/taskPackage.ts:93`) is pure. The only DB loader around it is private
  (`commands/evidence.ts:92-127`, gate `'none'`).
- `api/routeSupport.ts` and `api/__tests__/routeTestKit.ts` give context, guard, error and test plumbing (T015).
- No `di.ts` in the module. Pattern: `progress/di.ts` (`register(container)` with `{ resolve: (c) => … }`).

## Desired End State

`POST /api/delivery_os/tasks/:id/attempts`, `GET /api/delivery_os/tasks/:id/package?attemptId=` and
`POST /api/delivery_os/tasks/:id/results` answer exactly as spec rows UA-10…UA-12; `container.resolve('deliveryOsAttemptQueries')`
returns `{ getAttempt, buildTaskPackage, listPendingDeliveries }`; the GET route and the service share one loader that
never writes. Verified by jest, scoped typecheck and a live transcript on :3100.

### Key Discoveries:

- `executeDeliveryCommand` passes body keys straight to the command (`api/routeSupport.ts:163-166`) → R14 must send a
  body rebuilt from the parsed `reserveAttemptBodySchema`, so `trustedExecution`/`automatic` are unreachable.
- Catalogue statuses are frozen and test-pinned: `idempotency_key_required` 400, `validation_failed` 400,
  `payload_too_large` 413 (`lib/contracts.ts:24,43`).
- `lib/` has no ORM import — DB-touching helpers live in `commands/`.
- Attempts are a JSONB register on `delivery_tasks`; pending deliveries are found by reading scoped tasks.

## Decisions (self-answered planning questions)

| # | Question | Choice | Why |
|---|---|---|---|
| D1 | Missing `Idempotency-Key` / `mode: 'automatic'`: 422 (task text) or 400 (catalogue)? | **400** `idempotency_key_required` / `validation_failed` | Frozen catalogue pinned by a test; same rule as T015. Tests assert the catalogue status. |
| D2 | R16 status for a new result: 200 (task text) or 201 (spec UA-12, T014 notes)? | **201 new, 200 replay** | Spec is the contract UI/QA build on; mirrors R14. |
| D3 | Where does the shared loader live? | `commands/attemptQueries.ts` | `lib/` stays pure; `commands/` already owns scoped DB helpers. `evidence.ts` reuses it (gate `'none'`) so there is one loader. |
| D4 | How does the service report failures? | `buildTaskPackage` throws the same `CrudHttpError` (frozen body) as the route; `getAttempt` returns `null` for unknown task/attempt; unreadable register → `reconciliation_required` | One validation path; EXEC can use `isCrudHttpError`. |
| D5 | Missing scope in the service | `throw new Error('[internal] deliveryOsAttemptQueries requires tenantId and organizationId')` | Task text; programmer error, not HTTP. |
| D6 | Archived tasks on R15 | 404 (live tasks only, like the commands) | Archiving is blocked while an attempt is open, so nothing exportable is lost. |
| D7 | `listPendingDeliveries` query | scoped tasks with `attemptNumber > 0`, ordered by `updatedAt` ascending, task scan capped at 500 rows (plan-review F2), registers parsed in memory, `limit` 1–100 (default 50), unreadable registers skipped | JSONB register; volumes are tiny; empty in OSS-only because `workflowRef` is never set there. Archived tasks included (a pending delivery must still be retried). |
| D8 | R16 size limit | `Content-Length` above 8 MB → 413 before reading; otherwise `resultsImportSchema` (2 000 000 chars → 413) parsed in the route before the guard | Catalogue code, cheap early exit. |
| D9 | 403 proof | declarative `metadata` asserted with the wildcard matcher (`isAllowedBy`), as in T015 | The dispatcher is app code. |
| D10 | Read-only guarantee | service and GET use `em.fork()` + `findOneWithDecryption` only; test spies `flush/persist/nativeInsert/transactional` | Acceptance "GET does not mutate". |

### Addendum after the implementation review

- D7 changed: the 500-row scan cap could starve newer pending deliveries, so the scan now pages (200 rows) until `limit` is reached.
- D8 changed: the body is read through a byte-capped reader (`readCappedRouteBody`), not only a `Content-Length` check; R16 checks the task scope before parsing the body.
- R15 resolves `deliveryOsAttemptQueries` from the DI container (proves the registration live) instead of calling the factory.
- `idempotencyKey` and `source` travel in `pathInput`, so neither the body nor a guard payload can override them.

## What We're NOT Doing

- No claim/cancel/reconcile/mark_delivery (OSS-04), no evidence routes R17+, no UI, no i18n files, no integration specs.
- No change to command behaviour, DTOs, error catalogue, entities or migrations.

## Phase 1: Query service, DI, routes and tests

### Changes Required:

#### 1. Shared read path
**File**: `commands/attemptQueries.ts` (new)
**Intent**: One loader used by R15, the DI service and `results.accept`.
**Contract**: `loadTaskPackage(em, { task, project, attempt, scope }, options?: TaskPackageOptions): Promise<TaskPackageResult>` (moved from `evidence.ts`);
`createDeliveryOsAttemptQueries(em)` → `{ getAttempt(scope, taskId, attemptId): Promise<ExecutionAttempt | null>; buildTaskPackage(scope, taskId, attemptId): Promise<TaskPackageV1>; listPendingDeliveries(scope, { limit? }): Promise<PendingDelivery[]> }`; exported type `DeliveryOsAttemptQueries`. Every method forks the EM and asserts the scope (D5).
**File**: `commands/evidence.ts` — replace private `buildResultPackage` with `loadTaskPackage(..., { attemptGate: 'none' })`.

#### 2. DI
**File**: `di.ts` (new) — `register(container)` registering `deliveryOsAttemptQueries` with `resolve: (c) => createDeliveryOsAttemptQueries(c.resolve('em'))`.

#### 3. Routes
**Files**: `api/tasks/[id]/attempts/route.ts`, `api/tasks/[id]/package/route.ts`, `api/tasks/[id]/results/route.ts` (new); `api/schemas.ts` (add `resultAcceptResponseSchema`; reuse `reserveAttemptResponseSchema`, `taskPackageV1Schema`).
**Contract**:
- R14 POST, `attempts.manage`: header `Idempotency-Key` is checked FIRST (missing → 400 `idempotency_key_required` even with a bad body, plan-review F3; present → `idempotencyKeyHeaderSchema`), then body → `reserveAttemptBodySchema`; command body = `{ idempotencyKey, mode, baseRevision }`, pathInput `{ taskId }`; 201 when `created`, else 200; response without `created`.
- R15 GET, `attempts.manage`: `packageQuerySchema` on `?attemptId`; `createDeliveryOsAttemptQueries(em).buildTaskPackage(scope, …)`; 200 TaskPackage v1.
- R16 POST, `results.import`: D8; command body `{ attemptId, manifest, source: 'manual' }`; 201/200 by `duplicate`.
- All: `metadata`, `openApi`, `deliveryErrorResponse`, guard through `executeDeliveryCommand` on writes.

#### 4. Tests
**Files**: `api/__tests__/{attempts,package,results}.route.test.ts`, `commands/__tests__/attemptQueries.test.ts` (new); `api/__tests__/routeTestKit.ts` (make `flush`, `persist`, `transactional`, add `nativeInsert` as jest spies keeping behaviour; seed helper for a ready task/attempt if needed); `commands/__tests__/baselineTestKit.ts` (`matches` learns `$gt`, additive — plan-review F1).
**Contract**: cases listed in the task (201/200/409 on keys, missing key 400, `automatic` 400, smuggled `trustedExecution` ignored, zero writes + 404 unknown attempt, cancelled/closed 409, foreign tenant/org 404 ×3, metadata 403 matrix, replay duplicate, 413). DI test: only pending rows of the given scope, limit honoured, missing scope throws `[internal]`, `di.ts` registers the key.

#### 5. Generate
`yarn generate` once (generated output is gitignored).

### Success Criteria:

#### Automated Verification:
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- Scoped core typecheck passes (`yarn workspace @open-mercato/core typecheck` or the tsc equivalent)
- `yarn generate` succeeds and the generated DI registry lists `delivery_os`

#### Manual Verification:
- A human reviews the OpenAPI entries for R14–R16 in the API docs page

---

## Phase 2: Live verification and hand-over docs

### Changes Required:
- Live run on :3100 as `admin@acme.com` through the real API: project → draftSpec (uploaded attachment if the API allows) → baseline → both decisions → task ready → reserve ×2 with one key → GET package ×2 with psql snapshots (row counts of the five tables + `delivery_tasks.updated_at`) → import result built with `buildResultManifest` → replay → cleanup.
- `.ai/specs/2026-09-18-delivery-os-hackathon.md` changelog entry; `context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md` hand-over rows.

### Success Criteria:

#### Automated Verification:
- Live transcript: 201 then 200 for one key with the same `attemptId`
- Live transcript: package GET twice leaves row counts and `delivery_tasks.updated_at` unchanged
- Live transcript: result import `duplicate:false` (201) then `duplicate:true` (200), one `delivery_evidence` row
- Test records removed from the local database

#### Manual Verification:
- A human confirms the manual flow in the UI once the UI stream lands (joint acceptance 2.3–2.4)

## Testing Strategy

Route tests run the real handlers and real commands over the in-memory store (T015 kit). Two-connection races stay with QA.

## References

- Research: `context/changes/asd-oss-t016-oss-02-l5b-add-attempts-package-and/research.md`
- Similar implementation: `api/baselines/[id]/decisions/route.ts`, `api/tasks/[id]/route.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Query service, DI, routes and tests

#### Automated

- [x] 1.1 delivery_os jest suite green with --maxWorkers=2
- [x] 1.2 Scoped core typecheck passes
- [x] 1.3 yarn generate succeeds and the generated DI registry lists delivery_os

#### Manual

- [ ] 1.4 A human reviews the OpenAPI entries for R14–R16 in the API docs page

### Phase 2: Live verification and hand-over docs

#### Automated

- [x] 2.1 Live transcript: 201 then 200 for one key with the same attemptId
- [x] 2.2 Live transcript: package GET twice leaves row counts and delivery_tasks.updated_at unchanged
- [x] 2.3 Live transcript: result import duplicate:false then duplicate:true, one delivery_evidence row
- [x] 2.4 Test records removed from the local database

#### Manual

- [ ] 2.5 A human confirms the manual flow in the UI once the UI stream lands
