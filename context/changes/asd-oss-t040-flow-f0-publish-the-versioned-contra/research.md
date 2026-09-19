---
date: 2026-09-19T13:00:00+02:00
researcher: Claude (OSS stream, autonomous)
git_commit: 0382f9ea2
branch: dev-mateusz
repository: open-mercato
topic: "Which frozen v1 surfaces must the FLOW-F0 delta stay additive against, and which staff/workflows public seams can it reference by id?"
tags: [research, codebase, delivery_os, staff, workflows, contracts]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude (OSS stream, autonomous)
---

# Research: frozen v1 surfaces and the public seams for the FLOW-F0 delta

**Date**: 2026-09-19 13:00 +02:00 · **Git Commit**: 0382f9ea2 · **Branch**: dev-mateusz · **Repository**: open-mercato

## Research Question

Which frozen v1 surfaces (contracts.ts schemas, decision kinds, validators, fixture tests, ACL, events) must the
FLOW-F0 contract delta stay additive against, and which staff / workflows public seams (task and comment commands,
definition `workflowId` + `version`) can the delta reference by id?

## Summary

- v1 is frozen at `DELIVERY_CONTRACT_VERSION = 1` with eight `schemaVersion` strings in `DELIVERY_SCHEMA_VERSIONS`
  (`lib/contracts.ts:6-15`), the error catalogue `deliveryErrorCodes` (`:24-79`), the route map R1–R22 and the
  decision kinds `requirements | design | deploy | release` (`data/validators.ts:219-228, 491-508`;
  `commands/decisions.ts`). The delta must add a new version constant and new `schemaVersion` strings, never
  change these.
- The fixture catalogue test only enumerates `lib/fixtures/negative/*.v1.json` (`lib/__tests__/fixtures.test.ts:218-219`),
  so a sibling folder `lib/fixtures/flow/` with its own `negative/` subfolder and index leaves the v1 tests untouched.
- Dispatch already refuses an unapproved / inactive baseline (`commands/tasks.ts:356-360`, `commands/attempts.ts:218`,
  `lib/baseline.ts:224-255`); the flow gate is an additional check layered at the same points (reserve, ready
  transition, deploy decision) — it cannot loosen them.
- Staff exposes public command ids `staff.timesheets.tasks.{create,update,delete,status_change}`
  (`staff/commands/timesheets-tasks.ts:79-84`), `staff.timesheets.task_comments.{create,update,delete}`
  (`staff/commands/timesheets-task-comments.ts:64-68`) and `staff.timesheets.time_projects.{create,update,delete}`;
  routes `/api/staff/timesheets/tasks`, `/tasks/[id]/comments`, `/tasks/[id]/status`. Create schemas:
  `staffTimeTaskCreateSchema { timeProjectId, parentTaskId?, taskStatusId?, title ≤255, description ≤8000, assigneeStaffMemberId?, position?, tagIds? }`,
  `staffTimeTaskCommentCreateSchema { taskId, body ≤5000, authorUserId? }` (`staff/data/validators.ts:566-605`).
  Entities are module-internal (staff AGENTS.md MUST rule 1-2); delivery links by id only.
- Workflows identify a definition by `(workflowId, version, tenantId)` (`workflows/data/entities.ts:279`) and an
  instance by `definitionId` + `workflowId` + `version` (`:444-450`); instances are started only through the DI
  `workflowExecutor` (workflows AGENTS.md rules 1-2). The delta stores those ids and a content hash as a snapshot.
- Encryption maps are declared per module in `encryption.ts` as `defaultEncryptionMaps: ModuleEncryptionMap[]`
  with `{ entityId, fields: [{ field, hashField? }] }` (`messages/encryption.ts`). delivery_os has none yet; the
  delta lists the new PII fields for that file.

## Detailed Findings

### Frozen v1 contract surface (`packages/core/src/modules/delivery_os/lib/contracts.ts`)

- `DELIVERY_CONTRACT_VERSION`, `DELIVERY_SCHEMA_VERSIONS`, `deliveryErrorCodes`, `deliveryDocumentSchemas` are the
  v1 exports imported by `lib/__tests__/contracts.test.ts` and `fixtures.test.ts`; both tests assert exact
  membership, so new schema versions must go into a **separate** map (`deliveryFlowDocumentSchemas`) and a new
  constant, not into `DELIVERY_SCHEMA_VERSIONS` / `deliveryDocumentSchemas`.
- `deliveryErrorCodes` is an object literal keyed by code; the error-body schema enum is derived from it. Adding
  keys is additive (existing codes and statuses unchanged) — but `error-body` fixtures and tests only assert
  membership of existing codes, so new codes are safe.
- Helpers to reuse: `uuidSchema`, `sha256Schema`, `isoDateTimeSchema`, `stableIdSchema`, `idempotencyKeySchema`,
  `attachmentRefSchema`, `sourceRevisionSchema`, `addDeliveryIssue`, `parseVersioned`, `buildDeliveryError`.

### Frozen decision model

- `delivery_decisions.kind ∈ requirements | design | deploy | release`, `subject_type ∈ baseline | deployment_evidence`
  (`data/entities.ts:284-306`, spec § Data Models). The addendum forbids overloading `design`. The delta therefore
  introduces a **new table** for stage decisions (`delivery_stage_decisions`) with its own `stage` enum
  (`scope | ux | key_visual | design_system_ui`), instead of extending the frozen enum.
- `lib/baseline.ts:224` — `activeBaselineId` flips only when requirements **and** design are approved for the same
  hash; unchanged.

### Where the server-side gate must hook (implementation later, F1)

- `commands/tasks.ts:356-360` (ready transition → `baseline_not_approved` / `baseline_not_active`),
  `commands/attempts.ts:218` (reserve → `baseline_not_active`), `commands/decisions.ts:363` (deploy consent),
  `lib/deliveryReport.ts` gates. A new pure `lib/stageGate.ts#checkStageGate` is called at the same points, giving a
  new `422 stage_not_approved` error with details per missing/stale stage.

### Fixture tests

- `fixtures.test.ts:218` lists `readdirSync(join(fixturesDir, 'negative'))` filtered on `.v1.json` and compares to
  the v1 catalogue. A `flow/` subfolder is invisible to it. `positiveDeliveryFixtures` is `as const` and asserted
  by name — new positive fixtures need their own array.

### Staff public seams (`packages/core/src/modules/staff/AGENTS.md`)

- Commands (BC-stable ids): tasks `create/update/delete/status_change`, task comments `create/update/delete`,
  time projects `create/update/delete`. Every command validates `tenantId` + `organizationId` from the command
  context (`ensureTenantScope`, `ensureOrganizationScope`, `timesheets-tasks.ts:479-481`).
- Access: `timeTrackingAccessResolver.resolveProjectAccess` + `assertProjectAccess` (DI key, STABLE); a caller
  without membership of the staff project sees a 404-shaped answer. The delivery import must run the same check
  for the linked staff project before creating cards.
- Task comment body max 5000 chars, task title max 255, description max 8000 — the normalised Figma payload has to
  fit (long comment bodies are truncated with the full text kept in the delivery-side thread row).
- Kanban columns are per-project `task-statuses`; "Done" is a status row, not a boolean — so "Done never sets
  `verified`" is enforced by never subscribing delivery task status to `staff.timesheets.time_task.status_changed`
  for anything but a display mirror.

### Workflows public seams

- `WorkflowDefinition` unique on `(workflowId, version, tenantId)`; `WorkflowInstance` carries `definitionId`,
  `workflowId`, `version`, `status`. Start via `container.resolve('workflowExecutor').startWorkflow()`.
  The delta pins `{ templateId (= workflowId), templateVersion, templateHash, definitionId, workflowInstanceId }`
  on the project as a snapshot (no ORM relation).

### Encryption

- Pattern: `packages/core/src/modules/messages/encryption.ts` (`defaultEncryptionMaps`, `ModuleEncryptionMap`
  from `@open-mercato/shared/modules/encryption`). Reads go through `findWithDecryption`.

## Code References

- `packages/core/src/modules/delivery_os/lib/contracts.ts:4-15, 24-79, 857-865` — version constants, error codes, schema map
- `packages/core/src/modules/delivery_os/lib/fixtures/index.ts` — positive/negative catalogue pattern
- `packages/core/src/modules/delivery_os/lib/__tests__/fixtures.test.ts:142-290` — catalogue assertions
- `packages/core/src/modules/delivery_os/data/validators.ts:84-160, 219-228, 491-508` — draftSpec, decision bodies
- `packages/core/src/modules/delivery_os/commands/tasks.ts:356-360`, `commands/attempts.ts:218`, `commands/decisions.ts:254-363` — gate hook points
- `packages/core/src/modules/staff/commands/timesheets-tasks.ts:79-84`, `timesheets-task-comments.ts:64-68`, `staff/data/validators.ts:566-605` — staff seams
- `packages/core/src/modules/workflows/data/entities.ts:279-292, 444-453` — definition / instance identity
- `packages/core/src/modules/messages/encryption.ts` — encryption map shape

## Architecture Insights

- Everything in delivery_os is "pure lib + command + thin route"; the F0 delta keeps that: schemas and pure gate
  rules live in `lib/`, commands and routes come in F1+.
- Append-only tables (`baselines`, `evidence`, `decisions`) carry no `updated_at`; editable ones carry it and use
  the platform optimistic lock header. The delta follows the same split: drafts / links / sync state editable,
  artifacts / stage decisions / comment threads append-only (thread rows get an `updated_at` only for the sync
  cursor, never for the imported content, which is versioned by `revision`).

## Historical Context (from prior changes)

- `context/changes/delivery-os-oss-domain/handover/OSS-02-H4-contracts.md` — the H4 hand-over format (import table,
  scope rules, error responses) reused for `FLOW-F0-contracts.md`.
- `context/changes/asd-oss-t036-*` decisions: foreign-scope writes answer 404; the platform lock helper echoes
  the caller's token on 409 — the delta keeps those semantics for the new routes.

## Related Research

- `.ai/specs/2026-09-19-delivery-project-flow-addendum.md` (product addendum, main-only; provided verbatim in the task).

## Open Questions

- Whether the Figma provider (Adam) can deliver `figmaVersion` per comment — the payload marks it optional and the
  thread row records `versionConfirmed: false` when absent (decided in the plan).
- Whether Marcin's project workflow uses one instance per project or per stage — the pin stores one
  `workflowInstanceId` per project plus an optional per-stage `stepRef` (decided in the plan).
