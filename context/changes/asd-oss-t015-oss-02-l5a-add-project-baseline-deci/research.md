---
date: 2026-09-19T05:00:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: aa5ad676a
branch: dev-mateusz
repository: open-mercato
topic: "How the customers reference routes work and how delivery_os routes R1–R13 should call the existing commands"
tags: [research, codebase, delivery_os, api-routes, makeCrudRoute, optimistic-lock]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: delivery_os API routes R1–R13

## Research Question

How do the customers reference routes (`companies/route.ts`, `deals/[id]/route.ts`, custom POST routes with the
mutation guard) and route tests work, and how should R1–R13 call the existing `delivery_os` commands, shared helpers,
validators and `lib/projectStatus.ts`?

Research was done in the main context (hard RAM rule of this machine; same choice as T012–T014).

## Summary

- `makeCrudRoute` with `actions.{create,update,delete}.commandId` delegates writes to the command bus. The factory
  parses `action.schema`, runs `mapInput({ parsed, raw, ctx })`, runs mutation guards, executes the command with the
  `CrudCtx` as the command context and calls `action.response({ result, logEntry, ctx })` (it awaits a promise).
  `CrudHttpError` thrown anywhere (mapInput or command) is returned as `json(err.body, err.status)`; a raw `ZodError`
  becomes `400 { error: 'Invalid input', details }` — so bodies are validated in `mapInput` with `parseDeliveryInput`
  to get the frozen body. The list query schema is parsed by the factory itself, so `pageSize=101` answers the
  factory's `400 { error: 'Invalid input', details }`.
- The factory list reads the platform flag `withDeleted` from the raw query; the spec freezes `includeArchived`.
  A thin GET wrapper can translate one into the other before delegating to `crud.GET`.
- The delivery commands already own scope (`resolveDeliveryScope`), 404 for foreign scope, the platform
  optimistic-lock check (`lockProjectForWrite`, `lockTaskForWrite`), the required project header for baselines and
  decisions (`requireLockHeader`), audit logs, side effects and events. Routes only need to build input, check
  per-source features, run the mutation guard and shape the response.
- Project commands return `{ projectId }` only; R2/R3 need `updatedAt`. Task, baseline and decision commands already
  return everything their routes need.
- The declarative `metadata` guard (401/403) is enforced by the app dispatcher
  (`apps/mercato/src/app/api/[...slug]/route.ts:157-162`), not by handlers. Route tests therefore assert `metadata`
  with the shared wildcard-aware matcher, plus the handler-level 401 and per-source 403.

## Detailed Findings

### makeCrudRoute + commands (`customers/api/companies/route.ts`)

- `routeMetadata` per method, exported as `metadata` and passed to the factory (`:76-86`).
- `orm: { entity, idField, orgField, tenantField, softDeleteField }`, `indexer: { entityType }`, `list: { schema,
  entityId, fields, sortFieldMap, buildFilters, transformItem }` (`:85-385`).
- `actions.create|update|delete` with `commandId`, `schema: rawBodySchema` (passthrough), `mapInput`, `response`,
  `status: 201` for create (`:386-443`). Delete `mapInput` reads the id from body or `?id=` (`:431-440`).
- `export const openApi = createCustomersCrudOpenApi({...})` from `api/openapi.ts` (`createCrudOpenApiFactory`).
- Factory internals: command update path `packages/shared/src/lib/crud/factory.ts:2610-2725`; error mapping
  `:612-622`; list parsing `:1591-1626` (page size clamped to 100 after the schema), `withDeleted` `:1850`, scope
  `:1910-1914` (tenant + selected organization / visible organizations).

### Custom routes (`customers/api/interactions/complete/route.ts`)

- `createRequestContainer()` + `getAuthFromRequest(req)`; 401 when no auth; `resolveOrganizationScopeForRequest`;
  builds `CommandRuntimeContext { container, auth, organizationScope, selectedOrganizationId, organizationIds,
  request }`; `readJsonSafe`; `validateCrudMutationGuard` before and `runCrudMutationGuardAfterSuccess` after;
  `commandBus.execute(id, { input, ctx })`; catch → `isCrudHttpError` → `NextResponse.json(err.body, err.status)`.
- Detail GET (`customers/api/deals/[id]/route.ts:398-445`): `GET(request, { params })`, params validated with zod,
  `findOneWithDecryption`, uniform 404 for a foreign scope.
- In-handler feature check: `rbacService.userHasAllFeatures(auth.sub, [...], { tenantId, organizationId })` with
  `resolveFeatureCheckContext` (`audit_logs/api/audit-logs/actions/redo/route.ts:55-68`) — wildcard-aware, no roles.

### delivery_os building blocks

- `commands/shared.ts`: `resolveDeliveryScope(ctx)`, `deliveryHttpError`, `parseDeliveryInput`,
  `requireScopedProject|Task|Baseline` (404 `not_found`; project/task loaders filter `deletedAt: null`),
  `findScopedProject`.
- `commands/projects.ts`: `.create/.update/.delete`; delete input `{ id | body.id | query.id }`.
- `commands/tasks.ts`: create input `{ projectId, source: 'manual', … }` (`plan_proposal` → 400
  `validation_failed`/`unsupported_source`); result `{ taskId, projectId, status, updatedAt, propagatedTaskIds }`.
- `commands/baselines.ts`: input `{ projectId, source }`; requires the project lock header itself (428).
- `commands/decisions.ts`: input `{ baselineId, kind, verdict, subjectHash, subjectVersion, reason? }`; requires the
  header itself; result carries `activeBaselineId`, `projectUpdatedAt`.
- `data/validators.ts`: `projectCreateSchema`, `projectUpdateSchema`, `projectListQuerySchema`
  (`pageSize ≤ 100`, `includeArchived`), `taskCreateSchema`, `taskUpdateSchema`, `baselineCreateSchema`,
  `baselineDecisionSchema`.
- `lib/projectStatus.ts#deriveProjectStatus({ project, baselines[{id, acIds}], tasks, evidence, decisions })` →
  `{ status, progress { proven, total, unit, percent }, taskCounts, attention }`.

### Tests

- `packages/shared/src/lib/crud/__tests__/crud-factory.test.ts:1-200` shows how to run the REAL factory in jest: mock
  `di/container`, `auth/server`, `directory/utils/organizationScope`, provide `em`, `queryEngine`, `dataEngine`,
  `accessLogService`, `commandBus`.
- `commands/__tests__/baselineTestKit.ts` provides the in-memory store, `matches`, `makeProject`, `makeBaseline`
  and the pattern of mocking `encryption/find` — reusable so route tests run route → real command → fake store.

## Architecture Insights

- Thin routes: every domain rule stays in commands/lib; routes never duplicate validation except to pick the
  feature for a `source` discriminator before the command runs.
- Archived project detail (R5) must load with the scope filter but WITHOUT `deletedAt: null`.

## Historical Context (from prior changes)

- T010–T014 notes (autodev state) fix the route duties: 428 is enforced by commands for baselines/decisions; R12/R13
  and R3/R4 use the platform check inside the command; `taskUpdatedAt`/`project.updatedAt` come from the ORM
  `onUpdate` hook and must be verified over HTTP in this task.

## Open Questions

- None blocking. `requirements_proposal` / `plan_proposal` stay "not yet supported" until OSS-03.
