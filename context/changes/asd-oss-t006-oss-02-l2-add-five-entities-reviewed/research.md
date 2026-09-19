---
date: 2026-09-19T03:00:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 47f9047c7b658981b3dc7ccbfb33214d00a42d12
branch: dev-mateusz
repository: open-mercato
topic: "Entity, migration, registration and validator conventions for delivery_os L2"
tags: [research, codebase, delivery_os, mikro-orm, migrations, validators]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: entity, migration, registration and validator conventions for delivery_os L2

## Research Question

How do core modules define MikroORM entities, partial unique indexes, module metadata, registration, generator output and
per-module migrations with `.snapshot-open-mercato.json`; and what do the delivery_os spec and master plan require for the
five entities' columns and the API input validators?

## Summary

- Entities use legacy decorators from `@mikro-orm/decorators/legacy`, a uuid PK with `defaultRaw: 'gen_random_uuid()'`,
  explicit snake_case `name`, `type: 'text' | 'uuid' | 'jsonb' | Date`, and an `[OptionalProps]` marker.
- A partial (unique) index is declared with `@Index({ name, expression: 'create unique index … where …' })`; the generator
  copies the expression verbatim into the migration.
- A module needs only `index.ts` exporting `metadata: ModuleInfo` to be discovered; entities are picked up from `data/entities.ts`.
- `yarn db:generate` writes `src/modules/<module>/migrations/Migration<ts>.ts` and the module snapshot; stale snapshots in
  other modules may emit noise that must be deleted (AGENTS.md coding-agent exception).
- **The frozen spec, not the looser task text, fixes the column names.** Where they differ, the spec wins (it agrees with the
  master plan: delivery state lives in the attempt register, not on evidence).

## Detailed Findings

### Entity style
- `packages/core/src/modules/customers/data/entities.ts:1-60` — imports, `[OptionalProps]`, `@Index({ name, properties })`,
  expression indexes, `type: 'jsonb'` for JSON columns (`:652`), `default:` for scalar defaults (`:90`, `:325`).
- `packages/core/src/modules/api_keys/data/entities.ts:8-12` — partial unique index via `expression`; its migration
  `api_keys/migrations/Migration20260523234901.ts` shows the expression emitted verbatim.
- Timestamps: `@Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()`;
  `updated_at` with `onUpdate`.

### Module metadata and registration
- `packages/core/src/modules/api_keys/index.ts` — `export const metadata: ModuleInfo = { name, title, version, description, author, license, requires }`.
  It re-exports `features` from `./acl`; delivery_os has no `acl.ts` yet, so the stub exports metadata only.
- `apps/mercato/src/modules.ts:71+` — `enabledModules` array of `{ id, from }`.
- `scripts/template-sync.ts:33,196,287,327` — `modules.ts` is a synced root file; modules are excluded from the template only
  via `TEMPLATE_DISABLED_MODULE_IDS` / `TEMPLATE_COMMENTED_MODULES`. `delivery_os` is in neither list, so
  `yarn template:sync` will report drift after the registration. The plan says not to activate it in the template; the
  script is not OSS-owned, so the drift is reported, not fixed.

### Migrations
- `packages/cli/AGENTS.md:84-99` — generate per module, keep the snapshot in sync, delete unrelated output, never
  `db:migrate` as part of generation.
- Each module keeps `migrations/.snapshot-open-mercato.json` (e.g. `devices/migrations/`).

### Required columns (spec `.ai/specs/2026-09-18-delivery-os-hackathon.md:72-164`)
Common: `id`, `tenant_id`, `organization_id` (both not null), `created_at`.
- `delivery_projects`: name, input_mode, brief, target_profile_id/version, repository_ref, draft_spec jsonb `{}`, active_baseline_id,
  limits jsonb, updated_at, deleted_at. Indexes (tenant, org, deleted_at), (tenant, org, created_at).
- `delivery_baselines`: project_id, version, content_hash, source, parent_baseline_id, content jsonb, attachment_ids jsonb `[]`, created_by.
  Unique (tenant, org, project_id, version) and (tenant, org, project_id, content_hash). No updated_at.
- `delivery_tasks`: project_id, baseline_id, title, description, ac_ids, depends_on_task_ids, allowed_paths, target profile id/version,
  status, status_reason, attempt_number, execution_attempts, proposal_task_key, updated_at, deleted_at.
  Index (tenant, org, project_id, deleted_at); partial unique (tenant, org, project_id, baseline_id, proposal_task_key) where key is not null.
- `delivery_evidence`: project_id, baseline_id, task_id, attempt_id, kind, source, source_revision, payload, payload_hash,
  raw_report_hash, attachment_ids, recorded_by. Three indexes plus partial unique (tenant, org, task_id, attempt_id) where kind = 'result_manifest'.
- `delivery_decisions`: project_id, kind (requirements|design|deploy|release), subject_type/id/hash/version, source_revision,
  verdict, reason, actor_user_id, decided_at. Index (tenant, org, project_id, kind, decided_at).

Differences from the task text, resolved in favour of the spec: evidence uses `payload`/`payload_hash`/`raw_report_hash`/`recorded_by`
(not manifest/manifest_hash/checks/imported_by); `completionDelivery`/`lastDeliveryError` and the external/workflow refs live inside
`execution_attempts` (master plan line 326); the task block reason is `status_reason`; dependencies are `depends_on_task_ids`;
decision kinds exclude `change`; a deployment decision's evidence id is `subject_id` with `subject_type = 'deployment_evidence'`.

### Validators (spec route table `:289-312`)
Reusable from `lib/contracts.ts`: `sourceRevisionSchema`, `repoRelativePathSchema`, `deliveryLimitsSchema`, `reserveAttemptRequestSchema`
(`mode: z.literal('manual_handoff')`), `resultManifestV1Schema`, `requirementsProposalV1Schema`, `planProposalV1Schema`,
`requirementSchema`, `acceptanceCriterionSchema`, `screenRefSchema`, `deliveryEvidenceKindSchema`, `reconciliationResolutionSchema`,
`deliveryErrorFromZod` (custom issue `params.deliveryCode` → catalogue code, e.g. `reason_required`, `manifest_required`).
`stableIdSchema`, `sha256Schema`, `commentAnchorSchema` are module-private in contracts.ts. There is no `DraftSpec v1` schema yet.
zod 4 skips `superRefine` when the base shape fails, so negative tests change exactly one property of a valid body.

## Code References
- `packages/core/src/modules/customers/data/entities.ts:1-60`
- `packages/core/src/modules/api_keys/data/entities.ts:8-12`
- `packages/core/src/modules/api_keys/index.ts`
- `apps/mercato/src/modules.ts:71`
- `scripts/template-sync.ts:196,287`
- `packages/core/src/modules/delivery_os/lib/contracts.ts:100-175,286-297,436-449,579,642-661`

## Architecture Insights
Append-only tables have no `updated_at`/`deleted_at`; only projects and tasks are optimistic-lock subjects.

## Historical Context (from prior changes)
- T003: specs are the frozen v1 contract. T004/T005: helpers return `DeliveryCheckResult`; v1 is additive-only after H4.

## Open Questions
None blocking. `DraftSpec v1` needs a schema; it is an API input, so it lands in `data/validators.ts`.
