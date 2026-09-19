# OSS-01 (T003): OSS and enterprise-boundary specs with the API and test lists — Implementation Plan

## Overview

Write the two hackathon specs required by master-plan Phase 1 ("Dwa specy odwołują się do tego planu, zawierają model/API, integration coverage oraz Migration & Backward Compatibility") and an OSS hand-over note listing the new APIs and the planned test files per layer. The OSS spec freezes the **real** API paths of `delivery_os` after checking the platform router and the `makeCrudRoute` convention, so UI/EXEC/QA can build on stable paths from the H4 hand-over.

## Current State Analysis

- Neither spec exists (`.ai/specs/` and `.ai/specs/enterprise/` contain no `delivery` spec). The module `packages/core/src/modules/delivery_os/` does not exist yet.
- Master plan (`context/changes/autonomous-software-delivery/plan.md`) already decides the data model (5 entities), contracts (TaskPackage v1, ResultManifest v1, sourceRevision union), public attempt/decision operations, lifecycle and failure rules, testing strategy and integration coverage. The BREAKDOWN (`autodev/state/BREAKDOWN.md` §3–§4) enumerates UA-01…UA-29, ACL features, events, DI service and internal commands.
- `.ai/specs/AGENTS.md` requires `{date}-{title}.md`, and sections TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog. Enterprise scope must stay out of the OSS directory.

### Key Discoveries

- API URL = `/api/<moduleId>/<path segments under api/>`; route path built as `'/' + [modId, ...segs]` in `packages/cli/src/lib/generators/module-registry.ts:2431`. Dynamic `[id]` segments are matched by `matchRoutePattern` in `packages/shared/src/modules/registry.ts:326-356`; dispatch is method-aware and sorted by specificity (`findApiRouteManifestMatch`, `registry.ts:414-426`; catch-all `apps/mercato/src/app/api/[...slug]/route.ts:344`).
- Collection route + `[id]` detail coexist in the reference module: `customers/api/deals/route.ts` (makeCrudRoute) and `customers/api/deals/[id]/route.ts` (GET detail, `GET(request, { params })` at line 398). Nested custom action: `customers/api/deals/bulk-update-stage/route.ts` (custom POST, `validateCrudMutationGuard`, own `metadata`/`openApi`).
- `makeCrudRoute` exposes GET/POST/PUT/DELETE on the **collection** path: PUT takes `id` from the body (`UpdateConfig` "Must contain a string uuid `id` field", `packages/shared/src/lib/crud/factory.ts:460-467`); DELETE takes `id` from the query by default (`DeleteConfig.idFrom`, `factory.ts:469-474`, `3084-3088`). Client helpers match: `deleteCrud` calls `/api/${apiPath}?id=` (`packages/ui/src/backend/utils/crud.ts:144`). Usage: `customers/api/companies/route.ts:79-80,85,428-440,500-503`.
- makeCrudRoute returns `400 {error:'Invalid input', details: issues}` for a ZodError (`factory.ts:622`); commands throw `CrudHttpError(status, body)` (`packages/shared/src/lib/crud/errors.ts:5`).
- Optimistic lock: header `x-om-ext-optimistic-lock-expected-updated-at`, conflict code `optimistic_lock_conflict` (`packages/shared/src/lib/crud/optimistic-lock-headers.ts:15,17`), 409 body `{error, code, currentUpdatedAt, expectedUpdatedAt}` (`optimistic-lock.ts:256-263`). The header is optional by platform design (absent header = no check).
- Extension host: `injectionExtensionHost({ spotId, source, family, supported, contextContract })` + `defineModuleExtensionPoints` (`packages/shared/src/modules/widgets/extension-points.ts:60-143`).
- Module activation: `apps/mercato/src/modules.ts:75` style `{ id, from: '@open-mercato/core' }`; enterprise agents gated by `OM_ENABLE_ENTERPRISE_MODULES` + `OM_ENABLE_ENTERPRISE_MODULES_AGENTS` (`modules.ts:196-221`).
- QA test naming: `packages/<pkg>/src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts` (`.ai/qa/AGENTS.md:282`).

## Desired End State

- `.ai/specs/2026-09-18-delivery-os-hackathon.md` exists with the full OSS contract surface: entities/indexes, ACL (8), events (4), extension spot + context contract, DI read service, internal command IDs, DTO v1 summary, a route map with file paths and cited router evidence, an API table for UA-01…UA-20, error body + code catalogue, integration coverage mapped to QA TC-DELIVERY specs and OSS jest tests, Migration & BC, risks, compliance report, changelog.
- `.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md` exists as a boundary-only spec; execution sections are explicitly "Pending — to be completed by EXEC".
- `context/changes/delivery-os-oss-domain/handover/OSS-01-api-and-tests.md` lists new APIs and planned test files per layer, and `delivery-os-oss-domain/change.md` links it.
- `git status` shows changes only under `.ai/specs/**`, `context/changes/delivery-os-oss-domain/**` and this change folder.

## What We're NOT Doing

- No code, no `delivery_os` module files, no migrations, no `yarn generate`.
- No edits to any `AGENTS.md`, the master plan, workstreams, `hackathon/**` or `packages/enterprise/**`.
- Not writing the executable TC-DELIVERY specs (QA-owned) — only naming and mapping them.
- Not specifying enterprise execution internals (workflow definition, worker, Cezar adapter) — EXEC owns them.
- Not re-deciding any master-plan architecture.

## Implementation Approach

Documentation in English (repo spec convention). Decisions taken in planning (autonomous, recommended options):

1. **CRUD paths follow the platform.** `api/projects/route.ts` = `makeCrudRoute` (GET list, POST, PUT with `id` in body, DELETE with `?id=`); `api/projects/[id]/route.ts` = GET detail. Tasks: `api/tasks/route.ts` = `makeCrudRoute` exporting **PUT and DELETE only**; creation and listing stay at `/projects/:id/tasks` (needs project scope and the `source: proposal` discriminator); `api/tasks/[id]/route.ts` = GET detail. Master-plan `/projects/:id` and `/tasks/:id` PUT/DELETE therefore become collection-level PUT/DELETE — recorded as a deliberate deviation with the citation.
2. **Action routes keep master-plan paths** as nested `[id]` custom routes. No static segment is placed as a sibling of an `[id]` segment, so no route ambiguity.
3. **Lock header is required per endpoint, listed in a "Lock" column of the API table** (plan-review F1/F2): project lock for baseline create/proposal import, requirements/design decisions and deploy/release decisions; task lock for a *new* reservation, cancel, reconcile and task transitions. Reserve compares the `Idempotency-Key` **before** the lock, so a replay never 409s on the lock. Results import and evidence carry **no** lock header — attemptId + manifest hash + the partial unique index are the concurrency control, so identical replays return `duplicate: true`. Missing required header → `428 optimistic_lock_required`; stale → platform `409 optimistic_lock_conflict`. CRUD PUT/DELETE keep the platform behaviour (CrudForm always sends it); DELETE maps to `delivery_os.projects.delete` / `delivery_os.tasks.delete` commands that enforce the active-attempt guard and soft-delete without cascade (F3).
4. **Status split:** 400 `validation_failed` (shape), 422 domain rule (`unsupported_schema_version`, `cycle`, …), 409 state conflict (`attempt_active`, `idempotency_conflict`, …), 404 `not_found` (also for foreign scope), 403 `forbidden`, 428 lock missing. All delivery_os bodies are `{error, code, details[]}` except the platform lock 409. CRUD routes reach the same body by validating inside `mapInput` and throwing `CrudHttpError(400, …)`.
5. **Tests:** QA-owned `TC-DELIVERY-NNN` (OSS module) and `TC-DELIVERY-EXEC-NNN` (enterprise) proposed IDs; OSS-owned jest files under `delivery_os/{lib,data,commands,api}/**/__tests__/`.
6. **DTOs** are summarised (field names, versions) and point to `delivery_os/lib/contracts.ts` as the executable source of truth once OSS-02 L1 lands.

## Phase 1: OSS spec with the frozen route map

### Overview

Write the OSS spec, including the route map justified by the router/`makeCrudRoute` citations above.

### Changes Required:

#### 1. OSS spec

**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`

**Intent**: Single source for the OSS contract surface that UI/EXEC/QA build against; references the master plan instead of restating its rationale.

**Contract**: Sections — TLDR, Overview (link to master plan and workstream), Problem Statement, Proposed Solution, Architecture (module layout, boundary, route resolution evidence), Data Models (5 entities with columns + indexes: baseline uniques `(tenant_id, organization_id, project_id, version)` and `(…, project_id, content_hash)`; evidence partial unique `(tenant_id, organization_id, task_id, attempt_id) WHERE kind='result_manifest'`; tasks partial unique `(tenant_id, organization_id, project_id, baseline_id, proposal_task_key) WHERE proposal_task_key IS NOT NULL`; executionAttempts JSON shape), Contracts v1 summary, ACL (8 features + default role features), Events (4), Extension spot + `delivery_os.project.execution.v1`, DI `deliveryOsAttemptQueries`, Commands (public + internal IDs), API Contracts (route map + UA-01…UA-20 table + error body + code catalogue), Integration Coverage (API paths + key UI paths → TC-DELIVERY + jest), Migration & Backward Compatibility (additive; one `modules.ts` entry; not in create-app template), Risks & Impact Review, Final Compliance Report, Changelog.

### Success Criteria:

#### Automated Verification:

- OSS spec exists and contains headings `Data Models`, `API Contracts`, `Integration Coverage`, `Migration & Backward Compatibility` (grep)
- OSS spec contains every UA-01…UA-20 id and the 8 ACL features, 4 event IDs, spot id, context contract, DI service and the 5 internal command IDs (grep loop)
- OSS spec cites `factory.ts` and `registry.ts` for the route map (grep)

#### Manual Verification:

- EXEC/UI/QA owners confirm the frozen paths and error codes are usable for their streams

---

## Phase 2: Enterprise boundary spec and hand-over note

### Overview

Write the boundary-only enterprise spec and the OSS hand-over listing APIs and test files; verify the diff scope.

### Changes Required:

#### 1. Enterprise boundary spec

**File**: `.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md`

**Intent**: Pin what enterprise `delivery_agents` may consume from OSS and the one-directional rule, leaving execution design to EXEC.

**Contract**: Sections — TLDR, Overview, Boundary (consumed commands incl. `automatic` only via trusted internal context, events, DI query, spot/context contract, activation flags), rule "OSS never imports enterprise", Data Models/API Contracts (enterprise `POST /api/delivery_agents/tasks/:id/execute` placeholder from master plan), Integration Coverage (`TC-DELIVERY-EXEC-*` placeholders), Migration & BC, and sections Execution protocol / Workflow definition / Worker & queue / Cezar adapter / Recovery each marked "Pending — to be completed by EXEC".

#### 2. Hand-over note

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-01-api-and-tests.md`, plus a row in `context/changes/delivery-os-oss-domain/change.md`

**Intent**: Short, consumer-oriented list of new APIs (method, path, feature, owning task OSS-02…05) and planned test files per layer (contracts, data, domain rules, commands, routes, integration).

**Contract**: Links both specs; states limitations (paths frozen for v1, DTO executable source pending OSS-02 L1).

### Success Criteria:

#### Automated Verification:

- Enterprise spec exists and marks EXEC sections as pending (grep `Pending — to be completed by EXEC`)
- Hand-over note exists and links both specs (grep)
- `git status --porcelain` shows no path outside `.ai/specs/`, `context/changes/delivery-os-oss-domain/`, `context/changes/asd-oss-t003-oss-01-write-the-oss-and-enterprise/`
- `yarn agents:check-budget` passes (no AGENTS.md edits)

#### Manual Verification:

- EXEC owner reviews the enterprise boundary and completes the pending sections

---

## Testing Strategy

Documentation-only change: verification is structural (grep for required sections/IDs, diff-scope check, agents budget) plus a spot check that each cited `file:line` still resolves (part of 1.3). The specs themselves define the tests later tasks must ship.

## Migration Notes

None — no schema or runtime change in this task.

## References

- Master plan: `context/changes/autonomous-software-delivery/plan.md`
- Workstream: `context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`
- Breakdown: `/Users/mateuszstopinski/Documents/om-hack/autodev/state/BREAKDOWN.md`
- Router: `packages/shared/src/modules/registry.ts:326-426`, `packages/cli/src/lib/generators/module-registry.ts:2431`
- CRUD factory: `packages/shared/src/lib/crud/factory.ts:460-474,622,3084-3088`; `packages/core/src/modules/customers/api/companies/route.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: OSS spec with the frozen route map

#### Automated

- [x] 1.1 OSS spec exists and contains headings `Data Models`, `API Contracts`, `Integration Coverage`, `Migration & Backward Compatibility` (grep)
- [x] 1.2 OSS spec contains every UA-01…UA-20 id and the 8 ACL features, 4 event IDs, spot id, context contract, DI service and the 5 internal command IDs (grep loop)
- [x] 1.3 OSS spec cites `factory.ts` and `registry.ts` for the route map (grep)

#### Manual

- [ ] 1.4 EXEC/UI/QA owners confirm the frozen paths and error codes are usable for their streams

### Phase 2: Enterprise boundary spec and hand-over note

#### Automated

- [x] 2.1 Enterprise spec exists and marks EXEC sections as pending (grep `Pending — to be completed by EXEC`)
- [x] 2.2 Hand-over note exists and links both specs (grep)
- [x] 2.3 `git status --porcelain` shows no path outside `.ai/specs/`, `context/changes/delivery-os-oss-domain/`, `context/changes/asd-oss-t003-oss-01-write-the-oss-and-enterprise/`
- [x] 2.4 `yarn agents:check-budget` passes (no AGENTS.md edits)

#### Manual

- [ ] 2.5 EXEC owner reviews the enterprise boundary and completes the pending sections
