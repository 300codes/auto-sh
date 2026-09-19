# OSS-05 (L9b): report route R22 and the report query — Implementation Plan

## Overview

Expose `DeliveryReport v1` over HTTP: `GET /api/delivery_os/projects/:id/report?baselineId=&revision=&limit=` (R22,
`delivery_os.projects.view`, read-only) backed by a scoped loader `createDeliveryOsReportQueries(em)` registered on
DI as `deliveryOsReportQueries` so the deploy/release decision commands (R20/R21) and EXEC can reuse it.

## Current State Analysis

- The pure builder `lib/deliveryReport.ts#buildDeliveryReport` (T031) takes project id, baseline `{id, projectId,
  contentHash, content}`, tasks, evidence, decisions, profile, revision|null and a row limit. It does not check the
  revision kind against the profile — R22 must (spec `.ai/specs/2026-09-18-delivery-os-hackathon.md` line 315:
  `404; 422 invalid_revision`).
- Read-route pattern: `api/projects/[id]/route.ts` (GET, `resolveDeliveryRouteContext` → `resolveDeliveryScope` →
  `readRouteId` → `requireProjectIncludingArchived`, `deliveryErrorResponse`). DI query-service pattern:
  `commands/attemptQueries.ts` + `di.ts` (`assertQueryScope`, `rootEm.fork()`).
- `commands/evidence.ts#requireVerifiedBaselineContent` (private) verifies the stored baseline content against its
  hash (`422 hash_mismatch`); `commands/tasks.ts#findProjectBaseline` does a scoped baseline lookup.
- Route test harness `api/__tests__/routeTestKit.ts` (in-memory store, write spies `EM_WRITE_METHODS`, container mock
  that already special-cases `deliveryOsAttemptQueries`); `attemptRouteKit.ts` seeds a ready task, reserves an
  attempt and exports a package; `lib/fixtures/builders.ts#buildResultManifest` builds a passing manifest.
- Error codes `invalid_revision` (422), `not_found` (404), `hash_mismatch`, `unknown_target_profile`,
  `validation_failed` (400) already exist in `lib/contracts.ts`.

## Desired End State

- `GET /projects/:id/report` answers `200 DeliveryReport v1` (parses with `deliveryReportV1Schema`) for the active
  baseline, or the `baselineId` given; archived projects stay readable; zero writes.
- Foreign tenant/org project, baseline of another project → `404 not_found`; no active baseline and no `baselineId`
  → `404 not_found` (detail `no_active_baseline`); malformed or wrong-kind `revision` → `422 invalid_revision`;
  malformed `baselineId`/`limit` → `400 validation_failed`; no `projects.view` → 403 by metadata.
- `deliveryOsReportQueries.buildReport(scope, projectId, { baselineId?, revision?, limit? })` is on DI;
  `deliveryOsAttemptQueries` unchanged.

### Key Discoveries

- Revision query syntax must be URL-friendly; `SourceRevision` is a discriminated union (`lib/contracts.ts:187`).
- Project pins the target profile (`DeliveryProject.targetProfileId/Version`), which is what the report evaluates.
- `DeliveryEvidence` has `projectId`, `baselineId`, `taskId`, `kind`, `sourceRevision`, `payload`, `rawReportHash`,
  `createdAt` — exactly `DeliveryReportEvidence`.

## What We're NOT Doing

- No deploy/release decision commands (R20/R21 — next L9 task), no UI, no integration spec (QA), no migration,
  no ACL feature, event or error code; no enterprise import (run links come from stored rows only).
- No pagination of the report: one bounded document with `limit` (≤ 1000) and `truncated`. Evidence of one
  baseline is read in one query (accepted limit, plan review F3).

## Implementation Approach

Decisions taken (autonomous mode, recommended options):

1. **Revision ref syntax**: `revision=git:<commitSha>` or `revision=snapshot:<sha256>:<externalWorkspaceId>`, each
   part validated by `sourceRevisionSchema` (split on the first two `:` only; the remainder is the workspace id). Anything else, or a kind other than the profile's → `422
   invalid_revision` (details: `revision_unparsable` / `revision_kind_mismatch`). One code, as the spec table says.
2. **Profile**: the project's pinned profile; unknown → `422 unknown_target_profile`.
3. **Baseline**: `baselineId` query (must belong to project+scope, else 404) or `project.activeBaselineId`; none → 404
   `no_active_baseline`. Stored content verified against hash (reuse `requireVerifiedBaselineContent`, exported).
4. **Rows**: tasks of the project including archived (history), evidence of the project + baseline, all decisions of
   the project; all with tenant+org filters via `findWithDecryption`. The builder does the revision filtering.
5. **Limit**: optional `limit` 1–1000, default 1000 (`MAX_TRACEABILITY_ROWS`).
6. **DI**: new key `deliveryOsReportQueries` (additive).

## Phase 1: Report query, route and tests

### Changes Required

#### 1. Query validator
**File**: `packages/core/src/modules/delivery_os/data/validators.ts`
**Intent**: add `reportQuerySchema` `{ baselineId?: uuid, revision?: string (1..400), limit?: coerced int 1..1000 }`.

#### 2. Report loader
**File**: `packages/core/src/modules/delivery_os/commands/reportQueries.ts` (new)
**Intent**: scoped loader + revision-ref parser.
**Contract**: `parseRevisionRef(ref: string): SourceRevision | null`; `DeliveryOsReportQueries = { buildReport(scope,
projectId, options?: { baselineId?: string | null; revision?: string | SourceRevision | null; limit?: number }):
Promise<DeliveryReportV1> }`; `createDeliveryOsReportQueries(rootEm)`. Throws `deliveryHttpError` for 404/422.
Only reads (`findWithDecryption` / `findOneWithDecryption`).

#### 3. DI + evidence helper export
**Files**: `di.ts` (register `deliveryOsReportQueries`), `commands/evidence.ts` (export
`requireVerifiedBaselineContent`, no behaviour change).

#### 4. Route
**File**: `api/projects/[id]/report/route.ts` (new) — GET, metadata `requireAuth` + `delivery_os.projects.view`,
parses the query with `parseDeliveryInput(reportQuerySchema, …)`, resolves `deliveryOsReportQueries`, returns JSON;
`openApi` with `deliveryReportV1Schema` response and 400/404/422 errors.

#### 5. Tests
**Files**: `api/__tests__/report.route.test.ts` (new), `api/__tests__/routeTestKit.ts` (container resolves
`deliveryOsReportQueries`), `commands/__tests__/reportQueries.test.ts` (new, parser).
Cases: metadata/403 (view-only allowed, no features denied), 401; manual flow (ready task → reserve → package →
import passing result) → report on the result revision: AC `passed`, same report with another revision → `missing`,
default revision = latest result; no writes during GET (spies cleared after the flow); foreign tenant / foreign org
→ 404; baseline of another project → 404; no active baseline → 404; `revision` malformed / snapshot on git profile →
422 `invalid_revision`; project with an unknown pinned profile → 422 `unknown_target_profile`; stored baseline
content altered → 422 `hash_mismatch`; `limit=1` → `truncated: true`, `rows.length` 1; `limit=0` → 400; archived project readable.

#### 6. Docs
Spec changelog entry in `.ai/specs/2026-09-18-delivery-os-hackathon.md`; hand-over
`context/changes/delivery-os-oss-domain/handover/OSS-05-L9b-report-route.md` with the response DTO note for UI-05.

### Success Criteria

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- Scoped tsc over the new/changed files passes; eslint on touched files passes
- `yarn generate` registers the route (`/api/delivery_os/projects/[id]/report` present in generated modules)
- Live GET on :3100 for a smoke project returns a body that parses with `deliveryReportV1Schema`

#### Manual Verification:

- UI-05 / QA-05 read the report of a real demo project and confirm the drill-down (human)

## Testing Strategy

Route tests through the in-memory harness (same technique as `package.route.test.ts`), parser unit tests, one
live smoke via curl on :3100.

## References

- `lib/deliveryReport.ts`, `commands/attemptQueries.ts`, `api/projects/[id]/route.ts`, `api/__tests__/package.route.test.ts`
- Hand-over `context/changes/delivery-os-oss-domain/handover/OSS-05-L9a-report-rules.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Report query, route and tests

#### Automated

- [x] 1.1 `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- [x] 1.2 Scoped tsc over the new/changed files passes; eslint on touched files passes
- [x] 1.3 `yarn generate` registers the route (`/api/delivery_os/projects/[id]/report` present in generated modules)
- [x] 1.4 Live GET on :3100 for a smoke project returns a body that parses with `deliveryReportV1Schema`

#### Manual

- [ ] 1.5 UI-05 / QA-05 read the report of a real demo project and confirm the drill-down (human)
