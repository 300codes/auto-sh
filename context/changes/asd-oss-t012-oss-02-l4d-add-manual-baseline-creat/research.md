---
date: 2026-09-19T04:10:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 1b22604cf
branch: dev-mateusz
repository: open-mercato
topic: "How to build delivery_os baselines.create (manual) and decisions.record on the existing command layer"
tags: [research, delivery_os, baselines, decisions, optimistic-lock]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: manual baseline creation and atomic decisions

## Research Question
How should `commands/baselines.ts` and `commands/decisions.ts` be built on `commands/shared.ts`, `lib/baseline.ts`,
`lib/hash.ts`, the entities, the error catalogue, the attachments lookup, unique-violation recovery and the
optimistic-lock helpers? (Code read in the main context; no sub-agents because of the RAM rule.)

## Summary
Everything pure already exists. The commands only orchestrate: scope → parse → one transaction (lock project with
`lockProjectForWrite`, loads, pure checks, mutations last) → events after commit. No new error code, entity, migration
or contract is needed.

## Detailed Findings

### Command layer (`packages/core/src/modules/delivery_os/commands/`)
- `shared.ts`: `resolveDeliveryScope`, `resolveDeliveryEm` (forked EM), `parseDeliveryInput`, `assertDeliveryCheck`,
  `deliveryHttpError`, `lockProjectForWrite(tx, ctx, id, scope)` = `PESSIMISTIC_WRITE` row lock + platform optimistic
  check (`enforceCommandOptimisticLockWithGuards`, stale → platform 409 body; vanished row → 409 when a header was sent,
  else `404 not_found`). The helper is a no-op without a header, so "header required" needs an explicit check.
- `readOptimisticLockExpected(request)` in `packages/shared/src/lib/crud/optimistic-lock-command.ts:73` returns the
  header or null. The catalogue has `optimistic_lock_required: 428` (`lib/contracts.ts:76`).
- `projects.ts` pattern: `CommandHandler` with `execute`, `captureAfter`, `buildLog` (audit labels through
  `resolveTranslations` with an English fallback), `registerCommand`, `index.ts` imports each file.
- `tasks.ts:188-345`: `findProjectBaseline`, decision load filter `{ projectId, subjectType: 'baseline', subjectId }`
  and the mapping to `BaselineDecisionRecord` — the same shape is needed here.

### Pure rules (`lib/baseline.ts`)
- `buildBaselineContent(draft)` → `{ ok, content, contentHash, openCommentIds }` or a `DeliveryErrorResult`
  (`deliveryErrorFromZod`: domain issue codes such as `missing_acceptance_criteria`, `foreign_reference`,
  `duplicate_stable_id` are 422; pure shape issues are `400 validation_failed`). It never throws.
- An AC must reference a known requirement, so ≥1 AC implies ≥1 requirement; zero AC → `missing_acceptance_criteria`.
- Screens are NOT required by the schema: the `missing_render` check (no screens) belongs to the command.
- `screenRefSchema.attachmentId` is a required uuid, so a "temporary URL only" screen cannot pass the draft schema.
- `nextBaselineVersion`, `resolveActiveBaseline(decisions, { contentHash, version })` (exact hash + version, a later
  reject of the same hash voids, ties and unreadable dates fail closed).

### Entities (`data/entities.ts`)
- `DeliveryBaseline`: unique `(tenant, org, project, version)` = `delivery_baselines_project_version_uq`, and
  `(tenant, org, project, content_hash)` = `delivery_baselines_project_hash_uq`; no `updated_at`/`deleted_at`.
- `DeliveryDecision`: append-only, `decidedAt`, `actorUserId` (uuid, not null), `subjectType`, `subjectId`.
- `DeliveryProject.activeBaselineId`, `updatedAt` with `onUpdate`.

### Validators (`data/validators.ts:212-227`)
- `baselineCreateSchema` (discriminated by `source`) and `baselineDecisionSchema` (kinds requirements/design, reject
  needs a reason → `422 reason_required`) exist but carry no `projectId` / `baselineId`; the route puts the path id in.

### Attachments
- `Attachment` (`packages/core/src/modules/attachments/data/entities.ts:51`) has nullable `tenantId`/`organizationId`,
  no `deletedAt`. `catalog/commands/variants.ts:21` imports the entity class from the package path — accepted FK-id
  coupling without an ORM relation. Catalogue code: `attachment_scope_mismatch` (422).

### Unique violation
- `isUniqueViolation(err, constraintName?)` in `packages/shared/src/lib/crud/errors.ts:65` (checks `code 23505` on the
  error, `cause`, `previous`). `messages/commands/messages.ts:392` recovers by re-reading on a fresh fork.

### Events
- `delivery_os.baseline.approved` payload `{ projectId, baselineId, version, contentHash, activeBaselineId, tenantId,
  organizationId }`; `emitDeliveryOsEvent(id, payload, { persistent, tenantId, organizationId })`.

## Architecture Insights
- Repo rule: no queries between a mutation and the flush → load everything, decide in memory, mutate last.
- "Second writer loses" is delivered by the project lock header: every decision bumps `project.updatedAt`, so the
  concurrent writer holding the old version gets the platform `409 optimistic_lock_conflict` after the row lock frees.

## Historical Context
- T010/T011 decisions: 428 for a missing header was left to the routes for project/task commands. Here the task text
  says the header is required, and the decision is the safety boundary, so the command checks it itself.

## Open Questions
- None blocking. Hash/size/type verification of attachment bytes is OSS-03.
