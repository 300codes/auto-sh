# FLOW-F4 L20c — route F14, fake deploy adapter, publication chain test

## Overview

The command `delivery_os.publications.record` exists (T060) but has no HTTP surface. This change adds route F14 per the
FLOW-F0 delta (spec `.ai/specs/2026-09-18-delivery-os-hackathon.md`, row F14), a deterministic fake deploy adapter for
the other streams, and route-level + chain tests.

## Current State Analysis

- Command: `packages/core/src/modules/delivery_os/commands/publications.ts` — checks `results.import` itself, replay by
  payload hash before the lock, 428/409 lock, 422 `deploy_decision_missing` / `revision_mismatch` / `stage_not_approved`
  / `foreign_reference`, writes evidence + publication in one tx, returns `{ publicationId, deploymentEvidenceId, duplicate }`.
- Entity `DeliveryPublication` (append-only, no `updated_at`); `publicationListQuerySchema` (page, pageSize ≤ 100) in
  `data/validators.ts`; `publicationResultV1Schema` / `publicationRecordResponseSchema` in `lib/contracts.ts`.
- Pattern to copy: `api/projects/[id]/evidence/route.ts` (404 before body, `readCappedRouteBody`, 201/200 duplicate)
  and `api/projects/[id]/stages/[stageId]/artifacts/route.ts` (GET list with `findWithDecryption` + `em.count`).
- Test kits: `api/__tests__/routeTestKit.ts` (no `store.publications` yet; `ORDERED_ENTITIES` controls `orderBy`),
  `commands/__tests__/publicationFlow.test.ts` (R22→R20→R21 chain on real handlers), `api/__tests__/stageRouteKit.ts`
  (pinned project + stage approvals, wordpress-theme profile).

## Desired End State

- `POST /api/delivery_os/projects/:id/publications` answers 201 (new) / 200 (`duplicate: true`) with
  `publicationRecordResponseSchema`; `GET` answers `{ items, total }` newest first.
- `createFakeDeployAdapter()` in `lib/fixtures/flow/fakes.ts` yields schema-valid `PublicationResult v1` documents.
- Route tests and the chain test pass; openapi.generated.json lists the path with 201/200/403/404/409/413/422/428.

## Decisions (planning questions answered autonomously)

1. **Route feature metadata** — POST `requireFeatures: ['delivery_os.results.import']` (spec F14), GET `delivery_os.projects.view`. The command's own feature check stays (in-process callers).
2. **Body parsing** — route checks project scope (404) first, reads body capped at 1 MB (`MAX_PUBLICATION_BODY_BYTES`, same as F2/F3 flow routes; a PublicationResult is small), validates with `parseFlowVersioned` on `publicationResultV1Schema` so an unknown `schemaVersion` answers `422 unsupported_schema_version` (same as F3/F7), then runs the command with `{ projectId, publication }`.
3. **Mutation guard** — via `executeDeliveryCommand` (already wires `runMutationGuards`, operation `custom`), like all delivery routes.
4. **List item shape** — `publicationListItemSchema` = the stored PublicationResult v1 fields (`schemaVersion`, `projectId`, `baselineId`, `sourceRevision`, `snapshotRef`, `target`, `url`, `deployDecisionId`, `publishedAt`, `publishedBy`, `verification`) + `publicationId`, `deploymentEvidenceId`, `recordedBy`, `createdAt`. `releaseDecisionId` is omitted (no column; answering `null` would misreport a non-null input — plan-review F1). Appended at the END of `lib/contracts.ts` only.
5. **Ordering** — `createdAt desc, id desc`; routeTestKit adds `DeliveryPublication` to `ORDERED_ENTITIES`.
6. **Fake adapter determinism** — `publishedAt` from a fixed epoch `2026-09-19T12:00:00.000Z` + 1 min per call; `checkedAt` = publishedAt + 30 s; httpStatus 200 when verified, null otherwise; `publishedBy` optional input (default null). No clock/random.
7. **Chain profile** — the chain runs on `wordpress-theme` if the v1 path (baseline→task→attempt→result) accepts the shared draft on a snapshot revision; the URL check is a `reference_material` evidence (permitted only by that profile). Fallback if the WP result path proves incompatible: react-vite chain with a verified v1 `deployment` evidence as the URL-check reference, noted in the hand-over.
8. **Errors in openApi** — 400, 403, 404, 409 (lock), 413, 422 (`unsupported_schema_version`, `deploy_decision_missing`, `revision_mismatch`, `stage_not_approved`, `deployment_unverified`, `foreign_reference`), 428.

## What We're NOT Doing

- No new event, ACL feature, DI key, migration or frozen v1 schema change. No UI. No live deploy adapter. No F2 seams.

## Phase 1: Route F14 + list contract

### Changes Required

1. **`lib/contracts.ts`** (append at end) — `publicationListItemSchema`, `publicationListResponseSchema` (+ types).
2. **`api/serializers.ts`** — `serializePublication(row: DeliveryPublication): PublicationListItem`.
3. **`api/projects/[id]/publications/route.ts`** — GET/POST per Decisions 1–5, 8; `openApi` via the module's existing OpenAPI helpers/tag.
4. **`yarn generate`** once; report generated diffs (gitignored).

### Success Criteria

#### Automated Verification:

- `yarn generate` succeeds and openapi.generated.json lists `/api/delivery_os/projects/{id}/publications`
- Scoped typecheck green

## Phase 2: Fake deploy adapter

### Changes Required

1. **`lib/fixtures/flow/fakes.ts`** — `createFakeDeployAdapter()` with `publish(input)` → `PublicationResultV1` (Decision 6), `calls` list.
2. **`lib/__tests__/fakeDeployAdapter.test.ts`** — both variants parse; verified without evidenceId rejected by schema (code `deployment_unverified`); sequence deterministic across two adapters.

### Success Criteria

#### Automated Verification:

- Fake adapter unit test green

## Phase 3: Route and chain tests

### Changes Required

1. **`api/__tests__/routeTestKit.ts`** — `store.publications`, `rowsFor`, `ORDERED_ENTITIES`.
2. **`api/__tests__/publications.route.test.ts`** — metadata 403 (results.import / view), 404 second tenant + second org, 428, 409 stale, replay 200 without lock, 400/413, each 422 code via HTTP, GET cap (pageSize 101 → 400, ≤ 100 honoured), newest first, cross-scope empty/404.
3. **`commands/__tests__/publicationChain.test.ts`** — chain per task description, incl. legacy R22 body without `flow`.

### Success Criteria

#### Automated Verification:

- delivery_os jest suite green with `--maxWorkers=2`
- Contracts pin test green (no frozen v1 change)
- Scoped typecheck green

#### Manual Verification:

- Live F14 smoke against a server running lane-B code (after merge; the shared :3100 server runs lane A)

## References

- Spec F14 row: `.ai/specs/2026-09-18-delivery-os-hackathon.md:504`
- Command: `packages/core/src/modules/delivery_os/commands/publications.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Route F14 + list contract

#### Automated

- [x] 1.1 `yarn generate` succeeds and openapi.generated.json lists `/api/delivery_os/projects/{id}/publications`
- [x] 1.2 Scoped typecheck green

### Phase 2: Fake deploy adapter

#### Automated

- [x] 2.1 Fake adapter unit test green

### Phase 3: Route and chain tests

#### Automated

- [x] 3.1 delivery_os jest suite green with `--maxWorkers=2`
- [x] 3.2 Contracts pin test green (no frozen v1 change)
- [x] 3.3 Scoped typecheck green

#### Manual

- [ ] 3.4 Live F14 smoke against a server running lane-B code (after merge)
