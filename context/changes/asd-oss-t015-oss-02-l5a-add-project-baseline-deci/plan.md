# OSS-02 (L5a): project, baseline, decision and task API routes — Implementation Plan

## Overview

Expose the existing `delivery_os` commands over HTTP as the frozen routes R1–R13 of
`.ai/specs/2026-09-18-delivery-os-hackathon.md`, with `metadata`, `openApi`, the frozen error body and jest route
tests. This is what lets the UI stream, the enterprise agents and QA drive a delivery project without fixtures.

## Current State Analysis

Commands for projects, tasks, baselines and decisions exist and own scope, 404 for foreign scope, optimistic locking,
the required project header (428), audit, side effects and events (`research.md`). There is no `api/` folder. Project
commands return `{ projectId }` only, while R2/R3 must answer `updatedAt`. No read DTO exists for project detail,
baseline or task.

## Desired End State

`/api/delivery_os/{projects,projects/:id,projects/:id/baselines,baselines/:id/decisions,projects/:id/tasks,tasks/:id,tasks}`
answer exactly as the spec route map says. Verify with
`yarn workspace @open-mercato/core jest src/modules/delivery_os/api --maxWorkers=2`,
`yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` and a live curl run against :3100
(201 create, 200 list with `updatedAt`, 409 stale PUT).

### Key Discoveries:

- Factory command path passes `CrudHttpError` bodies through untouched and awaits `action.response`
  (`packages/shared/src/lib/crud/factory.ts:612-622`, `:2691-2695`); a raw `ZodError` becomes the factory's
  `400 { error: 'Invalid input' }`, so bodies are parsed in `mapInput` with `parseDeliveryInput`.
- The list reads the platform flag `withDeleted` from the raw query (`factory.ts:1850`); the spec freezes
  `includeArchived`.
- 401/403 from `metadata` is enforced by the app dispatcher, not the handler
  (`apps/mercato/src/app/api/[...slug]/route.ts:157-162`).
- `validateCrudMutationGuard` is deprecated in favour of `runRouteMutationGuards`
  (`packages/shared/src/lib/crud/route-mutation-guard.ts`).
- The real factory can run under jest with a mocked container (`packages/shared/src/lib/crud/__tests__/crud-factory.test.ts`).

## Decisions (questions answered by the developer, unattended)

| # | Question | Choice | Why |
|---|---|---|---|
| D1 | Where do domain rules live? | Only in commands/lib; routes build input, pick the feature, run guards, shape the response | One validation path = visible "system decides" boundary |
| D2 | How do R2/R3 get `updatedAt`? | Project command results gain `updatedAt` (additive) | No second read, same as task commands |
| D3 | `includeArchived` vs platform `withDeleted` | GET wrapper rewrites `includeArchived=true` → `withDeleted=true` and strips a client-sent `withDeleted` | Spec name frozen; factory untouched |
| D4 | List item shape | camelCase via `transformItem`, without `draftSpec` | Same names as detail; list stays light |
| D5 | List organization scope | Pinned to `resolveDeliveryScope` (same single org as commands/detail) via `buildFilters` | A listed project must never 404 on open |
| D6 | `requirements_proposal` / `plan_proposal` before OSS-03 | Feature `results.import` checked first (403), then the command's existing `400 validation_failed` / `unsupported_source` | The frozen catalogue has no 422 "not supported" code; T011/T012 already decided the 400; a temporary code would be contract churn |
| D7 | Mutation guard helper | `runRouteMutationGuards` | The pair named in the task is deprecated and skips registry guards |
| D8 | Read DTOs | camelCase `ProjectDetail`, `BaselineDto` (with `content`, `isActive`, `decisions[]`), `TaskDto` (with `executionAttempts`) defined as zod schemas in `api/schemas.ts` | No `GET /baselines/:id` exists in the route map, so R6 must carry what the approval screen needs |
| D9 | Reads of archived records | R5, R6, R9 and R11 read archived projects/tasks by id; R1 and R9 hide archived rows | "History kept", report must stay readable |
| D10 | Per-source feature check | `rbacService.userHasAllFeatures` + `resolveFeatureCheckContext`; `metadata` carries `projects.view` for the POST of R7/R10 | Wildcard-aware, no role names; dispatcher still blocks callers with no delivery access |
| D11 | Test style | Real routes + real factory + real commands over an in-memory store; `metadata` asserted with the shared wildcard matcher | Proves 409/404/422 end to end without a DB; dispatcher is app code and cannot be imported |
| D12 | In-handler 401 body | Platform `{ error: 'Unauthorized' }` | The frozen catalogue has no 401 code; equals the factory's body |

Adaptations after the implementation review (`reviews/impl-review.md`): D10 uses the write scope instead of a second
`resolveFeatureCheckContext` call; custom routes build their context exactly like the CRUD factory; list export is
disabled; the 500 fallback and other platform bodies are not frozen-shaped; "Lint passes for core" was run as
`npx eslint packages/core/src/modules/delivery_os/api …` because `@open-mercato/core` has no `lint` script.

## What We're NOT Doing

- R14–R22 (attempts, package, results, cancel/reconcile, evidence, deploy/release, report) — next tasks.
- Proposal imports (OSS-03). No new error code, no schema-version change, no migration.
- No UI, no i18n, no Playwright specs (other streams). No pagination for R6/R9 (spec: `{ items, total }`).

## Implementation Approach

A small `api/routeSupport.ts` holds what every custom route repeats: build the `CommandRuntimeContext`, check a
feature, run guard → command → after-success, and map errors. CRUD routes use `makeCrudRoute` with `commandId`
actions. Read routes load with the scoped finders and serialize through `api/serializers.ts`.

## Critical Implementation Details

- **Archived reads**: `requireScopedProject`/`requireScopedTask` filter `deletedAt: null`; read routes need a loader
  that keeps tenant + organization but drops that filter.
- **R8 and R7 lock header**: the commands already answer 428/409; routes must pass `request` in the context and
  must not pre-check.

## Phase 1: Route support and project routes (R1–R5)

### Overview

Shared plumbing, OpenAPI factory, DTO schemas, the project CRUD route and project detail, with tests.

### Changes Required:

#### 1. Project command results

**File**: `packages/core/src/modules/delivery_os/commands/projects.ts` (+ `commands/__tests__/projects.test.ts`)

**Intent**: Return the flushed `updatedAt` so routes can answer it without a second read.

**Contract**: `ProjectCommandResult = { projectId: string; updatedAt: string }` (exported); create/update/delete all
return it, read from the entity after the flush (`project.updatedAt.toISOString()`). Additive. The three
`toEqual({ projectId })` assertions in `projects.test.ts` (create, update, delete) are updated.

#### 2. Route support

**File**: `packages/core/src/modules/delivery_os/api/routeSupport.ts`

**Intent**: One place for context building, feature checks, guarded command execution and error mapping.

**Contract**: `resolveDeliveryRouteContext(request)` → `CommandRuntimeContext` (throws 401);
`requireDeliveryFeatures(ctx, features)` (throws frozen `403 forbidden`; fails closed when `rbacService` is missing,
throws or answers anything but `true`); `executeDeliveryCommand<TResult>(ctx,
{ commandId, input, resourceKind, resourceId, operation })` (guard block → returned response; after-success after
commit); `deliveryErrorResponse(error)` (CrudHttpError → body/status, interceptor rejection, else logged + reported
500 in the frozen shape without internals); `readRouteId(params)` (invalid uuid → `404 not_found`);
`findProjectIncludingArchived`, `findTaskIncludingArchived`.

#### 3. OpenAPI + DTO schemas + serializers

**Files**: `api/openapi.ts`, `api/schemas.ts`, `api/serializers.ts`

**Intent**: `createCrudOpenApiFactory({ defaultTag: 'Delivery OS' })`, zod response schemas (list item, detail,
baseline, task, command responses, error body, platform 409 body) and pure entity → DTO mappers.

**Contract**: `ProjectDetail = { id, name, inputMode, brief, targetProfileId, targetProfileVersion, repositoryRef,
draftSpec, activeBaselineId, limits, createdAt, updatedAt, archivedAt, status, progress { proven, total, unit,
percent }, taskCounts, attention }`.

#### 4. Projects CRUD route

**File**: `api/projects/route.ts`

**Intent**: R1–R4 through `makeCrudRoute` with command actions.

**Contract**: metadata GET `projects.view`, POST/PUT/DELETE `projects.manage`; list schema
`projectListQuerySchema` (passthrough of platform params), `search` → `name ilike`, sort by `created_at desc`;
POST `201 { id, updatedAt }`, PUT `200 { ok, updatedAt }`, DELETE `200 { ok }`; `mapInput` validates with
`parseDeliveryInput`; no `events` option; `indexer.entityType = E.delivery_os.delivery_project`.

#### 5. Project detail route

**File**: `api/projects/[id]/route.ts`

**Intent**: R5 with computed status/progress, readable when archived.

**Contract**: loads baselines (AC ids from content), live tasks, `result_manifest` evidence and release decisions
for `deriveProjectStatus`.

#### 6. Tests

**Files**: `api/__tests__/routeTestKit.ts`, `api/__tests__/projects.route.test.ts`

**Intent**: 401, metadata feature matrix (view-only cannot POST; wildcard grants), 404 second tenant and second org,
409 stale PUT/DELETE with the platform body, 400 validation body shape, 422 unknown profile, `pageSize=101`
rejected, archived hidden from the list query (`withDeleted` false unless `includeArchived`) but readable by id,
`updatedAt` in list items and detail, status/progress numerator + denominator.

### Success Criteria:

#### Automated Verification:

- Project route tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/api --maxWorkers=2`
- Project command tests still pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/projects.test.ts --maxWorkers=2`

---

## Phase 2: Baseline, decision and task routes (R6–R13)

### Overview

The remaining custom routes and the tasks CRUD route, with tests.

### Changes Required:

#### 1. Baselines route

**File**: `api/projects/[id]/baselines/route.ts`

**Intent**: R6 list (newest version first, `isActive`, decisions per baseline) and R7 create.

**Contract**: POST parses `baselineCreateSchema`; feature by source (D6, D10); executes
`delivery_os.baselines.create` with `{ projectId, ...body }`; `201 { baselineId, version, contentHash, duplicate:
false, openCommentIds }` or `200` when `duplicate`.

#### 2. Decisions route

**File**: `api/baselines/[id]/decisions/route.ts`

**Intent**: R8.

**Contract**: metadata POST `baselines.approve`; executes `delivery_os.decisions.record` with `{ baselineId,
...body }`; `201 { decisionId, activeBaselineId, projectUpdatedAt }`.

#### 3. Project tasks route

**File**: `api/projects/[id]/tasks/route.ts`

**Intent**: R9 list (live tasks, oldest first) and R10 create.

**Contract**: `200 { items: TaskDto[], total }`; POST `201 { id, updatedAt }`, feature by source.

#### 4. Task detail and tasks CRUD

**Files**: `api/tasks/[id]/route.ts`, `api/tasks/route.ts`

**Intent**: R11 detail with `updatedAt` and the attempt register; R12/R13 via `makeCrudRoute` exporting PUT and
DELETE only.

**Contract**: PUT `200 { ok, updatedAt, status }`, DELETE `200 { ok }`; an unreadable attempt register serializes as
`executionAttempts: []` with `attemptRegisterReadable: false` (GET never fails closed on history).

#### 5. Tests

**Files**: `api/__tests__/{baselines,decisions,tasks}.route.test.ts`

**Intent**: 401; metadata matrix (manage without approve is denied on decisions); per-source 403; 428 without the
header; 409 stale header; 409 `subject_hash_mismatch`; 422 draft gaps; 400 `unsupported_source` for proposals;
404 second tenant/org; task 422 `cycle`/`unknown_ac`, 409 `invalid_transition`, stale PUT/DELETE 409; GET routes
perform no write.

### Success Criteria:

#### Automated Verification:

- All API route tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/api --maxWorkers=2`
- Whole module suite passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`

---

## Phase 3: Generate, typecheck, live verification, docs

### Overview

Register the routes, prove them on the running instance and record the hand-over.

### Changes Required:

#### 1. Generation and checks

**Intent**: `yarn generate` once (report the diff; output is gitignored), typecheck, lint of the touched package.

#### 2. Live run

**Intent**: Login as `admin@acme.com`, create → PUT draftSpec → stale PUT 409 → list (also `?search=` and
`includeArchived=true` after archive, because jest mocks the query engine) → detail → archive; try a
restricted user for 403 if one is seeded; delete the test records.

#### 3. Spec and hand-over

**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (changelog + read DTOs),
`context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md`

### Success Criteria:

#### Automated Verification:

- Generator runs: `yarn generate`
- Typecheck passes: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`
- Lint passes for core: `yarn turbo run lint --filter=@open-mercato/core --concurrency=2`
- Live curl shows 201 create, 200 list with `updatedAt`, 409 on stale PUT

#### Manual Verification:

- A human confirms the curl transcript summary in the task notes (co-acceptance 2.4 stays open)

---

## Testing Strategy

### Unit Tests:

- Route tests run the real handlers, the real CRUD factory and the real commands over the in-memory store of
  `commands/__tests__/baselineTestKit.ts` (extended with tasks), mocking only DI, auth, organization scope,
  `encryption/find`, events and i18n.

### Integration Tests:

- QA-owned `TC-DELIVERY-001…004`; this task provides the live curl evidence only.

## Performance Considerations

Project detail loads the project's baselines, tasks, result evidence (three columns) and release decisions — bounded
by project size; no list endpoint computes status.

## Migration Notes

None. No schema, event, feature or path change; `ProjectCommandResult.updatedAt` is additive.

## References

- Research: `context/changes/asd-oss-t015-oss-02-l5a-add-project-baseline-deci/research.md`
- Spec route map: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (API Contracts)
- Reference routes: `packages/core/src/modules/customers/api/companies/route.ts`,
  `packages/core/src/modules/customers/api/interactions/complete/route.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Route support and project routes (R1–R5)

#### Automated

- [x] 1.1 Project route tests pass
- [x] 1.2 Project command tests still pass

### Phase 2: Baseline, decision and task routes (R6–R13)

#### Automated

- [x] 2.1 All API route tests pass
- [x] 2.2 Whole module suite passes

### Phase 3: Generate, typecheck, live verification, docs

#### Automated

- [x] 3.1 Generator runs
- [x] 3.2 Typecheck passes
- [x] 3.3 Lint passes for core
- [x] 3.4 Live curl shows 201 create, 200 list with updatedAt, 409 on stale PUT

#### Manual

- [ ] 3.5 A human confirms the curl transcript summary in the task notes
