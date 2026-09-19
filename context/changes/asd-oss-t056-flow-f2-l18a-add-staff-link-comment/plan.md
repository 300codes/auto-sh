# FLOW-F2 L18a — staff-link, comment-import, comment-thread list and triage routes

## Overview

T054/T055 landed the F10–F13 domain commands (`delivery_os.staff.link`, `delivery_os.comments.import`,
`delivery_os.comments.triage`) and the F2 tables, but nothing is reachable over HTTP yet: the routes are still
"pending (F2)" in the spec and Adam's Figma/Kanban UI is blocked on them. This change adds the four routes, their
OpenAPI docs, the two missing serializers and the route test suites.

## Current State Analysis

- Commands are registered and unit-tested (`commands/staffLink.ts`, `commands/comments.ts`); each one owns its own
  validation, scoping, lock header and idempotency. The routes are thin: resolve context → read path/header → hand the
  body to `executeDeliveryCommand`.
- `api/routeSupport.ts` already provides everything the routes need (`readRouteId`, `readRouteText`,
  `readIdempotencyKeyHeader`, `readCappedRouteBody`, `requireProjectIncludingArchived`, `resolveRouteEm`,
  `executeDeliveryCommand`, `deliveryErrorResponse`).
- Contracts are frozen in F0: `staffLinkRequestSchema`/`staffLinkSchema`, `commentImportBatchV1Schema`/
  `commentImportResultSchema`, `commentThreadListResponseSchema`, `commentThreadTriageRequestSchema`, plus
  `commentThreadListQuerySchema` in `data/validators.ts`.
- `api/__tests__/routeTestKit.ts` already carries `staffLinks` / `commentThreads` / `commentReplies` in its store, but it
  orders only the stage-history entities and its container knows neither `deliveryStaffKanbanAdapter` nor
  `timeTrackingAccessResolver`.
- No route serializer exists for `DeliveryStaffLink` or `DeliveryCommentThread`.

## Desired End State

`GET/PUT /api/delivery_os/projects/:id/staff-link`, `POST …/comment-imports`, `GET …/comment-threads` and
`POST …/comment-threads/:threadId/triage` answer per the spec rows F10–F13, appear in the generated OpenAPI JSON, are
covered by four jest route suites, and are verifiable live on :3100.

### Key Discoveries

- Spec rows F10–F13: `.ai/specs/2026-09-18-delivery-os-hackathon.md:500-503` (features, locks, idempotency, error codes).
- Route shape to copy: `api/projects/[id]/stages/[stageId]/artifacts/route.ts` (GET list + POST versioned document) and
  `api/projects/[id]/flow/pin/route.ts` (command call, replay status code).
- `parseFlowVersioned` (`lib/contracts.ts:1008`) answers `422 unsupported_schema_version` itself, so the route only has
  to forward `{ body, status }`.
- Command check order for F11 (spec changelog T055): Idempotency-Key → schema → project → staff link → stage → replay →
  cursor → adapter. The route must therefore read the header **before** the body.
- `matches()` in `baselineTestKit` supports `$in`, so the reply fan-out query works in the route test kit.

## What We're NOT Doing

- No new commands, entities, migrations, events, ACL features or contract schemas (all additive work landed in T053–T055).
- No UI, no Figma provider, no staff-module edits (`staff` is reached only through the existing `deliveryStaffKanbanAdapter`).
- No `TC-DELIVERY-FLOW-03/04` integration specs — those are the next layer (L18b), this task ships jest route suites.

## Implementation Approach

Thin routes over the existing commands; every rule stays in the domain. Each route file exports `metadata`, the handlers
and an explicit `openApi: OpenApiRouteDoc` (the module's established style).

### Decisions taken (autonomous)

| Decision | Choice | Why |
|---|---|---|
| OpenAPI style | explicit `OpenApiRouteDoc`, not `createDeliveryOsCrudOpenApi` | the factory models a plain CRUD list/create resource; it cannot express replay status codes, the `Idempotency-Key` header or a union 409. Every other delivery_os route uses the explicit doc. |
| `PUT staff-link` body | return the `StaffLink` only, dropping the command's `unchanged` flag | F0 froze the response as `staffLinkSchema`; `flow/pin` strips `duplicate` the same way |
| `GET staff-link` with no link | `404 not_found`, detail path `staffLink` | matches the F10 row ("GET reads"), and a missing link is not an empty object |
| Mutation-guard `resourceKind` | project kind for staff-link + comment-imports, `DELIVERY_COMMENT_THREAD_RESOURCE_KIND` for triage | mirrors the optimistic-lock subject each command enforces |
| Thread list order | `updatedAt desc, id desc`; replies fetched in one scoped `$in` query ordered `sourceCreatedAt asc, revision asc`, capped at 500 per thread | newest activity first per task; the frozen item schema caps `replies` at 500 |
| Body caps | imports 1 MB, triage 256 KB, staff-link plain `readRouteBody` | the import batch is the only large payload; the staff-link body is one uuid |

## Phase 1: Routes, schemas and serializers

### Changes Required

#### 1. Triage response schema

**File**: `packages/core/src/modules/delivery_os/api/schemas.ts`

**Intent**: give the triage route a typed response/OpenAPI schema; the contracts file has none.

**Contract**: `commentThreadTriageResponseSchema = { threadId: uuid, triageStatus, updatedAt }` built from the frozen
`commentThreadTriageStatusSchema`.

#### 2. Serializers

**File**: `packages/core/src/modules/delivery_os/api/serializers.ts`

**Intent**: one place that turns the two F2 rows into their frozen DTOs.

**Contract**: re-export `toStaffLink` as `serializeStaffLink` (single source of truth with the command) and add
`serializeCommentThread(row: DeliveryCommentThread, replies: DeliveryCommentReply[]): CommentThreadListItem`.

#### 3. Staff link route

**File**: `packages/core/src/modules/delivery_os/api/projects/[id]/staff-link/route.ts`

**Intent**: F10 — read and set the delivery ↔ staff project link.

**Contract**: `metadata` GET `delivery_os.projects.view`, PUT `delivery_os.flow.manage`. GET → `200 StaffLink` or
`404 not_found`. PUT → `executeDeliveryCommand('delivery_os.staff.link', { staffProjectId }, { projectId })` → `200
StaffLink`. Documented errors: 400, 403, 404, 409 `z.union(deliveryFlowErrorBodySchema, optimisticLockConflictSchema)`
(`staff_link_in_use`, `staff_project_already_linked`, stale project version), 422 `staff_link_required`, 428.

#### 4. Comment import route

**File**: `packages/core/src/modules/delivery_os/api/projects/[id]/comment-imports/route.ts`

**Intent**: F11 — accept one normalized page of source comments.

**Contract**: `metadata` POST `delivery_os.comments.import`. Reads `Idempotency-Key` first, then
`readCappedRouteBody(request, 1_000_000)` (→ 413 `payload_too_large`), then `parseFlowVersioned` on
`DELIVERY_FLOW_SCHEMA_VERSIONS.commentImport`. Calls `delivery_os.comments.import` with `{ batch }` +
`{ projectId, idempotencyKey }`; `201` new / `200` when `result.replayed`.

#### 5. Comment thread list route

**File**: `packages/core/src/modules/delivery_os/api/projects/[id]/comment-threads/route.ts`

**Intent**: F12 — the sync screen reads the imported threads with their staff card ids.

**Contract**: `metadata` GET `delivery_os.projects.view`. Query `commentThreadListQuerySchema`
(`stageId`/`status`/`triage`/`page`/`pageSize` ≤ 100 → 400 above it); the filters map to the columns
`stageId`, **`sourceStatus`** (query key `status`) and `triageStatus` (query key `triage`). Project checked first (404).
Threads and replies read with `findWithDecryption` in the session scope. Response `commentThreadListResponseSchema` =
`{ items, total }`.

#### 6. Triage route

**File**: `packages/core/src/modules/delivery_os/api/projects/[id]/comment-threads/[threadId]/triage/route.ts`

**Intent**: F13 — record the human triage/deferral of one thread.

**Contract**: `metadata` POST `delivery_os.comments.import`. Both path ids read with `readRouteId`
(non-uuid → 404). Body capped at 256 KB, passed as `{ triage }`. `200 commentThreadTriageResponseSchema`; errors 400,
403, 404, 409 union (stale **thread** version), 422 `foreign_reference`/`hash_mismatch`/`reason_required`, 428.

#### 7. Registry

**File**: generated registries (`yarn generate`)

**Intent**: make the four routes discoverable by the app.

**Contract**: generated output only — no hand edits; list the touched generated files in the hand-over.

### Success Criteria

#### Automated Verification

- Type check passes: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`
- `yarn generate` succeeds and the four paths appear in `apps/mercato/.mercato/generated/openapi.generated.json`

#### Manual Verification

- Live curl on :3100: `PUT staff-link` 200 with a seeded staff project; `POST comment-imports` 201 then 200 replayed;
  `GET comment-threads` shows the card with `staffTaskId`; triage 200 and a stale lock 409

**Live smoke prerequisites** (missing ones look like code defects but are data gaps): a staff time project the signed-in
user reaches through `timeTrackingAccessResolver`, that project having at least one task status column, and a delivery
project pinned to the default flow template (an approval `stageId` for the batch).

---

## Phase 2: Route tests

### Changes Required

#### 1. Route test kit

**File**: `packages/core/src/modules/delivery_os/api/__tests__/routeTestKit.ts`

**Intent**: let the kit serve the F2 routes.

**Contract**: order `DeliveryCommentThread` / `DeliveryCommentReply` results; serve
`deliveryStaffKanbanAdapter` and `timeTrackingAccessResolver` from new nullable `routeState` slots. The kit's container
returns `undefined` for an unset service and both `tryResolveStaffAccess` / `tryResolveKanbanAdapter` read `undefined`
as "module absent", so a `null` slot is exactly the `staff_module_unavailable` case. Reset both in `resetRouteState`.

#### 2. Four route suites

**Files**: `api/__tests__/{staffLink,commentImports,commentThreads,triage}.route.test.ts` (+ a small shared
`commentRouteKit.ts` for the link/batch fixtures)

**Intent**: cover the happy path and every failure path a caller hits.

**Contract**: per suite — feature gating via `isAllowedBy(metadata, …)`, 404 for a foreign tenant and a foreign
organization, 428/409 lock behaviour, staff-link replay without a header, `400 idempotency_key_required`, `413`
oversize body, `422 unsupported_schema_version`, replay body equality (`replayed: true`, no second card), list filters +
`pageSize=101` → 400, triage 200 + stale 409. Every response body validated against its frozen schema.

#### 3. Route scan

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/scopeChange.test.ts`

**Intent**: keep the append-only guarantee honest for the new surface.

**Contract**: assert the four route paths exist with exactly the expected methods and that none of them exposes
`PATCH`/`DELETE` (imported replies are append-only; only triage state may change).

### Success Criteria

#### Automated Verification

- Module suite green: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`

---

## Testing Strategy

Unit/route level only (jest + `routeTestKit`), with deterministic fakes for the staff Kanban adapter and the staff
access resolver. The live Figma/WordPress paths are out of scope; `TC-DELIVERY-FLOW-03/04` integration specs follow in
L18b.

## References

- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` rows F10–F13 + the T053–T055 changelog entries
- Hand-over: `context/changes/delivery-os-oss-domain/handover/FLOW-F0-contracts.md`
- Similar implementation: `packages/core/src/modules/delivery_os/api/projects/[id]/stages/[stageId]/artifacts/route.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Manual rows are never ticked by an agent.

### Phase 1: Routes, schemas and serializers

#### Automated

- [x] 1.1 Type check passes for @open-mercato/core
- [x] 1.2 `yarn generate` succeeds and the four paths are in the generated OpenAPI JSON

#### Manual

- [ ] 1.3 Live curl on :3100 covers staff-link, comment-imports replay, thread list and triage

### Phase 2: Route tests

#### Automated

- [x] 2.1 `jest src/modules/delivery_os --maxWorkers=2` green (98 suites / 1828 tests)
