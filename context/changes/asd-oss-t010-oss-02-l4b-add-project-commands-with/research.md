---
date: 2026-09-19T03:30:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 0b10a5087
branch: dev-mateusz
repository: open-mercato
topic: "Command pattern, scope, optimistic lock and delivery_os building blocks for project commands"
tags: [research, codebase, delivery_os, commands, optimistic-lock]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: command pattern and building blocks for `delivery_os.projects.*`

## Research Question

How do reference modules implement `registerCommand` handlers (buildLog, side effects, scope, optimistic lock,
row locks), and what does `delivery_os` already expose that the project create/update/delete commands must use?

## Summary

- Commands are plain `CommandHandler<TInput, TResult>` objects registered at import time with `registerCommand`.
  The generator auto-discovers every `commands/*.ts` except `index`, `shared`, `factory`
  (`packages/cli/src/lib/generators/module-registry.ts:1329-1460`) and statically extracts the literal `id`, so the
  ids must be string literals and `yarn generate` must run after adding `commands/projects.ts`.
- Command-side optimistic locking is `enforceCommandOptimisticLockWithGuards(ctx.container, { resourceKind,
  resourceId, current, request })` plus `enforceRecordGoneIsConflict` on a missing row
  (`packages/shared/src/lib/crud/optimistic-lock-command.ts:214,347`; usage
  `packages/core/src/modules/customers/commands/pipelines.ts:62-75,101-116`). It is a no-op without the header and
  throws `CrudHttpError(409, { error, code: 'optimistic_lock_conflict', currentUpdatedAt, expectedUpdatedAt })`.
- Scoped loader with row lock: `findOneWithDecryption(em, Entity, where, { lockMode: LockMode.PESSIMISTIC_WRITE },
  scope)` inside `em.transactional` (`packages/core/src/modules/warranty_claims/commands/claims.ts:640-646,2204`,
  `shared.ts:88-97`).
- Scope: `ctx.auth.tenantId`, `ctx.selectedOrganizationId ?? ctx.auth.orgId`, then `ensureTenantScope` /
  `ensureOrganizationScope` from `@open-mercato/shared/lib/commands/scope`
  (`warranty_claims/commands/claims.ts:270-278` — but that variant also reads input; delivery must not).
- buildLog shape: `{ actionLabel, resourceKind, resourceId, tenantId, organizationId, snapshotBefore/After,
  changes, payload: { undo } }`, labels via `resolveTranslations().translate(key, fallback)`
  (`customers/commands/tags.ts:136-153,219-249`).

## delivery_os building blocks

- `data/validators.ts:140-159` `projectCreateSchema`, `projectUpdateSchema` (no tenant/org fields, zod strips
  unknown keys, `draftSpec` = `draftSpecV1Schema` with `duplicate_stable_id` and `invalid_comment_anchor` issues).
- `lib/contracts.ts:22-143` error catalogue, `buildDeliveryError`, `deliveryErrorFromZod` (custom delivery code →
  its status, shape issue → `400 validation_failed`), `DEFAULT_DELIVERY_LIMITS` (`:311`).
- `lib/targetProfiles.ts:140-144` `TARGET_PROFILES`, `getTargetProfile(id, version)`; no "latest version" helper yet.
- `lib/attempts.ts:90-111` `parseAttemptRegister`, `isAttemptActive`, `hasUnreconciledAttempt`, `isArchiveBlocked`.
- `events.ts:90` `emitDeliveryOsEvent(id, payload, { tenantId, organizationId })`; `project.created` payload
  `{ projectId, tenantId, organizationId }`.
- `data/entities.ts:22-76` `DeliveryProject` has no status column (status is derived by `lib/projectStatus.ts`);
  `DeliveryTask.executionAttempts` is the jsonb register.
- Spec `.ai/specs/2026-09-18-delivery-os-hackathon.md:298,329,333,425`: archive answers `409 attempt_active`
  (active attempt or task) and `409 reconciliation_required` (unknown state); the breakdown's `active_attempt`
  was renamed to `attempt_active` and the spec is authoritative.

## Open Questions

None blocking. "Active task status" is not enumerated in the spec; decided in the plan.
