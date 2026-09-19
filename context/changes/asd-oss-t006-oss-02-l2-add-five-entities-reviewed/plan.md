# OSS-02 (L2): five entities, reviewed migration, validators and module registration stub — Implementation Plan

## Overview

Give `delivery_os` its data layer: a discoverable module stub, five MikroORM entities matching the frozen spec, one reviewed
`delivery_*` migration with the module snapshot, and the zod API input schemas every later command and route will use.

## Current State Analysis

- `packages/core/src/modules/delivery_os/` holds only `lib/` (contracts v1, hash, profiles, fixtures, first DAG/correlation helpers). There is
  no `index.ts`, so the module is not discovered and nothing is generated for it.
- The frozen spec `.ai/specs/2026-09-18-delivery-os-hackathon.md:72-164` fixes every table and column; `:289-312` fixes every request body.
- Several primitives needed by the validators (`stableIdSchema`, `sha256Schema`, `uuidSchema`, `isoDateTimeSchema`, `commentAnchorSchema`,
  `idempotencyKeySchema`, `addDeliveryIssue`) are module-private in `lib/contracts.ts`.
- There is no `DraftSpec v1` schema yet, although `PUT /projects` accepts `draftSpec`.

## Desired End State

`yarn generate` discovers `delivery_os`; `delivery_os/migrations/` contains one migration creating exactly five `delivery_*` tables with their
indexes (two baseline uniques, two partial uniques) plus the snapshot; `data/validators.ts` exports one schema per request body and its tests
pass; `yarn build:packages` and the core typecheck pass; `apps/mercato/src/modules.ts` differs by one line.

### Key Discoveries:

- Entity style and expression indexes: `packages/core/src/modules/customers/data/entities.ts:1-60`, `api_keys/data/entities.ts:8-12`.
- jsonb defaults: `catalog/data/entities.ts:372` (`type: 'jsonb', default: [], nullable: false`); ints: `type: 'integer'`.
- Metadata-only module index: `api_keys/index.ts` (without the `features` re-export, because `acl.ts` lands in a later layer).
- `scripts/template-sync.ts:33,196,287` syncs `modules.ts` into the create-app template; `delivery_os` is not in its exclusion lists.
- zod 4 skips `superRefine` when the base shape fails, so a catalogue code such as `deployment_incomplete` needs the fields optional in the
  shape and enforced in the refinement.

## Decisions (planning questions answered from the spec, the recorded decisions and the judging criteria)

| # | Question | Choice | Why |
|---|---|---|---|
| D1 | Task text and spec disagree on some columns (evidence `manifest/manifest_hash/checks/imported_by/completion_delivery`, task `block reason`/external refs, decision kind `change`, `deployment_evidence_id`). Which wins? | The spec: `payload`, `payload_hash`, `raw_report_hash`, `recorded_by`; delivery state and external/workflow refs inside `execution_attempts`; `status_reason`; `depends_on_task_ids`; four decision kinds; deployment evidence as `subject_id` with `subject_type = 'deployment_evidence'`. | T003 froze the spec as the v1 contract handed to UI/EXEC/QA at H4; the master plan (line 326) also keeps delivery state in the attempt register. One source of truth keeps the end-to-end flow coherent. |
| D2 | Unknown keys (e.g. `tenantId`) in a body: reject or strip? | Strip (plain `z.object`), and test that the parsed output never carries `tenantId`/`organizationId`. | Same style as `lib/contracts.ts`; scope always comes from the session, so a stray key is harmless, while strict rejection would break UI forms that send extra keys. |
| D3 | Do body schemas embed the versioned manifest schemas? | No. `manifest` is validated as a plain JSON object; the command parses it with `parseVersioned`. | Otherwise an unknown `schemaVersion` would surface as `400 validation_failed` instead of the frozen `422 unsupported_schema_version`, and `413 payload_too_large` would be unreachable. |
| D4 | Task update `status`: only user-settable values? | Accept every task status; export `USER_SETTABLE_TASK_STATUSES` for the lifecycle layer. | The spec requires `409 invalid_transition` for `status: 'verified'` through R12, which a 400 from the validator would mask. |
| D5 | Is `scan` part of the evidence body union? | Yes; `result_manifest` is not (it has its own route). Unknown or `result_manifest` kind → `422 unsupported_evidence_kind` through a `parseRecordEvidenceBody` helper. | `react-vite@1` requires scan evidence before publication, so it must be recordable; the code is in the catalogue. |
| D6 | Where does `DraftSpec v1` live? | `data/validators.ts` (`draftSpecV1Schema`): all sections optional with defaults; only `duplicate_stable_id` and `invalid_comment_anchor` are enforced. | It is an API input, not a transport document; a draft must be saveable while incomplete (UA-03 lists only those two codes). Completeness is checked when the baseline is built. |
| D7 | How do validators reach private primitives? | Export them from `lib/contracts.ts` (additive). | v1 is additive-only; duplication would drift. |
| D8 | Template sync drift after registering the module. | Do not edit the template or `scripts/template-sync.ts`; run the check and report the result in notes. | The master plan says not to activate the module in the template; the script is not OSS-owned. |
| D9 | Apply the migration locally? | Yes, once, with `yarn db:migrate` against the local `omhack` database (consent `allow_local_migrations = true`), after the SQL review, and verify the indexes in Postgres. | Proves the DDL is valid and unblocks the next layers and the UI stream on the shared local instance. |
| D10 | `targetProfileVersion` on project create. | Optional positive int; the command defaults it to the newest version of the profile. | UA-01 lists only `targetProfileId`, but the column is not null. |

## What We're NOT Doing

- No `acl.ts`, `setup.ts`, `events.ts`, `di.ts`, `extension-points.ts`, commands or routes (later layers).
- No ORM relations, no attachment entity import.
- No change to the create-app template, to `scripts/template-sync.ts`, to enterprise or UI files.
- No lifecycle, DAG, allowed-path containment or profile lookups inside validators (they are L3 domain helpers).
- No report query/DTO schemas (OSS-05).

## Implementation Approach

Two phases. Phase 1 makes the module real for the platform (stub, entities, registration, generators, migration). Phase 2 adds the input
schemas with tests and runs the package build and typecheck. Heavy commands run one at a time with `--concurrency=2` / `--maxWorkers=2`.

## Critical Implementation Details

- **Generator noise**: `yarn db:generate` may emit migrations for other modules with stale snapshots. Record `git status` before, and delete
  every new file outside `delivery_os/migrations/` afterwards (never touch pre-existing files).
- **Partial unique on evidence**: `task_id`/`attempt_id` are nullable; Postgres treats NULLs as distinct, which is fine because a
  `result_manifest` row always carries both (enforced by the command later).
- **Entities must not import runtime code from `lib/`** (type-only imports), because the CLI loads entity files to build the schema.

## Phase 1: Module stub, entities, registration and migration

### Overview

Create the discoverable module and its schema, and produce the reviewed migration.

### Changes Required:

#### 1. Module metadata

**File**: `packages/core/src/modules/delivery_os/index.ts`

**Intent**: Make the module discoverable. Metadata only.

**Contract**: `export const metadata: ModuleInfo` with `name: 'delivery_os'`, title, version `0.1.0`, description, author, license,
`requires: ['auth', 'attachments']`.

#### 2. Entities

**File**: `packages/core/src/modules/delivery_os/data/entities.ts`

**Intent**: Five entities exactly as the spec tables (see D1), FK ids as plain uuid columns.

**Contract**: `DeliveryProject`, `DeliveryBaseline`, `DeliveryTask`, `DeliveryEvidence`, `DeliveryDecision`. All: uuid PK
`gen_random_uuid()`, `tenant_id`/`organization_id` not null, `created_at`. Projects and tasks: `updated_at` (not null, `onUpdate`) and
`deleted_at`. Indexes and uniques named `delivery_<table>_…`:
- projects: `(tenant_id, organization_id, deleted_at)`, `(tenant_id, organization_id, created_at)`
- baselines: unique `(tenant_id, organization_id, project_id, version)` and `(tenant_id, organization_id, project_id, content_hash)`
- tasks: `(tenant_id, organization_id, project_id, deleted_at)`; expression unique
  `(tenant_id, organization_id, project_id, baseline_id, proposal_task_key) where proposal_task_key is not null`
- evidence: `(tenant, org, project_id, kind)`, `(tenant, org, task_id)`, `(tenant, org, project_id, kind, payload_hash)`; expression unique
  `(tenant_id, organization_id, task_id, attempt_id) where kind = 'result_manifest'`
- decisions: `(tenant, org, project_id, kind, decided_at)`
String-union types for `inputMode`, baseline `source`, task `status`, evidence `kind`/`source`, decision `kind`/`subjectType`/`verdict`
are exported from this file or type-imported from `lib/contracts`.

#### 3. Registration and generators

**File**: `apps/mercato/src/modules.ts`

**Intent**: Enable the module in the app. One added line `{ id: 'delivery_os', from: '@open-mercato/core' },` after `api_keys`-style core
entries (next to `progress`/`integrations` block end is fine; exact position is not a contract). Then `yarn generate`.

**Contract**: `git diff apps/mercato/src/modules.ts` shows one added line. Generated output is never hand-edited; changed tracked generated
files are listed in notes.

#### 4. Migration and snapshot

**File**: `packages/core/src/modules/delivery_os/migrations/Migration<timestamp>.ts`, `migrations/.snapshot-open-mercato.json`

**Intent**: `yarn db:generate`, keep only the `delivery_os` output, review the SQL column by column against the spec tables (names, nullability, defaults `'{}'`, `'[]'`, `0`), and only then apply locally (D9). A mistake found later means regenerating this single migration and repairing the local DB, not stacking a second migration (plan-review F2, F3). After the phase, confirm the shared dev server still answers 200 on `/login` (F4).

**Contract**: `up()` contains only `create table "delivery_*"` and their indexes, including both partial unique indexes and both baseline
uniques; `down()` drops the five tables. If the generator omits `down()`, add it by hand in the same style.

### Success Criteria:

#### Automated Verification:

- `yarn generate` completes and the generated entity registry references `delivery_os`
- The migration file contains only `delivery_*` DDL, both partial unique indexes and both baseline uniques: `grep` checks
- `git status --short` shows no migration or snapshot change outside `delivery_os/migrations/`
- `git diff --stat apps/mercato/src/modules.ts` shows 1 insertion, 0 deletions
- `yarn db:migrate` applies the migration on the local `omhack` database and `\d delivery_tasks` / `\d delivery_evidence` show the partial unique indexes
- A duplicate `result_manifest` insert for the same (tenant, org, task, attempt) is rejected by Postgres, while a second `test` row is accepted (SQL smoke in a rolled-back transaction; rows are inserted with the defaulted columns omitted)

#### Manual Verification:

- A human reads the migration SQL and confirms it matches the spec tables

---

## Phase 2: API input validators, tests and package gate

### Overview

One zod schema per request body, with paired positive/negative tests, then the build and typecheck.

### Changes Required:

#### 1. Export shared primitives

**File**: `packages/core/src/modules/delivery_os/lib/contracts.ts`

**Intent**: Additive `export` of `uuidSchema`, `sha256Schema`, `isoDateTimeSchema`, `stableIdSchema`, `idempotencyKeySchema`,
`commentAnchorSchema`, `addDeliveryIssue` (D7). No behaviour change.

**Contract**: Existing `lib/__tests__` stay green.

#### 2. Validators

**File**: `packages/core/src/modules/delivery_os/data/validators.ts`

**Intent**: Input schemas for every write route and the list/package queries. None declares `tenantId`/`organizationId`.

**Contract** (export names):
- `projectCreateSchema` `{ name, inputMode, brief?, targetProfileId, targetProfileVersion?, repositoryRef?, limits? }`;
  `repositoryRef` rejects a URL with credentials; `limits` is a partial of `deliveryLimitsSchema`.
- `projectUpdateSchema` `{ id, name?, brief?, repositoryRef?, draftSpec?, limits? }`; `draftSpecV1Schema` (D6).
- `projectListQuerySchema` `{ page, pageSize ≤ 100, search?, includeArchived }`.
- `taskCreateSchema`: union on `source` — `manual` `{ baselineId, title, description?, acIds (≥1), dependsOnTaskIds?, allowedPaths? }` |
  `plan_proposal` `{ manifest }`.
- `taskUpdateSchema` `{ id, title?, description?, acIds?, dependsOnTaskIds?, allowedPaths?, status? }` (`statusReason` is system-owned and never accepted — plan-review F1); own id in
  `dependsOnTaskIds` → `cycle`; `USER_SETTABLE_TASK_STATUSES`, `taskStatusSchema` (D4).
- `baselineCreateSchema`: union on `source` — `manual` | `requirements_proposal` `{ manifest }`.
- `baselineDecisionSchema` `{ kind: requirements|design, verdict, subjectHash, subjectVersion, reason? }`; rejected without a non-blank
  reason → `reason_required`.
- `reserveAttemptBodySchema` = re-export of `reserveAttemptRequestSchema` (`mode` literal `manual_handoff`); `idempotencyKeySchema` re-export.
- `packageQuerySchema` `{ attemptId }`.
- `resultsImportSchema` `{ attemptId, manifest }` (D3).
- `recordEvidenceSchema`: discriminated union on `kind` = `test | review | screenshot | deployment | scan | reference_material` with common
  `{ baselineId, taskId?, attemptId?, sourceRevision?, attachmentIds? }`; `attemptId` needs `taskId`; `test`, `review`, `scan` need
  `sourceRevision`; `review` needs `taskId`; `deployment` without `url`, `environment`, `buildId` or `sourceRevision` →
  `deployment_incomplete`; deployment URL is http(s) without credentials. `parseRecordEvidenceBody(input)` returns
  `{ ok: true, data } | { ok: false, status, body }` and maps an unknown/`result_manifest` kind to `unsupported_evidence_kind` (D5).
- `cancelAttemptSchema` `{ reason? }`.
- `reconcileAttemptSchema` `{ resolution, externalEvidence: { note, observedAt, externalRunId? }, manifest? }`; `completed` without a
  manifest → `manifest_required`.
- `deployDecisionSchema` `{ baselineId, sourceRevision, verdict, reason? }`, `releaseDecisionSchema` `{ deploymentEvidenceId, verdict, reason? }`;
  both: rejected needs a reason → `reason_required`.
- Inferred input types for each schema.

#### 3. Tests

**File**: `packages/core/src/modules/delivery_os/data/__tests__/validators.test.ts`

**Intent**: For each rule above one accepted and one rejected body; rejected bodies are a valid body with one property changed; catalogue
codes are asserted through `deliveryErrorFromZod`. Includes: `mode: 'automatic'` rejected, `tenantId`/`organizationId` never in the output,
`pageSize: 101` rejected, path traversal in `allowedPaths` → `path_not_allowed`, anchor 1.5 → `invalid_comment_anchor`, duplicate AC id in
a draft → `duplicate_stable_id`.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/data --maxWorkers=2` passes
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes (no regression in `lib/`)
- `yarn turbo run build --filter='./packages/*' --concurrency=2` (the `build:packages` equivalent) passes
- `yarn workspace @open-mercato/core typecheck` passes
- `yarn template:sync` result recorded (drift on `modules.ts` is expected and reported, not fixed)

#### Manual Verification:

- UI/EXEC/QA owners confirm the request-body schemas match what they send (joint H9 hand-over)

---

## Testing Strategy

### Unit Tests:

- Paired positive/negative cases per validator rule; catalogue codes checked via `deliveryErrorFromZod`.

### Integration Tests:

- QA-owned (`TC-DELIVERY-*`), not part of this task. Schema-level SQL smoke in Phase 1 covers the two partial uniques.

### Manual Testing Steps:

1. Read the migration SQL against the spec tables.

## Performance Considerations

Indexes lead with `(tenant_id, organization_id)` to match the scoped queries of every route.

## Migration Notes

New tables only; nothing existing changes. `down()` drops the five tables.

## References

- Research: `context/changes/asd-oss-t006-oss-02-l2-add-five-entities-reviewed/research.md`
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md:72-164,289-353`
- Patterns: `packages/core/src/modules/api_keys/data/entities.ts:8-12`, `customers/data/entities.ts:1-60`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Module stub, entities, registration and migration

#### Automated

- [x] 1.1 `yarn generate` completes and the generated entity registry references `delivery_os`
- [x] 1.2 Migration contains only `delivery_*` DDL, both partial unique indexes and both baseline uniques
- [x] 1.3 `git status --short` shows no migration or snapshot change outside `delivery_os/migrations/`
- [x] 1.4 `git diff --stat apps/mercato/src/modules.ts` shows 1 insertion, 0 deletions
- [x] 1.5 `yarn db:migrate` applies on the local `omhack` database and the partial unique indexes exist
- [x] 1.6 SQL smoke: duplicate `result_manifest` rejected, second `test` row accepted

#### Manual

- [ ] 1.7 A human reads the migration SQL and confirms it matches the spec tables

### Phase 2: API input validators, tests and package gate

#### Automated

- [x] 2.1 jest `src/modules/delivery_os/data` passes
- [x] 2.2 jest `src/modules/delivery_os` passes
- [x] 2.3 packages build passes with `--concurrency=2`
- [x] 2.4 `yarn workspace @open-mercato/core typecheck` passes
- [x] 2.5 `yarn template:sync` result recorded

#### Manual

- [ ] 2.6 UI/EXEC/QA owners confirm the request-body schemas match what they send
