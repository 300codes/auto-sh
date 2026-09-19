# Delivery OS (hackathon) — OSS domain, contracts and API

> Status: **Draft — contract v1 frozen for hand-over** (OSS-01, T003). Implementation lands in OSS-02 … OSS-05.
> Master plan (source of truth for architecture, scope and acceptance): [`context/changes/autonomous-software-delivery/plan.md`](../../context/changes/autonomous-software-delivery/plan.md).
> Workstream: [`workstreams/01-oss-domain.md`](../../context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md). Enterprise counterpart (boundary only): [`enterprise/2026-09-18-delivery-agents-hackathon.md`](enterprise/2026-09-18-delivery-agents-hackathon.md).

## TLDR

- New OSS module `delivery_os` in `packages/core/src/modules/delivery_os/`: five scoped entities (`DeliveryProject`, `DeliveryBaseline`, `DeliveryTask`, `DeliveryEvidence`, `DeliveryDecision`), versioned DTO v1, commands, ACL (8 features), 4 events, one injection spot and one DI read service.
- Works **without enterprise**: project → baseline → decisions → tasks → reserve attempt → export package → import result → report. Enterprise `delivery_agents` only consumes the public OSS contracts listed here.
- "The Agent Proposes. The System Decides.": agents deliver manifests; OSS validates schema, scope, hashes, versions and test mapping, and humans decide through append-only, hash-bound decisions.
- Additive only: new tables with prefix `delivery_`, new routes under `/api/delivery_os/*`, one new entry in `apps/mercato/src/modules.ts`.

## Overview

The master plan defines a controlled flow from a brief (FROM_BRIEF) or approved screens (FROM_DESIGN) to a verified React preview. This spec is the OSS half: it fixes the data model, the contract names and the **real API paths** so UI, EXEC and QA streams can build in parallel from the H4 hand-over. Rationale lives in the master plan sections *Minimalny model danych*, *Kontrakty między stanowiskami*, *Publiczne operacje prób i decyzji*, *Lifecycle i reguły awarii*, *Testing Strategy* and *Migration & Backward Compatibility*; this spec does not repeat it.

## Problem Statement

A delivery lead today tracks scope in documents, copies requirements into agent prompts and accepts "tests passed" on the agent's word. Nobody can show which commit satisfied which acceptance criterion (AC); a duplicate or late agent result silently overwrites state; a scope change invalidates nothing. The platform needs a deterministic record of what was agreed (baseline), what was asked (TaskPackage), what came back (ResultManifest, evidence), who decided what (decisions) and whether each AC is proven (report).

## Proposed Solution

1. Five entities and JSON sections instead of a CRUD per concept (requirements, AC, questions, risks, ADR, comments are validated sections of `draftSpec` / baseline content).
2. Versioned zod contracts in `delivery_os/lib/contracts.ts` (executable source of truth from OSS-02 L1; this spec fixes the names and fields).
3. All writes go through registered commands (`@open-mercato/shared/lib/commands`) with audit logs, mutation guards and optimistic locking; attempt, accept and decide commands take a row lock (`PESSIMISTIC_WRITE`) on the task or project.
4. Append-only baselines, evidence and decisions: no update or delete command or route exists for them.
5. One-directional boundary: OSS declares the spot `delivery_os.project.execution`, emits events and registers `deliveryOsAttemptQueries`; it never imports or resolves anything from `@open-mercato/enterprise` or `@open-mercato/delivery-cezar`.

## Architecture

### Module layout (OSS-owned)

```
packages/core/src/modules/delivery_os/
  index.ts  acl.ts  setup.ts  events.ts  di.ts  extension-points.ts
  data/entities.ts  data/validators.ts
  lib/contracts.ts  lib/targetProfiles.ts  lib/hash.ts  lib/dag.ts  lib/taskLifecycle.ts
  lib/attempts.ts  lib/resultAcceptance.ts  lib/baseline.ts  lib/designReview.ts  lib/proposals.ts
  lib/allowedPaths.ts  lib/traceability.ts  lib/projectStatus.ts  lib/deliveryReport.ts
  lib/fixtures/{index,builders}.ts  lib/fixtures/*.v1.json  lib/fixtures/negative/*.v1.json
  commands/{projects,tasks,baselines,decisions,attempts,evidence,index}.ts
  api/openapi.ts  api/**/route.ts
  migrations/Migration*.ts  migrations/.snapshot-open-mercato.json
```

UI-owned (not specified here): `backend/delivery/projects/page.tsx`, `backend/delivery/projects/[id]/page.tsx`, `components/`, `i18n/`. QA-owned: `__integration__/TC-DELIVERY-*.spec.ts`.

### Route resolution (evidence for the frozen paths)

| Fact | Evidence |
|---|---|
| A file `packages/core/src/modules/<m>/api/<segs>/route.ts` is served at `/api/<m>/<segs>` | Generator builds `'/' + [modId, ...fullSegs]` — `packages/cli/src/lib/generators/module-registry.ts:2431` |
| `[param]` directories are dynamic segments passed as `context.params` | `matchRoutePattern` — `packages/shared/src/modules/registry.ts:326-356`; handler signature `GET(request, { params })` — `packages/core/src/modules/customers/api/deals/[id]/route.ts:398` |
| Dispatch is method-aware and sorted by specificity, so a collection `route.ts` and a nested `[id]/…/route.ts` coexist | `findApiRouteManifestMatch` — `packages/shared/src/modules/registry.ts:414-426`; catch-all — `apps/mercato/src/app/api/[...slug]/route.ts:344`; reference pair `customers/api/deals/route.ts` + `customers/api/deals/[id]/route.ts` |
| `makeCrudRoute` exposes GET/POST/PUT/DELETE on the **collection** path; PUT reads `id` from the body, DELETE reads `id` from the query (`?id=`) by default | `UpdateConfig` / `DeleteConfig` — `packages/shared/src/lib/crud/factory.ts:460-474`; DELETE id — `factory.ts:3084-3088`; client `deleteCrud` → `/api/${apiPath}?id=` — `packages/ui/src/backend/utils/crud.ts:144`; usage `packages/core/src/modules/customers/api/companies/route.ts:79-80,428-440,500-503` |
| Custom action routes export their own `metadata` + `openApi` and call the mutation guard | `packages/core/src/modules/customers/api/deals/bulk-update-stage/route.ts` |
| Optimistic lock header `x-om-ext-optimistic-lock-expected-updated-at`; conflict code `optimistic_lock_conflict`; 409 body `{error, code, currentUpdatedAt, expectedUpdatedAt}` | `packages/shared/src/lib/crud/optimistic-lock-headers.ts:15,17`; `packages/shared/src/lib/crud/optimistic-lock.ts:256-263` |

**Consequences (frozen):**

- Project and task **update/delete use the platform CRUD convention**: `PUT /api/delivery_os/projects` (`id` in body), `DELETE /api/delivery_os/projects?id=`, `PUT /api/delivery_os/tasks`, `DELETE /api/delivery_os/tasks?id=`. The master plan's `/projects/:id` and `/tasks/:id` PUT/DELETE map to these; `/projects/:id` and `/tasks/:id` keep **GET detail** only.
- Task creation and listing stay at `/projects/:id/tasks` (they need the project scope and the `source` discriminator); `api/tasks/route.ts` exports **PUT and DELETE only**.
- Custom actions keep the master-plan paths as nested `[id]` routes. No static directory is placed next to an `[id]` directory, so no path is ambiguous.

### OSS/enterprise boundary

- OSS → enterprise: nothing. `delivery_os` has no import of `@open-mercato/enterprise/**` or `@open-mercato/delivery-cezar`; guarded by `packages/core/src/__tests__/module-decoupling.test.ts` and a grep in the OSS-06 gate.
- Enterprise → OSS: commands through the command bus, events, the DI service `deliveryOsAttemptQueries`, the injection spot and the DTOs from `@open-mercato/core/modules/delivery_os/lib/contracts`. Details in the enterprise spec.
- Without enterprise, `workflowRef` stays empty, `completionDelivery` stays `null`, and the UI does not suggest that automation ran.

## Data Models

Common to all five tables: `id uuid pk`, `tenant_id uuid not null`, `organization_id uuid not null`, `created_at timestamptz not null`. Every read and write filters by both scope columns taken from the session, never from a body or manifest. No ORM relations — foreign keys are plain uuid columns, and relations to other modules (attachments, users) are ids plus snapshots.

### `delivery_projects` — `DeliveryProject` (editable, optimistic lock)

| Column | Type | Notes |
|---|---|---|
| `name` | text not null | |
| `input_mode` | text not null | `from_brief` \| `from_design` |
| `brief` | text null | |
| `target_profile_id` / `target_profile_version` | text / int not null | must exist in `lib/targetProfiles.ts` |
| `repository_ref` | text null | label of the station-configured repo; never a URL with credentials |
| `draft_spec` | jsonb not null default `{}` | `DraftSpec v1`: requirements, AC (stable ids), questions, risks, ADR, screen refs, comments with optional 0–1 anchors |
| `active_baseline_id` | uuid null | set only by the decision command when requirements **and** design are approved for the same baseline hash |
| `limits` | jsonb not null | `{ maxParallelTasks: 2, maxCorrectionRounds: 2, attemptTimeoutMinutes: 20 }` defaults |
| `updated_at` | timestamptz not null | optimistic lock token |
| `deleted_at` | timestamptz null | archive = soft delete |

Indexes: `(tenant_id, organization_id, deleted_at)`, `(tenant_id, organization_id, created_at)`.

### `delivery_baselines` — `DeliveryBaseline` (append-only)

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid not null | |
| `version` | int not null | n+1 per project |
| `content_hash` | text not null | sha256 hex of canonical JSON of `content` |
| `source` | text not null | `manual` \| `requirements_proposal` \| `plan_proposal` |
| `parent_baseline_id` | uuid null | merged baseline points to its parent |
| `content` | jsonb not null | `BaselineContent v1` (requirements, AC, screens with `attachmentId` + `sha256` + file/node refs + `capturedAt` + optional `figmaVersion`, design tokens, architecture/plan summary, `acTestMap: { [acId]: requiredTestIds[] }`, `manualChecks: { [acId]: manualCheckId }` (AC judged by a human; never a fake automated test), resolved comments, `importedManifestHashes[]`) |
| `attachment_ids` | jsonb not null default `[]` | verified against the attachments module (scope, hash, size, type) |
| `created_by` | uuid null | |

Unique: `(tenant_id, organization_id, project_id, version)`; `(tenant_id, organization_id, project_id, content_hash)` — identical content returns the existing row (`duplicate: true`). No `updated_at`: rows are never updated.

### `delivery_tasks` — `DeliveryTask` (editable, optimistic lock)

| Column | Type | Notes |
|---|---|---|
| `project_id`, `baseline_id` | uuid not null | task is pinned to one baseline version |
| `title`, `description` | text | |
| `ac_ids` | jsonb not null | AC ids that must exist in the pinned baseline |
| `depends_on_task_ids` | jsonb not null default `[]` | same project and baseline; DAG enforced |
| `allowed_paths` | jsonb not null default `[]` | repo-relative globs; no absolute paths, no `..` |
| `target_profile_id` / `target_profile_version` | text / int not null | copied from project at creation |
| `status` | text not null | `draft` `ready` `executing` `awaiting_review` `changes_requested` `verified` `blocked` `cancelled` |
| `status_reason` | text null | `reconciliation_required`, `dependency_blocked`, `correction_limit_reached` |
| `attempt_number` | int not null default 0 | |
| `execution_attempts` | jsonb not null default `[]` | `ExecutionAttempt v1[]`, max 16 entries, at most one active |
| `proposal_task_key` | text null | stable key from a plan proposal |
| `updated_at`, `deleted_at` | timestamptz | |

Indexes: `(tenant_id, organization_id, project_id, deleted_at)`; **partial unique** `(tenant_id, organization_id, project_id, baseline_id, proposal_task_key) WHERE proposal_task_key IS NOT NULL` — re-importing a plan does not duplicate tasks.

`ExecutionAttempt v1` fields: `attemptId`, `idempotencyKey`, `payloadHash`, `mode` (`manual_handoff` \| `automatic`), `state` (`reserved` `claimed` `result_received` `cancel_requested` `reconciliation_required` `closed`), `baselineId`, `baselineHash`, `baseRevision` (`SourceRevision`), `baseCommit` (git profiles only), `reservedAt`, `claimedAt`, `workerRef`, `externalRunId`, `workflowRef`, `workflowStepId`, `dispatchedAt`, `cancellationRequestedAt`, `stopConfirmation` (`stop_unconfirmed` \| `stopped` \| null), `reconciliation` (`{resolution, note, observedAt, actorUserId, resolvedAt}` \| null), `resultEvidenceId`, `completionDelivery` (`pending` \| `delivered` \| null), `lastDeliveryError`, `closedAt`, `outcome` (`result_accepted` \| `cancelled` \| `not_started` \| `stopped` \| null). "Active" = `reserved` \| `claimed` \| `cancel_requested`; `reconciliation_required` also blocks a new reservation and archive.

### `delivery_evidence` — `DeliveryEvidence` (append-only)

| Column | Type | Notes |
|---|---|---|
| `project_id`, `baseline_id` | uuid not null | |
| `task_id` | uuid null | |
| `attempt_id` | uuid null | |
| `kind` | text not null | `result_manifest` `test` `review` `screenshot` `deployment` `scan` `reference_material` |
| `source` | text not null | `adapter` \| `manual` |
| `source_revision` | jsonb null | `SourceRevision` |
| `payload` | jsonb not null | kind-specific, validated by discriminated union |
| `payload_hash` | text not null | sha256 of canonical payload |
| `raw_report_hash` | text null | sha256 of raw report bytes (tests, scans) |
| `attachment_ids` | jsonb not null default `[]` | |
| `recorded_by` | uuid null | importing actor |

Indexes: `(tenant_id, organization_id, project_id, kind)`, `(tenant_id, organization_id, task_id)`, `(tenant_id, organization_id, project_id, kind, payload_hash)`; **partial unique** `(tenant_id, organization_id, task_id, attempt_id) WHERE kind = 'result_manifest'` — a concurrent double import yields one row and the unique violation is recovered as `duplicate`. Check constraint `delivery_evidence_result_manifest_attempt_chk`: a `result_manifest` row must carry both `task_id` and `attempt_id` (NULLs would otherwise escape the unique index).

`reference_material` never counts as AC evidence (e.g. an uncorrelated historical WordPress report).

### `delivery_decisions` — `DeliveryDecision` (append-only)

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid not null | |
| `kind` | text not null | `requirements` `design` `deploy` `release` (a scope change is a new baseline, not a decision kind) |
| `subject_type` / `subject_id` | text / uuid not null | `baseline` \| `deployment_evidence` |
| `subject_hash` | text not null | baseline `content_hash` or evidence `payload_hash` |
| `subject_version` | int null | baseline version |
| `source_revision` | jsonb null | deploy/release: the revision being published |
| `verdict` | text not null | `approved` \| `rejected` |
| `reason` | text null | required when `rejected` |
| `actor_user_id` | uuid not null | |
| `decided_at` | timestamptz not null | |

Index: `(tenant_id, organization_id, project_id, kind, decided_at)`. Latest decision per `(kind, subject_hash)` wins: a later reject voids an earlier approve.

## Contracts v1 (names frozen; executable schemas in `lib/contracts.ts`)

`DELIVERY_CONTRACT_VERSION = 1`. Every document carries a typed `schemaVersion` string; an unknown value is rejected with `422 unsupported_schema_version`, and a document of another type cannot be posted in its place.

| Contract | `schemaVersion` | Key fields |
|---|---|---|
| `SourceRevision` | — | `{ kind: 'git', commitSha }` \| `{ kind: 'snapshot', contentHash, externalWorkspaceId }`; profile decides which kind is allowed |
| `TaskPackage v1` | `delivery.task-package/v1` | `projectId, taskId, attemptId, title, description?, baselineId, baselineHash, targetProfileId, targetProfileVersion, requirements[], acceptanceCriteria[], designArtifactRefs[], repositoryRef, baseRevision, baseCommit (git only; absent for snapshot), allowedPaths[], validationProfile { version, requiredTests: {acId: testId[]}, checks[] }, limits, idempotencyKey` |
| `ResultManifest v1` | `delivery.result-manifest/v1` | correlation (`projectId, taskId, attemptId, baselineId, baselineHash, targetProfileVersion`), `externalRunId, baseRevision, resultRevision, baseCommit, resultCommit` (commits required for git profiles, absent for snapshot; the revision fields are always required), `changedPaths[], artifacts[{path, sha256}], checks[{checkId, testId, acIds[], commandProfileId, validationProfileVersion, testDefinitionHash, status: passed/failed/not_run` (a runner `skipped`/`todo` is reported as `not_run`), `exitCode, durationMs, sourceRevision, rawReportHash}], agentDeclaration (separate, never evidence), findings[], usage { source, values \| 'unknown' }` |
| `BaselineContent v1` | `delivery.baseline-content/v1` | see `delivery_baselines.content` |
| `RequirementsProposal v1` | `delivery.requirements-proposal/v1` | `projectId, manifestId, requirements[], acceptanceCriteria[], questions[], risks[], producedBy {tool, sessionRef}` |
| `PlanProposal v1` | `delivery.plan-proposal/v1` | `projectId, baselineId, baselineHash, manifestId, architectureSummary, tasks[{proposalTaskKey, title, description, acIds[], dependsOn[], allowedPaths[]}], acTestMap, declaredTests[{testId, file}]` |
| `DesignManifest v1` | `delivery.design-manifest/v1` | `screens[{fileKey, nodeId, name, viewport, attachmentId, sha256, capturedAt, figmaVersion?}], tokens` |
| `DeliveryReport v1` | `delivery.report/v1` | per requirement → AC → tasks → revision → checks → deployment; AC status `passed/failed/not_run/missing/manual_pending`; deployment `verified/unverified/missing`; scans; decisions with `appliesToRevision`; `progress { proven, total, unit: 'ac' }` |
| `ExecutionWidgetContext v1` | `delivery_os.project.execution.v1` | see *Extension spot* |
| `ReserveAttemptRequest` | — (route body of R14) | `{ mode: 'manual_handoff', baseRevision: SourceRevision }` — `reserveAttemptRequestSchema` |
| `ReserveAttemptResponse` | — (R14 response) | `{ attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl }`; `packageUrl` must equal `buildPackageUrl(taskId, attemptId)` — `reserveAttemptResponseSchema` |
| `DeliveryEvidenceKind` | — | `result_manifest test review screenshot deployment scan reference_material` — `deliveryEvidenceKindSchema` |

Target profiles (data only, `lib/targetProfiles.ts`; a profile change is a new profile version, never an edit):

| Profile | `revisionKind` | `allowedPathRoots` | Checks (`checkId` → command profile) | Required evidence | Extra permitted evidence |
|---|---|---|---|---|---|
| `react-vite@1` | git | `src/**`, `public/**`, `tests/**`, `index.html` | `unit-tests` (vitest `npm run test:report`), `build` (`npm run build` = `tsc -b && vite build`, so it is also the typecheck), `lint` (`npm run lint`), `dependency-audit` scan (`npm audit --audit-level=high`) | result_manifest, test, scan, deployment | review, screenshot |
| `open-mercato-module@1` | git | `src/modules/**` | `unit-tests` (jest), `typecheck`, `dependency-audit` scan | result_manifest, test, scan | review, screenshot, deployment |
| `wordpress-theme@1` | snapshot | theme files (`style.css`, `theme.json`, `functions.php`, `templates/**`, `parts/**`, `patterns/**`, `assets/**`, `inc/**`, `tests/**`) | `smoke-tests` (playwright), `lint` (php) | result_manifest, screenshot | test, review, deployment, scan, **reference_material** |

Helpers: `getTargetProfile(id, version)` (`undefined` if unknown → routes answer `422 unknown_target_profile`), `assertRevisionKind(profile, revision)` (`422 revision_kind_mismatch`), `checkAllowedPathsForProfile(profile, paths)` (`422 path_not_allowed` for `..`, absolute, or outside the roots), `isEvidenceKindPermitted`, `countsAsAcEvidence` (only `result_manifest`, `test`, `review`; `reference_material` never counts). All helpers return `{ ok: true } | { ok: false, status, body }` (`DeliveryCheckResult`). Pure domain helpers already landed with the fixtures: `lib/resultAcceptance.ts#checkResultCorrelation` (UA-12 step 3: `correlation_mismatch`, `baseline_mismatch`, `base_revision_mismatch`) and `lib/dag.ts#findDependencyCycle` / `checkAcyclic` (`cycle`).

Fixtures (`lib/fixtures/`, import from `@open-mercato/core/modules/delivery_os/lib/fixtures/index` — the package export map has no folder-index fallback; the JSON-free builder is `…/lib/fixtures/builders`; the JSON loaders work under jest and bundlers, not from `dist` under plain Node ESM): positive `task-package`, `task-package.snapshot` (WP), `result-manifest`, `result-manifest.snapshot` (WP), `baseline-content`, `requirements-proposal`, `plan-proposal`, `design-manifest`, `execution-widget-context` (data only; `buildExecutionWidgetContextFixture()` adds the callbacks), `reserve-response`, `error-body`; typed loaders parse through the published schema and return fresh copies. Negative fixtures in `lib/fixtures/negative/` are self-describing wrappers `{ description, expected: { stage, code, status }, documentType, correlatesWith?, targetProfile?, document }` where `stage` is `schema | profile | correlation | dag | idempotency`. `buildResultManifest(taskPackage, overrides)` is a deterministic fake-executor builder (no clock, no randomness; `checkStatus`, `resultRevision` and `baseRevision` overrides). Expected codes are for the labelled stage in isolation; through a route, earlier stages run first (UA-12 order), see the hand-over note for the route-level mapping.

## Access Control

`acl.ts` features (wildcards resolved by platform helpers; no role names in checks):

| Feature | Grants |
|---|---|
| `delivery_os.projects.view` | read projects, baselines, tasks, evidence, report |
| `delivery_os.projects.manage` | create/edit/archive projects and tasks, create manual baselines, task transitions |
| `delivery_os.baselines.approve` | requirements/design decisions |
| `delivery_os.results.import` | import results, record evidence, import requirements/plan proposals |
| `delivery_os.attempts.manage` | reserve and cancel attempts, export packages |
| `delivery_os.attempts.reconcile` | reconcile an attempt |
| `delivery_os.deploy.approve` | publish consent (deploy decision) |
| `delivery_os.release.approve` | final acceptance (release decision) |

`setup.ts` `defaultRoleFeatures`: `admin` → `delivery_os.*`; `employee` → `delivery_os.projects.view`, `delivery_os.projects.manage`, `delivery_os.results.import`.

## Events (`events.ts`, `createModuleEvents`)

| Event ID | Payload | Notes |
|---|---|---|
| `delivery_os.project.created` | `{ projectId, tenantId, organizationId }` | |
| `delivery_os.baseline.approved` | `{ projectId, baselineId, version, contentHash, activeBaselineId, tenantId, organizationId }` | emitted when `activeBaselineId` changes |
| `delivery_os.task.updated` | `{ projectId, taskId, status, statusReason?, updatedAt, tenantId, organizationId }` | `clientBroadcast: true` for live status |
| `delivery_os.evidence.recorded` | `{ projectId, taskId?, attemptId?, evidenceId, kind, duplicate, completionDelivery?, tenantId, organizationId }` | re-emitted on duplicate result import so enterprise retries a pending delivery; `clientBroadcast: true` |

`?` = nullable (`statusReason` is null for most statuses; evidence without a task/attempt; `completionDelivery` is `null` without enterprise). Every payload carries `tenantId` and `organizationId`, and commands MUST also pass them as trusted emit options (`emitDeliveryOsEvent(id, payload, { tenantId, organizationId })`) — the SSE bridge drops a broadcast event with no tenant scope. Emit the events from commands only; do not configure `makeCrudRoute` `events` for these entities (its default CRUD payload would not match). Declared in `events.ts` with typed `payloadSchema`s; `DELIVERY_OS_EVENT_IDS`, `emitDeliveryOsEvent`, `DeliveryOsEventId` are exported.

## Extension spot

`extension-points.ts`: `injectionExtensionHost({ spotId: 'delivery_os.project.execution', contextContract: 'delivery_os.project.execution.v1', source: 'backend/delivery/projects/[id]/page.tsx', … })` via `defineModuleExtensionPoints` (`packages/shared/src/modules/widgets/extension-points.ts:121-143`). The UI stream renders the `InjectionSpot` on the project detail page.

Context `delivery_os.project.execution.v1`: `{ schemaVersion: 'delivery_os.project.execution.v1', projectId, taskId: string | null, baselineId: string | null, updatedAt, retryLastMutation, refresh }` — `refresh()` reloads host data after a widget mutation.

## DI service

`di.ts` registers `deliveryOsAttemptQueries` (read-only, scope `{ tenantId, organizationId }` always required):

- `getAttempt(scope, taskId, attemptId)` → `ExecutionAttempt | null`
- `buildTaskPackage(scope, taskId, attemptId)` → `TaskPackage v1` (same builder as `GET …/package`, no writes)
- `listPendingDeliveries(scope, { limit })` → `{ taskId, attemptId, evidenceId, workflowRef, workflowStepId }[]` where `completionDelivery = 'pending'`

## Commands

| Command ID | Invoked by | Notes |
|---|---|---|
| `delivery_os.projects.create` / `.update` / `.delete` | CRUD route | delete = archive guard + soft delete, no cascade |
| `delivery_os.tasks.create` / `.update` / `.delete` | routes | DAG, AC and transition validation |
| `delivery_os.baselines.create` | route | manual and requirements-proposal sources |
| `delivery_os.tasks.import_plan` | route | merged baseline + tasks in one transaction |
| `delivery_os.decisions.record` | route | requirements/design, deploy, release |
| `delivery_os.evidence.record` | route | generic evidence (not results) |
| `delivery_os.attempts.cancel` / `.reconcile` | routes | |
| **`delivery_os.attempts.reserve`** | route + enterprise | public route only passes `mode: 'manual_handoff'`; `mode: 'automatic'` is accepted **only** when invoked in-process without `ctx.request` **and** with the typed internal option `trustedExecution: { source: 'delivery_agents', actorUserId }`; the route builds the command input itself from the literal-validated body, so it can produce neither |
| **`delivery_os.attempts.claim`** | enterprise (internal) | conditional claim: sets `claimedAt`, `workerRef` exactly once |
| **`delivery_os.attempts.link_workflow`** | enterprise (internal) | sets `workflowRef`, `workflowStepId`, `dispatchedAt` |
| **`delivery_os.attempts.mark_delivery`** | enterprise (internal) | `delivered` or `lastDeliveryError`; serialized per attempt under the task row lock |
| **`delivery_os.results.accept`** | route (`source: manual`) + enterprise worker (`source: adapter`) | implemented in `commands/evidence.ts`; one validation path; writes evidence, `resultEvidenceId`, `completionDelivery = 'pending'` when `workflowRef` is set, and task status, atomically |

Internal commands have no HTTP route.

## API Contracts

Base path `/api/delivery_os`. Every route: `requireAuth: true` + `requireFeatures` below, `openApi` export, mutation guard on writes. **Lock** = `x-om-ext-optimistic-lock-expected-updated-at` of the named record; *required* means a missing header returns `428 optimistic_lock_required`, a stale one `409 optimistic_lock_conflict` (platform body). **Replay before lock:** for idempotent operations (R7/R10 proposals by `manifestId` + hash, R14 by `Idempotency-Key`) the stored result is compared first; an identical replay returns `200 … duplicate: true` / the existing attempt even when the lock header is stale or missing.

### Route map

| # | Method | Path | File | Feature | Lock |
|---|---|---|---|---|---|
| R1 | GET | `/projects` | `api/projects/route.ts` (makeCrudRoute) | projects.view | — |
| R2 | POST | `/projects` | same | projects.manage | — |
| R3 | PUT | `/projects` (`id` in body) | same | projects.manage | project (platform) |
| R4 | DELETE | `/projects?id=` | same | projects.manage | project (platform) |
| R5 | GET | `/projects/:id` | `api/projects/[id]/route.ts` | projects.view | — |
| R6 | GET | `/projects/:id/baselines` | `api/projects/[id]/baselines/route.ts` | projects.view | — |
| R7 | POST | `/projects/:id/baselines` | same | `source: manual` → projects.manage; `source: requirements_proposal` → results.import | project, required |
| R8 | POST | `/baselines/:id/decisions` | `api/baselines/[id]/decisions/route.ts` | baselines.approve | project, required |
| R9 | GET | `/projects/:id/tasks` | `api/projects/[id]/tasks/route.ts` | projects.view | — |
| R10 | POST | `/projects/:id/tasks` | same | `source: manual` → projects.manage; `source: plan_proposal` → results.import | manual: —; proposal: project, required |
| R11 | GET | `/tasks/:id` | `api/tasks/[id]/route.ts` | projects.view | — |
| R12 | PUT | `/tasks` (`id` in body) | `api/tasks/route.ts` (makeCrudRoute, PUT/DELETE only) | projects.manage | task (platform) |
| R13 | DELETE | `/tasks?id=` | same | projects.manage | task (platform) |
| R14 | POST | `/tasks/:id/attempts` | `api/tasks/[id]/attempts/route.ts` | attempts.manage | task, required for a new key; `Idempotency-Key` header required |
| R15 | GET | `/tasks/:id/package?attemptId=` | `api/tasks/[id]/package/route.ts` | attempts.manage | — |
| R16 | POST | `/tasks/:id/results` | `api/tasks/[id]/results/route.ts` | results.import | — (idempotent by attempt + manifest hash) |
| R17 | POST | `/tasks/:id/attempts/:attemptId/cancel` | `api/tasks/[id]/attempts/[attemptId]/cancel/route.ts` | attempts.manage | task, required |
| R18 | POST | `/tasks/:id/attempts/:attemptId/reconcile` | `api/tasks/[id]/attempts/[attemptId]/reconcile/route.ts` | attempts.reconcile | task, required |
| R19 | POST | `/projects/:id/evidence` | `api/projects/[id]/evidence/route.ts` | results.import | — |
| R20 | POST | `/projects/:id/deploy-decisions` | `api/projects/[id]/deploy-decisions/route.ts` | deploy.approve | project, required |
| R21 | POST | `/projects/:id/release-decisions` | `api/projects/[id]/release-decisions/route.ts` | release.approve | project, required |
| R22 | GET | `/projects/:id/report?baselineId=&revision=` | `api/projects/[id]/report/route.ts` | projects.view | — |

Features above are abbreviated; the full id is `delivery_os.<feature>`.

### Operations per user action (UA-01 … UA-20)

| UA | Route | Request | Success | Errors (status `code`) |
|---|---|---|---|---|
| UA-01 create project | R2 | `{ name, inputMode, brief?, targetProfileId, repositoryRef?, limits? }` | `201 { id, updatedAt }`; emits `project.created` | 400 `validation_failed`; 422 `unknown_target_profile`; 403 `forbidden` |
| UA-02 list / open | R1, R5, R9, R11 | list: `page, pageSize ≤ 100, search?, includeArchived=false` | R1 `200 { items, total, page, pageSize, totalPages }`; R5 `200 ProjectDetail { …, updatedAt, status, progress {proven,total,unit}, activeBaselineId }`; R9 `200 { items: TaskDto[], total }`; R11 `200 TaskDto { …, updatedAt, executionAttempts }` | 404 `not_found` (also foreign scope) |
| UA-03 edit project / draft | R3 | `{ id, name?, brief?, draftSpec?, limits? }` | `200 { ok: true, updatedAt }` | 400 `validation_failed`; 409 `optimistic_lock_conflict`; 422 `duplicate_stable_id`, `invalid_comment_anchor`; 404 |
| UA-04 archive | R4, R13 | `?id=` | `200 { ok: true }` | 409 `attempt_active`, `reconciliation_required`, `optimistic_lock_conflict`; 404 |
| UA-05 manual baseline | R7 | `{ source: 'manual' }` (built from `draftSpec`) | `201 { baselineId, version, contentHash, duplicate: false }`; `200 { …, duplicate: true }` on identical content | 422 `missing_acceptance_criteria`, `missing_render`, `temporary_url_only`, `attachment_scope_mismatch`, `attachment_hash_mismatch`; 428; 409 lock; 404 |
| UA-06 requirements proposal | R7 | `{ source: 'requirements_proposal', manifest: RequirementsProposal v1 }` | `201 { baselineId, version, contentHash, duplicate }`; the same transaction copies the content into `draftSpec` | 422 `unsupported_schema_version`, `foreign_reference`, `duplicate_stable_id`; 409 `idempotency_conflict` (same `manifestId`, different hash); 200 `duplicate: true` on re-import |
| UA-07 plan proposal | R10 | `{ source: 'plan_proposal', manifest: PlanProposal v1 }` | `201 { baselineId (merged, new version), tasks: [{ id, proposalTaskKey, updatedAt }], duplicate }` | 422 `baseline_not_approved`, `foreign_reference`, `unknown_ac`, `path_not_allowed`, `unknown_test_id`, `cycle`, `unsupported_schema_version`; 409 `idempotency_conflict`; 200 `duplicate: true` |
| UA-08 manual task / edit | R10, R12 | `{ source: 'manual', baselineId, title, description?, acIds, dependsOnTaskIds?, allowedPaths? }` / `{ id, …same fields }` | `201 { id, updatedAt }` / `200 { ok, updatedAt }`; emits `task.updated` | 422 `cycle`, `foreign_dependency`, `unknown_ac`, `path_not_allowed`, `foreign_reference`; 409 `optimistic_lock_conflict`; 404 |
| UA-09 set ready / block / cancel | R12 with `{ id, status }` | user-settable: `draft`, `ready`, `blocked`, `cancelled`; `executing`, `awaiting_review`, `changes_requested`, `verified` are set only by attempt/result/review commands | `200 { ok, updatedAt, status }` | 422 `baseline_not_approved`, `missing_render`, `missing_required_tests`; 409 `invalid_transition` (e.g. `status: 'verified'` through R12), `optimistic_lock_conflict` |
| UA-10 reserve | R14 | headers `Idempotency-Key`, lock; body `{ mode: 'manual_handoff', baseRevision: SourceRevision }` | `201 { attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl }` (`packageUrl = /api/delivery_os/tasks/:id/package?attemptId=…`); same key + payload → `200` same body (checked **before** the lock) | 400 `idempotency_key_required`, `validation_failed` (incl. `mode: 'automatic'`); 409 `idempotency_conflict`, `attempt_active`, `attempt_limit_reached`, `dependency_not_verified`, `task_not_ready`, `reconciliation_required`, `optimistic_lock_conflict`; 422 `revision_kind_mismatch`; 428 |
| UA-11 export package | R15 | `?attemptId=` | `200 TaskPackage v1`; **no writes** | 404 `attempt_not_found` (nothing created); 409 `attempt_cancelled`, `attempt_closed` |
| UA-12 import result | R16 | `{ attemptId, manifest: ResultManifest v1 }` | `201 { evidenceId, duplicate: false, taskStatus: 'awaiting_review', taskUpdatedAt }`; identical replay → `200 { …, duplicate: true }` and `evidence.recorded` re-emitted. Order: scope (foreign → 404) → schema → **idempotency** (identical accepted manifest wins over `attempt_closed`/`attempt_cancelled`; different hash → 409) → correlation → `allowedPaths` → checks and hashes → one transaction | 409 `result_conflict`, `attempt_cancelled`, `attempt_closed`, `reconciliation_required`; 422 `unsupported_schema_version`, `correlation_mismatch`, `baseline_mismatch`, `base_revision_mismatch`, `revision_kind_mismatch`, `path_not_allowed`, `attachment_hash_mismatch`; 413 `payload_too_large`; 404 |
| UA-13 record evidence | R19 | `{ kind, taskId?, attemptId?, baselineId, sourceRevision?, payload, attachmentIds? }` (discriminated by `kind`) | `201 { evidenceId, duplicate, taskStatus?, taskUpdatedAt? }`; review with verdict `changes_requested` moves `awaiting_review → changes_requested` (after `limits.maxCorrectionRounds` it moves to `blocked`); review with verdict `approved` moves `awaiting_review → verified` **only** if the task has an accepted result for its pinned baseline and every AC of the task is proven on that `resultRevision` (all `requiredTestIds` passed, manual checks approved), otherwise 422 `missing_required_tests`; a review with `manualCheckId` records the human verdict for a manual AC; deployment stored `unverified` unless verification evidence is included | 422 `unknown_ac`, `unknown_test_id`, `hash_mismatch`, `deployment_incomplete`, `revision_kind_mismatch`, `unsupported_evidence_kind`, `missing_required_tests`, `baseline_mismatch`; 409 `invalid_transition`; 404 |
| UA-14 read an error | any | — | — | body `{ error, code, details[] }`, see catalogue |
| UA-15 requirements/design decision | R8 | `{ kind: 'requirements' \| 'design', verdict, subjectHash, subjectVersion, reason? }` | `201 { decisionId, activeBaselineId, projectUpdatedAt }`; emits `baseline.approved` when `activeBaselineId` changes | 409 `subject_hash_mismatch`, `optimistic_lock_conflict`; 422 `reason_required`; 403; 404 |
| UA-16 deploy decision | R20 | `{ baselineId, sourceRevision, verdict, reason? }` | `201 { decisionId, projectUpdatedAt }` | 422 `report_not_green` (details = blocking AC/checks), `baseline_not_active`, `reason_required`; 409 lock; 428 |
| UA-17 release decision | R21 | `{ deploymentEvidenceId, verdict, reason? }` | `201 { decisionId, projectUpdatedAt }` | 422 `deployment_unverified`, `revision_mismatch`, `deploy_decision_missing`, `report_not_green`, `reason_required` (reject is always allowed with a reason); 409 lock; 428 |
| UA-18 cancel attempt | R17 | `{ reason? }` | `200 { attemptId, state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed', taskStatus, taskUpdatedAt }` | 409 `attempt_not_active`, `optimistic_lock_conflict`; 428; 404 |
| UA-19 reconcile | R18 | `{ resolution: 'not_started' \| 'stopped' \| 'completed' \| 'unknown', externalEvidence: { note, observedAt, externalRunId? }, manifest? }` | `200 { attemptId, resolution, taskStatus, taskUpdatedAt, evidenceId? }`; `not_started` / `stopped` → attempt `closed`, task back to `ready` (or `changes_requested` if it came from a correction round); `completed` → same validation as UA-12, task ends `awaiting_review` (never `verified`); `unknown` → task `blocked` / `reconciliation_required` | 422 `manifest_required` + UA-12 codes; 409 `attempt_not_reconcilable`, `optimistic_lock_conflict`; 428 |
| UA-20 report | R22 | `baselineId?` (default active), `revision?` (default latest integration revision) | `200 DeliveryReport v1` (archived projects stay readable) | 404; 422 `invalid_revision` |

### Error body and code catalogue

All `delivery_os` errors use `{ error: string, code: string, details: Array<{ path?: string, code: string, message?: string }> }`. `error` is an `[internal]`-free human message in English; the UI maps `code` to i18n keys (`delivery_os.errors.<code>`, UI-owned). CRUD routes (R1–R4, R12, R13) validate inside `mapInput` and throw `CrudHttpError(400, …)` so they return the same body instead of the factory default `{ error: 'Invalid input', details }` (`factory.ts:622`). Exception: the optimistic-lock 409 keeps the platform body `{ error, code: 'optimistic_lock_conflict', currentUpdatedAt, expectedUpdatedAt }`.

| Status | Code | Meaning |
|---|---|---|
| 400 | `validation_failed` | body/query shape invalid (zod issues in `details`) |
| 400 | `idempotency_key_required` | reserve without `Idempotency-Key` |
| 403 | `forbidden` | missing feature (platform guard) |
| 404 | `not_found` | record missing, archived for write, or in another tenant/org (never reveals existence) |
| 404 | `attempt_not_found` | unknown `attemptId` for this task |
| 409 | `optimistic_lock_conflict` | stale `updatedAt` (platform body) |
| 409 | `idempotency_conflict` | same key / manifest id with a different payload hash |
| 409 | `attempt_active` | task already has an active attempt, or archive with an active attempt/task |
| 409 | `attempt_limit_reached` | 16 attempts recorded |
| 409 | `attempt_not_active` / `attempt_not_reconcilable` | cancel/reconcile on a terminal attempt |
| 409 | `attempt_cancelled` / `attempt_closed` | package or result for a cancelled/closed attempt |
| 409 | `reconciliation_required` | state unknown after restart; blocks reserve and archive |
| 409 | `dependency_not_verified` | a dependency is not `verified` |
| 409 | `task_not_ready` | reserve outside `ready` / `changes_requested` |
| 409 | `invalid_transition` | status change not allowed by the lifecycle table |
| 409 | `result_conflict` | different manifest hash for an attempt that already has a result |
| 409 | `subject_hash_mismatch` | decision for a baseline hash/version that is not the stored one |
| 409 | `correction_limit_reached` | `limits.maxCorrectionRounds` correction rounds already used; the task escalates to a human (only `cancelled` is allowed from `blocked/correction_limit_reached`) |
| 413 | `payload_too_large` | manifest or attachment above limits |
| 422 | `unsupported_schema_version` | unknown or wrong-type `schemaVersion` |
| 422 | `unknown_target_profile` | profile id/version not in `targetProfiles.ts` |
| 422 | `foreign_reference` | reference to another project/baseline/tenant |
| 422 | `unknown_ac` / `unknown_test_id` | AC or test not in the pinned baseline / declared catalogue |
| 422 | `cycle` / `foreign_dependency` | dependency graph invalid |
| 422 | `path_not_allowed` | absolute path, `..`, or path outside `allowedPaths` |
| 422 | `duplicate_stable_id` / `invalid_comment_anchor` | draft validation |
| 422 | `missing_acceptance_criteria` / `missing_render` / `temporary_url_only` / `missing_required_tests` | baseline, ready or verified gate incomplete |
| 422 | `attachment_scope_mismatch` / `attachment_hash_mismatch` / `hash_mismatch` | attachment or report hash does not verify |
| 422 | `baseline_not_approved` / `baseline_not_active` | decisions missing for the baseline hash |
| 422 | `correlation_mismatch` / `baseline_mismatch` / `base_revision_mismatch` / `revision_kind_mismatch` | result does not match the reserved attempt or profile |
| 422 | `manifest_required` | reconcile `completed` without a manifest |
| 422 | `reason_required` | reject without reason |
| 422 | `report_not_green` / `deployment_unverified` / `deployment_incomplete` / `revision_mismatch` / `deploy_decision_missing` / `invalid_revision` | publish/release gates |
| 422 | `unsupported_evidence_kind` | unknown evidence discriminator |
| 428 | `optimistic_lock_required` | required lock header missing |

## Integration Coverage

QA owns the Playwright specs (`packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-NNN.spec.ts`, titles prefixed `TC-DELIVERY`, run with `yarn test:integration --grep 'TC-DELIVERY'`). OSS owns jest tests next to the code (run with `yarn workspace @open-mercato/core jest <path> --maxWorkers=2`). Every spec creates its fixtures through the API with two tenants/orgs and cleans up; no reliance on seeded demo data.

| API path / flow | QA spec | OSS jest | Asserts |
|---|---|---|---|
| R1–R5 `/projects`, `/projects/:id` | TC-DELIVERY-001 | `commands/__tests__/projects.test.ts`, `api/__tests__/projects.route.test.ts` | CRUD, `pageSize ≤ 100`, archived hidden, 404 cross-scope, 403 per feature, stale PUT/DELETE 409, archive blocked by active attempt, history kept |
| R6–R7 `/projects/:id/baselines` | TC-DELIVERY-002 | `lib/__tests__/baseline.test.ts`, `lib/__tests__/proposals.test.ts`, `commands/__tests__/baselines.test.ts` | both inputs same schema, no AC/render → 422, attachment scope/hash, identical content → duplicate, unknown version / foreign ref rejected, approved version immutable: a scope change creates a new baseline, old tasks stay pinned and a late result of the old baseline does not prove the new scope |
| R8 `/baselines/:id/decisions` | TC-DELIVERY-003 | `commands/__tests__/decisions.test.ts` | approve feature (manage → 403), hash/version, concurrent contradictory decisions → one wins, stale 409, `activeBaselineId` needs both kinds |
| R9–R13 `/projects/:id/tasks`, `/tasks/:id`, `/tasks` | TC-DELIVERY-004 | `lib/__tests__/dag.test.ts`, `lib/__tests__/taskLifecycle.test.ts`, `lib/__tests__/allowedPaths.test.ts`, `commands/__tests__/tasks.test.ts` | cycle, foreign project, unknown AC, lock, ready gate, `verified` only with evidence, plan import validates `allowedPaths` and AC→test, re-import no duplicates |
| R14–R15 attempts + package | TC-DELIVERY-005 | `lib/__tests__/attempts.test.ts`, `commands/__tests__/attempts.test.ts`, `api/__tests__/package.route.test.ts` | 201/200/409 on keys, single active attempt, 17th blocked, `automatic` rejected publicly, GET package writes nothing, unknown attempt 404 |
| R16 results | TC-DELIVERY-006 | `lib/__tests__/resultAcceptance.test.ts`, `commands/__tests__/results.test.ts` (`results.accept` in `commands/evidence.ts`) | duplicate beats `attempt_closed`, → no new evidence + re-emitted event, different hash 409, bad baseline/commit, cancelled attempt, foreign tenant 404, size limits, tenant in manifest ignored |
| R17–R18 cancel / reconcile | TC-DELIVERY-007 | `lib/__tests__/attempts.test.ts`, `commands/__tests__/attempts.test.ts` | separate features, late result rejected, `unknown` blocks reserve/archive, `completed` never `verified` |
| R19–R20 evidence, deploy decisions | TC-DELIVERY-008 | `commands/__tests__/evidence.test.ts`, `commands/__tests__/decisions.test.ts` | discriminator, revision and AC mapping, false hashes, review `approved` → `verified` only with proof, `changes_requested` round limit, deploy refused on non-green report |
| R21–R22 release decisions, report | TC-DELIVERY-009 | `lib/__tests__/deliveryReport.test.ts`, `lib/__tests__/projectStatus.test.ts` | missing/failed/not_run (incl. runner `skipped`) block, manual AC stays `manual_pending` until a human review, missing scan blocks, unverified deployment blocks release, old decision not applied to a new revision |
| Contracts / fixtures | — | `lib/__tests__/contracts.test.ts`, `lib/__tests__/hash.test.ts`, `lib/__tests__/targetProfiles.test.ts`, `lib/__tests__/fixtures.test.ts`, `data/__tests__/validators.test.ts` | every fixture parses or fails as labelled; unknown `schemaVersion` rejected; snapshot revision accepted for WP, rejected for React |
| OSS-only manual flow (enterprise disabled) | TC-DELIVERY-010 | `commands/__tests__/manualFlow.test.ts` | project → baseline with snapshot → real decisions → ready → reserve → package → result, with `OM_ENABLE_ENTERPRISE_MODULES=false` |
| UI `/backend/delivery/projects` → intake → design review → baseline (FROM_BRIEF, FROM_DESIGN) | TC-DELIVERY-011 | — | both inputs, comment on a version, dialog keyboard (Cmd/Ctrl+Enter, Escape), loading and error states |
| UI `/backend/delivery/projects/:id` task → attempt → evidence → report → release | TC-DELIVERY-012 | — | manual handoff visible, result provenance, conflict on stale approval, cancel/reconcile states |

Enterprise flows (`/api/delivery_agents/*`, worker delivery, workflow resume) are covered by `TC-DELIVERY-EXEC-*` in the enterprise spec.

## Migration & Backward Compatibility

- **Additive only.** New module, new tables `delivery_projects`, `delivery_baselines`, `delivery_tasks`, `delivery_evidence`, `delivery_decisions`, new routes under `/api/delivery_os/*`, new ACL features, event ids, spot id and DI key. No existing table, route, event, feature, DI key, widget spot or generated contract changes (`BACKWARD_COMPATIBILITY.md` categories: all additions).
- **Migrations:** `yarn db:generate`, keep only the `delivery_*` DDL and the module `.snapshot-open-mercato.json`; review SQL (including both partial unique indexes). Applying to a shared DB needs human consent.
- **Activation:** one entry `{ id: 'delivery_os', from: '@open-mercato/core' }` in `apps/mercato/src/modules.ts` (existing declarative list, same style as line 75), then `yarn generate`. **Not** added to the create-app template. Enterprise `delivery_agents` is activated separately (see enterprise spec).
- **Frozen once shipped:** event ids, ACL feature ids, spot id `delivery_os.project.execution`, context contract `delivery_os.project.execution.v1`, DI key `deliveryOsAttemptQueries`, command ids, API paths, v1 `schemaVersion` strings and error codes. After the H4 hand-over, v1 changes are additive only; a breaking need becomes v2 with a note for all streams.
- **Rollback:** remove the module entry; tables and evidence stay in place and readable when re-enabled. No data migration of existing records.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Replay of reserve, result or proposal import 409s on a stale lock instead of returning the existing result | High | attempts, results, proposals | idempotency compare before lock; results carry no lock header | none known |
| Concurrent double import or double reserve | High | evidence, tasks | row lock on task + partial unique index on `result_manifest`; unique violation → `duplicate` | real-DB concurrency needs QA/ephemeral DB proof |
| `automatic` mode reachable from HTTP | High | safety boundary | route validator is `z.literal('manual_handoff')`; command accepts `automatic` only without `ctx.request` | enterprise must call in-process |
| Cross-tenant leak through relations, attachments or report | High | all reads | scope from session on every query; 404 for foreign scope; 2×2 tenant/org tests | — |
| Agent-supplied AC→test mapping counted as proof | High | report | mapping frozen in the approved baseline; unknown test ids → 422 | — |
| Contract churn after hand-over | Medium | UI/EXEC/QA | this spec + fixtures frozen; v1 additive only | — |
| i18n gate fails on API messages | Medium | CI | API returns stable codes; UI owns `delivery_os.errors.*` keys | UI must add keys |
| Track rule "do not modify core" vs module in `packages/core` | Low | judging | master plan decides the location; change is additive and self-contained | explain in demo |

## Final Compliance Report

| Rule | Status |
|---|---|
| Tenant/org scoping on every entity and query | Designed (all tables, 404 for foreign scope) |
| No cross-module ORM relations | Designed (uuid ids + snapshots only) |
| Commands + mutation guards for writes; no bypass | Designed |
| Optimistic locking on editable entities, `updatedAt` in responses | Designed (projects, tasks; custom actions per Lock column) |
| Feature-based ACL, no role names, wildcard helpers | Designed (8 features) |
| zod validators in `data/validators.ts`, types via `z.infer` | Planned for OSS-02 |
| `pageSize ≤ 100` | Designed |
| No hard-coded user-facing strings | API returns codes; UI owns i18n |
| OSS does not import enterprise | Designed; enforced by decoupling test |
| Integration coverage for every API path and key UI path | Listed above; QA-owned TC-DELIVERY specs |
| Spec location / naming | `.ai/specs/2026-09-18-delivery-os-hackathon.md`, no `SPEC-` prefix |

## Changelog

- 2026-09-19 — Task commands (OSS-02 L4c, T011): `commands/tasks.ts` registers `delivery_os.tasks.create` (manual source only; `plan_proposal` → `400 validation_failed`/`unsupported_source`, import is OSS-03), `.update`, `.delete`; result `{ taskId, projectId, status, updatedAt, propagatedTaskIds }`. Lock order project row → live project tasks → optimistic check on the task (`lockTaskForWrite`). Clarifications, no new codes: baseline of another project/scope or missing → `422 foreign_reference`/`foreign_baseline`; unreadable stored baseline content → `422 hash_mismatch`/`unreadable_baseline_content`; `acIds`/`dependsOnTaskIds`/`allowedPaths` are editable only in `draft`|`blocked` before the first attempt, else `409 invalid_transition`/`task_not_editable`; a user status change on a task with a live or unknown attempt (or `executing`) answers `409 attempt_active` / `409 reconciliation_required`; `→ ready` on a non-active baseline → `422 baseline_not_approved`/`baseline_not_active`; user status changes clear only `dependency_blocked`, never `reconciliation_required`/`correction_limit_reached`; block/unblock propagation runs in the same transaction; a task whose attempt carries an accepted result cannot be moved to `draft`/`ready` by a status update (`409 invalid_transition`/`result_awaits_review`; it continues through review or is cancelled); `blocked → draft` under a still-blocked ancestor → `409 invalid_transition`/`dependency_blocked`; unblock propagation only on `→ draft|ready`; task archive with live dependents → `422 foreign_dependency`/`has_dependents`. `delivery_os.task.updated` is emitted persistent after commit for the task and every propagated task (not on archive).
- 2026-09-19 — Project commands (OSS-02 L4b, T010): `commands/shared.ts` (`resolveDeliveryScope` reads tenant from `ctx.auth` and organization from the account organization, or from the selected organization only when the platform `organizationScope` vouches for it — never from input; a scope refusal answers `403 forbidden`; `parseDeliveryInput` and `deliveryHttpError` answer the frozen `{ error, code, details[] }` body; `requireScopedProject`/`requireScopedTask` filter by id + tenant + organization + `deletedAt: null` and answer `404 not_found` for missing, archived and foreign rows alike; `lockProjectForWrite` takes the `PESSIMISTIC_WRITE` row lock inside the transaction and then runs the platform optimistic-lock check, so a stale `updatedAt` answers the platform `409 optimistic_lock_conflict` body and a row that vanished while the client held a version answers the same 409) and `commands/projects.ts`: `delivery_os.projects.create` (newest `targetProfileVersion` when omitted via `getLatestTargetProfile`, unknown id/version → `422 unknown_target_profile` with the offending path, limits merged over `DEFAULT_DELIVERY_LIMITS`, empty DraftSpec v1, emits `delivery_os.project.created` once, persistent, after the write), `.update` (`draftSpec` is a full replacement, `limits` merge, never writes `activeBaselineId`, profile, input mode or scope), `.delete` (soft delete only, no cascade; locks the project and then its live tasks; `409 reconciliation_required` for a `reconciliation_required` attempt, a task with that status reason or an unreadable register — fail closed; otherwise `409 attempt_active` for a `reserved`/`claimed`/`cancel_requested` attempt or an `executing` task; `details[]` name the blocking task/attempt). Commands write audit snapshots (`resourceKind` `delivery_os.project`) and the query-index side effect, have no undo, and do not require the lock header — `428 optimistic_lock_required` is enforced by the routes. No contract or error-code change.
- 2026-09-19 — Registration (OSS-02 L4a, T009): `acl.ts` (8 features; every non-view feature `dependsOn: ['delivery_os.projects.view']`), `index.ts` re-exports `features`, `setup.ts` (`defaultRoleFeatures` only, no seeding), `events.ts` (4 frozen IDs, `clientBroadcast` on `task.updated` and `evidence.recorded` only, typed payload schemas), `extension-points.ts` (host `projectExecution`: `family: 'detail'`, `supported: ['render-widget']`, spot/contract as string literals because the extension-facts generator cannot follow imports; a test pins them to `lib/contracts.ts`). Additive: event payloads gain `tenantId`, `organizationId`; `taskId`/`attemptId` of `evidence.recorded` and `statusReason`/`completionDelivery` are nullable. The host stays `unbound` in module facts until the UI page references `extensionPoints.hosts.projectExecution`.
- 2026-09-19 — Attempt and baseline rules (OSS-02 L3b, T008): `lib/attempts.ts` (pure reducers over the parsed `executionAttempts` register: `parseAttemptRegister`, `reserveAttempt` → `created`/`existing`/`conflict` with the check order idempotency → `reconciliation_required` → `attempt_active` → `attempt_limit_reached`, `baseCommit` derived from `baseRevision`; `claimAttempt` sets `claimedAt`/`workerRef` once (same worker idempotent, another worker `409 attempt_active`); `checkAttemptOpen` maps `cancel_requested`/outcome `cancelled` → `attempt_cancelled`, `result_received`/`closed` → `attempt_closed`, unknown → `reconciliation_required` and is the shared gate for claim and GET package; `requestCancellation` is idempotent and only records `stop_unconfirmed`; `reconcileAttempt` returns a task *effect* (`release_task` / `await_manifest` / `block_task`) — `completed` records the observation and leaves the state untouched until a manifest is accepted, so it never yields `verified`; `isArchiveBlocked`) and `lib/baseline.ts` (`buildBaselineContent` deep-clones the draft, copies only resolved comments and reports `openCommentIds`; `hashBaseline`, `nextBaselineVersion`, `assertStableIds`; `latestBaselineDecisions` / `resolveActiveBaseline` count approvals only for this `contentHash` + version while a later reject of the same hash voids them whatever version it names, a tie or an unreadable `decidedAt` fails closed; non-canonical input answers `400 validation_failed` instead of throwing; a cancelled attempt reconciled as `not_started`/`stopped` closes with outcome `cancelled`; `checkTaskReadiness` returns every reason as `details[]` in the fixed order `unknown_target_profile` (profile pinned on the task; detail `target_profile_mismatch`) → `baseline_mismatch` → `hash_mismatch` → `baseline_not_approved` → `missing_acceptance_criteria` → `unknown_ac` → `missing_render` → `missing_required_tests`; an AC needs a non-empty `acTestMap` entry or a `manualChecks` entry). No contract or error-code change.
- 2026-09-19 — Domain rules (OSS-02 L3a, T007): `lib/dag.ts` (`validateTaskGraph` → `self_dependency`/`cycle` (→ `422 cycle`), `unknown_dependency`/`foreign_dependency` other project or other baseline (→ `422 foreign_dependency`); `descendantsOf`, `ancestorsOf`), `lib/taskLifecycle.ts` (transition table: `draft → ready|blocked|cancelled`, `ready → draft|executing|blocked|cancelled`, `executing → awaiting_review|ready|changes_requested|blocked` (no direct cancel while an attempt runs), `awaiting_review → changes_requested|verified|blocked|cancelled`, `changes_requested → executing|blocked|cancelled`, `blocked → draft|ready|awaiting_review|changes_requested|cancelled` (`awaiting_review` for UA-19 `completed` after an `unknown`), `verified`/`cancelled` terminal; `canTransition` gates (an unchanged status is a no-op): R12 only user-settable targets, `reconciliation_required` blocks `ready/executing/changes_requested`, `→ ready` needs the baseline readiness result and no blocked ancestor, `blocked/correction_limit_reached` only to `cancelled`, every `→ executing` needs the correction budget `{ requested, max }` (`requested` = `changes_requested` review verdicts recorded for the task, append-only, so a draft/ready round-trip cannot reset it; malformed → `409 invalid_transition`) and a third correction round → `409 correction_limit_reached`, `→ verified` needs AC evidence on the pinned baseline (`422 baseline_mismatch`) and the result revision with every task AC proven (`422 missing_required_tests`); block propagation marks `draft`/`ready` descendants `blocked/dependency_blocked`, unblock returns them to `draft`), `lib/projectStatus.ts` (`archived | draft | awaiting_approval | planning | in_progress | coverage_gap | verified | released`; `progress { proven, total, unit: 'ac', percent }`, `percent: null` when `total = 0`; an AC is proven when every live task on the active baseline covering it is verified; `released` only while the latest approved release matches the latest result revision), `lib/traceability.ts` (requirement → AC → task → evidence rows for one project+baseline, unknown AC kept as a row plus an `unknown_ac` issue, `limit` clamped to 1…1000 with `totalRows` and `truncated`). Additive: error code `correction_limit_reached` (409) and task status reason `correction_limit_reached`; `taskStatusSchema`, `TaskStatus`, `USER_SETTABLE_TASK_STATUSES`, `TASK_STATUS_REASONS` now live in `lib/contracts.ts` (`data/validators.ts` re-exports the first three unchanged).
- 2026-09-19 — Data layer (OSS-02 L2, T006): `index.ts` (metadata), `data/entities.ts` (five entities exactly as the tables above, FK ids only), migration `Migration20260919003425_delivery_os` + module snapshot, registration in `apps/mercato/src/modules.ts`. Additive: check constraint `delivery_evidence_result_manifest_attempt_chk`; `delivery_tasks.status` defaults to `draft`. `data/validators.ts` holds the request-body schemas for R1–R21 (scope ids are never accepted; `manifest` bodies stay plain objects ≤ 2 000 000 chars → `413 payload_too_large`, versioned parsing happens in the command; task `status` accepts every lifecycle value so R12 can answer `409 invalid_transition`; `statusReason` is never accepted; R19 kinds are `test review screenshot deployment scan reference_material`, anything else → `422 unsupported_evidence_kind`). `DraftSpec v1` (`draftSpecV1Schema`): `requirements, acceptanceCriteria, questions, risks, adr, screens, tokens, architectureSummary, planSummary, acTestMap, manualChecks, declaredTests, attachments, comments[{id, screenAttachmentId, anchor, body, status, resolution?}]`; a `draftSpec` in R3 is a **full replacement** (omitted sections become empty). R2 also accepts optional `targetProfileVersion`; R3 also accepts `repositoryRef`. Evidence payloads: test `{rawReportHash, checks[]}`; review `{verdict, summary, findings[], manualCheckId?, reviewedEvidenceId?, reviewer{kind, ref?}}` (needs `taskId`); screenshot `{attachmentId, sha256, name, viewport, capturedAt, pageUrl?}`; deployment `{url, environment, buildId, deployedAt, uploadStatus, verification|null}` (+ `sourceRevision`; missing → `deployment_incomplete`); scan `{checkId, scanner, status, rawReportHash, summary?}`; reference_material `{title, description?, origin?}`. `lib/contracts.ts` gained exports only.
- 2026-09-19 — Target profiles, fixtures and H4 hand-over (OSS-02 L1b, T005): `lib/targetProfiles.ts` (three v1 profiles + helpers), additive contract exports (`deliveryEvidenceKindSchema`, `reserveAttemptRequestSchema`, `reserveAttemptResponseSchema`, `buildPackageUrl`, `DeliveryCheckResult`, `isSameRevision`), `lib/resultAcceptance.ts#checkResultCorrelation`, `lib/dag.ts`, positive and negative fixtures with loaders and `buildResultManifest`. No route, path, schema-version string or error code changed (contracts.ts only gained exports); hand-over note `context/changes/delivery-os-oss-domain/handover/OSS-02-H4-contracts.md`.
- 2026-09-19 — Executable contracts (OSS-02 L1a, T004): `lib/contracts.ts` + `lib/hash.ts` landed. Additive clarifications: TaskPackage carries `title` and optional `description` and at least one AC; BaselineContent and PlanProposal carry `declaredTests[]`; attempt `outcome` values listed; a check's `sourceRevision` must equal `resultRevision`; documents nested deeper than 64 levels → `413 payload_too_large`; `parseVersioned` returns `unsupported_schema_version` before shape validation.
- 2026-09-19 — Review fixes (OSS-01, T003): `verified` only via review evidence with proof; replay-before-lock for proposals; UA-12 validation order; explicit `baseCommit`/`resultCommit`; `manualChecks`; runner `skipped` → `not_run`; UA-19 `not_started`/`stopped`; typed `trustedExecution` for `automatic`; `change` decision kind dropped. Codes deliberately renamed vs the breakdown (this spec is authoritative): `attempt_limit` → `attempt_limit_reached`, `task_blocked` → `task_not_ready`, `active_attempt` → `attempt_active`; package export uses `delivery_os.attempts.manage`.
- 2026-09-19 — Initial draft (OSS-01, T003): data model, contracts v1 names, ACL, events, spot, DI service, commands, frozen route map with router/`makeCrudRoute` evidence, API table UA-01…UA-20, error catalogue, integration coverage, Migration & BC.
