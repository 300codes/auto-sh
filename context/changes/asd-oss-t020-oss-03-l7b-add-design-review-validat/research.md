---
date: 2026-09-19T06:20:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: b9972c5f3
branch: dev-mateusz
repository: open-mercato
topic: "Design screens and attachments in delivery_os baselines; attachments module read API"
tags: [research, codebase, delivery_os, attachments, baselines]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: design screens and attachments in delivery_os baselines; attachments read API

## Research Question

How do delivery_os baselines currently handle design screens and attachments (commands, contracts, error codes), and
what read API + storage driver does `packages/core/src/modules/attachments` expose to load an attachment by id scoped to
tenant + organization and read its stored bytes without an ORM relation?

## Summary

- `delivery_os.baselines.create` already checks attachment **scope by id only** (`checkAttachmentScope`,
  `commands/baselines.ts:88-111`): one `findWithDecryption(Attachment, { id: { $in }, tenantId, organizationId })`, missing
  and foreign both answer `422 attachment_scope_mismatch` with one detail per reference path. Bytes, type and size are not
  verified (spec changelog T012 says "hash/size/type verification of the bytes is OSS-03").
- `lib/designReview.ts` does not exist. Screen/comment shape lives only in zod: `designScreenSchema`
  (`lib/contracts.ts:278-288`: fileKey, nodeId, name, viewport, attachmentId, sha256, capturedAt, figmaVersion?),
  `screenRefSchema` (nullable fileKey/nodeId), `attachmentRefSchema` `{attachmentId, sha256}` (`:298`),
  `commentAnchorSchema` (0–1 → `invalid_comment_anchor`, `:455`), `designManifestV1Schema` (`:576`). A screen without
  `attachmentId` fails as a generic `400 validation_failed`; `temporary_url_only` (422) exists in the catalogue but no code
  path produces it. Nothing checks duplicate screens or that a comment targets a known screen.
- All error codes needed already exist: `missing_render`, `temporary_url_only`, `attachment_scope_mismatch`,
  `attachment_hash_mismatch`, `invalid_comment_anchor`, `duplicate_stable_id`, `foreign_reference`, `validation_failed`,
  `payload_too_large` (`lib/contracts.ts:30-80`).
- Attachments module: entity `Attachment` (`attachments/data/entities.ts:51-101`) has `id, entityId, recordId,
  organizationId?, tenantId?, partitionCode, fileName, mimeType, fileSize, storageDriver, storagePath, …` — **no hash
  column, no soft delete, no encrypted fields**. Bytes: DI key `storageDriverFactory` (`attachments/di.ts:45`) →
  `resolveForPartition(partitionCode, { tenantId, organizationId })` → `driver.read(partitionCode, storagePath)` →
  `{ buffer }` (`attachments/lib/drivers/types.ts:22-33`, `driverFactory.ts:30-93`). `lib/storage.ts` is deprecated.
  `attachmentService.readScoped` needs a full AuthContext + expected owner, too heavy for a command.
- Reference usage from another module: `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/attachmentStager.ts:52-72`
  (findOneWithDecryption by id + tenant + org, then factory → driver.read) with structural `StorageDriverFactoryLike` types.

## Detailed Findings

### delivery_os today
- `commands/baselines.ts:139-212` — transaction: lock project (`force: true`) → parse stored draft → `checkDraftFreezable`
  → `buildBaselineContent` → `checkAttachmentScope` → identical-hash lookup → create row with `attachmentIds`.
- `lib/baseline.ts:106-143` — `buildBaselineContent` clones the draft, copies resolved comments, parses with
  `baselineContentV1Schema`, hashes canonically.
- Test kits: `commands/__tests__/baselineTestKit.ts` (`makeHarness` services map `{ em, dataEngine }`, container.resolve
  throws for unknown keys; `draftAttachmentRows` builds `{id, tenantId, organizationId}` rows) and
  `api/__tests__/routeTestKit.ts:143-165` (services map, returns `undefined` for unknown keys). Both the command suite,
  `api/__tests__/baselines.route.test.ts` and `api/__tests__/manualFlow.route.test.ts` create baselines from the
  `baseline-content` fixture, whose sha256 `238ec85f…` is an arbitrary value (not derived from known bytes).
- `di.ts` registers only `deliveryOsAttemptQueries`.

### Consequences for the design
- A fake at **byte** level cannot satisfy the frozen fixture hash, so the injectable seam should return the inspected
  facts (`sha256`, `sizeBytes`) and the real implementation (bytes → sha256) gets its own unit test with a fake driver.
- Size/type are not part of `designScreenSchema` / `attachmentRefSchema`; contract v1 is additive-only, so they can only
  be added as optional fields.

## Code References
- `packages/core/src/modules/delivery_os/commands/baselines.ts:78-111` — reference collection and scope check
- `packages/core/src/modules/delivery_os/lib/contracts.ts:278-299,455-470,576-582` — screen, attachment ref, comment, manifest
- `packages/core/src/modules/attachments/lib/drivers/driverFactory.ts:30-93` — `resolveForPartition`
- `packages/core/src/modules/attachments/api/file/[id]/route.ts:45-83` — canonical load + read
- `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/attachmentStager.ts:52-72` — cross-module example

## Architecture Insights
ID + snapshot coupling (C11): delivery_os keeps attachment ids and a verified snapshot, never an ORM relation.

## Historical Context
- T012 (`.ai/specs/2026-09-18-delivery-os-hackathon.md` changelog) deferred byte verification to OSS-03.
- T019 decided: no new error codes, rule-specific `details[].code`, all content problems collected in one body.

## Open Questions
None blocking; choices are recorded in the plan.
