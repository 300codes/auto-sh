# OSS-03 (L7b) Design-Review Validation and Attachment Verification for Baselines — Implementation Plan

## Overview

Make a baseline a trustworthy snapshot of the design input (UA-05, BN-05/BN-07): add the pure `lib/designReview.ts`
(screens, comments, tokens, DesignManifest v1, stored-attachment comparison) and make `delivery_os.baselines.create`
verify every referenced attachment against the attachments module — tenant + organization scope, type, size and the
sha256 of the stored bytes — before anything is frozen. The verified `attachmentId + sha256 + sizeBytes + mimeType`
snapshot lands in the baseline content. Coupling stays "id + snapshot": no ORM relation.

## Current State Analysis

See `research.md`. In short: scope-by-id check only (`commands/baselines.ts:88-111`); no byte/type/size verification;
`lib/designReview.ts` missing; `temporary_url_only` never produced; nothing checks duplicate screens or comment targets.
All needed error codes exist. Attachments bytes are read through DI `storageDriverFactory` →
`resolveForPartition(partitionCode, scope)` → `driver.read(partitionCode, storagePath)`.

## Desired End State

- `POST /projects/:id/baselines` (manual) answers, all as the frozen error body with every problem in `details[]`:
  - `422 attachment_scope_mismatch` — missing and foreign attachment, byte-identical bodies;
  - `422 missing_render` — a screen whose stored file is not a raster image (`unsupported_mime_type`), is empty
    (`empty_attachment`) or above 10 MiB (`attachment_too_large`); a raw screen without `attachmentId`;
  - `422 temporary_url_only` — a raw screen that carries only a URL;
  - `422 attachment_hash_mismatch` — stored bytes hash ≠ declared (`sha256_mismatch`), declared size/type ≠ stored
    (`size_mismatch`, `mime_type_mismatch`), unreadable bytes (`attachment_unreadable`), other attachment too large or of a
    type outside the allowlist;
  - `422 duplicate_stable_id` (duplicate screen), `422 foreign_reference` (comment on unknown screen),
    `422 invalid_comment_anchor` (anchor without screen / outside 0–1), `400 validation_failed` (`invalid_token_value`).
- A valid draft freezes; `content.screens[*]` and `content.attachments[*]` carry verified `sizeBytes` + `mimeType`;
  the identical draft again returns the existing baseline (`duplicate: true`, no second row).
- `grep -rn "ManyToOne\|OneToMany\|ManyToMany\|OneToOne" packages/core/src/modules/delivery_os/data` finds nothing.
- delivery_os jest scope and core typecheck green.

### Key Discoveries:

- The `baseline-content` fixture sha256 (`238ec85f…`) is arbitrary, so a byte-level fake cannot satisfy it. The
  injectable seam therefore returns inspected facts `{ sha256, sizeBytes }`; the real bytes→sha256 implementation gets
  its own unit test with a fake storage driver.
- Contract v1 is additive-only: `sizeBytes` / `mimeType` can only be **optional** on `designScreenSchema` and
  `attachmentRefSchema`. Fixtures without them keep their hashes.
- `draftSpecV1Schema` strips unknown keys and requires `attachmentId`, so a URL-only screen can only be seen on RAW input;
  the raw check runs on the stored draft before the zod parse.
- Both test kits resolve services by name (`baselineTestKit.ts:makeHarness`, `routeTestKit.ts:143-165`); three suites
  create baselines from the fixture draft and need the fake inspector.

## What We're NOT Doing

- No requirements/plan import commands, merged-baseline transaction or route changes (next L7 task).
- No upload endpoint, no thumbnailing, no virus scan, no SVG (scriptable, not a render).
- No design check on draft save (R3 stays lenient; strictness applies at freeze). No change to `api/**` route files.
- No new error code, schema version, DI contract removal, migration or ORM relation.
- Result-manifest artifact hashes (`checkArtifactAttachments`, OSS-04) stay a pass-through; the helper is written reusable.

## Implementation Approach

Pure rules in `lib/designReview.ts`; I/O in `commands/attachments.ts`; orchestration in `commands/baselines.ts`.
Order inside the transaction (after the project lock): raw screen check → draft parse → `checkDraftFreezable` →
`checkDesignReview` → load attachment rows (scope) → inspect each distinct attachment once → pure comparison →
one combined error (top code priority `attachment_scope_mismatch` > `missing_render` > `attachment_hash_mismatch`) →
apply the verified snapshot to the draft → `buildBaselineContent` → identical-hash lookup → insert.

## Critical Implementation Details

- **Ordering**: the snapshot must be applied BEFORE `buildBaselineContent`, otherwise the content hash would not cover the
  verified size/type and the duplicate lookup would compare different content.
- **Determinism**: the snapshot always writes the STORED values (normalized lower-case mime without parameters), also when
  the draft declared them, so the same draft always hashes the same.
- **Cost gate**: compare `Attachment.fileSize` with the limit before reading bytes, and the real byte length after.

## Phase 1: Pure design-review rules

### Changes Required:

#### 1. Additive contract fields
**File**: `lib/contracts.ts`
**Intent**: let a screen / attachment ref carry the verified size and type.
**Contract**: `designScreenSchema` and `attachmentRefSchema` gain optional `sizeBytes: int ≥ 0` and
`mimeType: string 1..200`. `screenRefSchema` inherits. Nothing else changes.

#### 2. `lib/designReview.ts` (new, pure, no ORM / data imports)
**Intent**: one place for the design-input rules used by the baseline command and later by the design import.
**Contract** (exports):
- `DESIGN_RENDER_MIME_TYPES = ['image/png','image/jpeg','image/webp']`, `BASELINE_ATTACHMENT_MIME_TYPES` (renders +
  `application/pdf`, `text/plain`, `text/markdown`, `application/json`), `MAX_BASELINE_ATTACHMENT_BYTES = 10 * 1024 * 1024`.
- `normalizeMimeType(value)`.
- `checkRawScreenRenders(rawScreens: unknown): DeliveryCheckResult` — entry without a string `attachmentId`: with a
  URL-like field (`url`, `imageUrl`, `renderUrl`, `screenshotUrl`, `thumbnailUrl`, or any string value starting with
  `http://`/`https://`) → `temporary_url_only`, else `missing_render`; top code `temporary_url_only` when any.
- `checkDesignReview({ screens, comments, tokens }): DeliveryCheckResult` — duplicate `attachmentId` or duplicate
  `fileKey+nodeId+viewport` → `duplicate_stable_id`; comment `screenAttachmentId` not among screens → `foreign_reference`
  (`unknown_screen`); anchor without screen (`anchor_without_screen`) or outside 0–1 → `invalid_comment_anchor`; token
  leaf not string / finite number / boolean, or nesting deeper than 4 → `validation_failed` (`invalid_token_value`).
  Fixed priority: duplicate_stable_id > foreign_reference > invalid_comment_anchor > validation_failed; all details in one body.
- `validateDesignManifest(raw): { ok: true; manifest: DesignManifestV1 } | error` — version check through
  `parseVersioned({ [designManifest]: designManifestV1Schema }, raw)` semantics (`unsupported_schema_version` first), with
  `checkRawScreenRenders(raw.screens)` run after the version check and before the shape parse, then `checkDesignReview`
  (no comments). (plan-review F3)
- `checkStoredAttachment({ path, role: 'screen' | 'attachment', declared, stored }): DeliveryErrorDetail[]` and
  `buildAttachmentVerificationError(details)` (top-code priority above), `applyAttachmentSnapshot(draft, factsById)`.

#### 3. Tests
**File**: `lib/__tests__/designReview.test.ts` (new) — every rule with a failing input and a passing twin; the
`design-manifest` fixture passes; `lib/__tests__/contracts.test.ts` gets one case for the optional fields, including a
TaskPackage screen carrying them (plan-review F4; called out for EXEC/UI in the hand-over).

### Success Criteria:

#### Automated Verification:
- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` green
- `grep -rnE "mikro-orm|from '\.\./data" packages/core/src/modules/delivery_os/lib/designReview.ts` finds nothing

---

## Phase 2: Attachment verification in the baseline command

### Changes Required:

#### 1. `commands/attachments.ts` (new)
**Intent**: the only place that talks to the attachments module.
**Contract**: `DeliveryAttachmentInspector = (attachment: { id, partitionCode, storagePath }, scope) => Promise<{ sha256, sizeBytes, detectedMimeType }>`
(`detectedMimeType` from magic bytes: png, jpeg, webp, pdf, else `null`; a screen whose detected type differs from the stored
type answers `missing_render` / `render_bytes_not_image` — plan-review F1);
`createDeliveryAttachmentInspector(factory: StorageDriverFactoryLike)` (structural type, reads bytes via
`resolveForPartition` + `driver.read`, sha256 with `node:crypto`); `verifyDraftAttachments(tx, ctx, draft, scope)` →
`{ ok: true; factsById } | error` — scoped `findWithDecryption(Attachment, { id: $in, tenantId, organizationId })`, size gate,
inspector resolved from DI key `deliveryOsAttachmentInspector`, an inspector throw → `attachment_unreadable`.

#### 2. `di.ts`
**Contract**: additive key `deliveryOsAttachmentInspector` in the existing `{ resolve: (c) => … }` form; `storageDriverFactory`
is resolved lazily inside the inspector call, never at registration (plan-review F2).

#### 3. `commands/baselines.ts`
**Intent**: replace `checkAttachmentScope` with the full verification in the order given in Implementation Approach;
`attachmentIds` column unchanged.

#### 4. Test kits and suites
**Files**: `commands/__tests__/baselineTestKit.ts` (rows get `mimeType`, `fileSize`, `partitionCode`, `storagePath` and a
test-only `storedSha256`; `makeHarness` registers a fake inspector reading the row), `api/__tests__/routeTestKit.ts`
(same fake), `commands/__tests__/baselines.test.ts` (new cases below), `commands/__tests__/attachments.test.ts` (new:
real inspector hashes `abc` correctly through a fake driver and passes the scope to the factory).
New command cases: missing = foreign body; sha mismatch; oversize (bytes never read); wrong mime on a screen; unreadable
bytes; declared size mismatch; snapshot in content + hash covers it; identical draft → duplicate, one row; URL-only raw
screen; duplicate screen; comment on unknown screen.

#### 5. Docs
**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (attachments rows, DesignManifest/BaselineContent rows, UA-05
row, changelog), `context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md` (T020 addendum).

### Success Criteria:

#### Automated Verification:
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- Core typecheck green: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`
- New test files type-check with a temporary tsconfig extending `packages/core/tsconfig.json`
- No ORM relation decorators in `delivery_os/data`

#### Manual Verification:
- Live smoke on http://localhost:3100: upload a PNG, save a draft with the right and a wrong sha256, create a baseline
  (201 with snapshot / 422 `attachment_hash_mismatch`)

---

## Testing Strategy

Unit tests only (OSS owns them); integration spec TC-DELIVERY-002 is QA's. Live smoke by script as evidence.

## Performance Considerations

Bytes are read sequentially inside the project-lock transaction: ≤ 300 references × ≤ 10 MiB worst case, realistically
1–10 renders. Distinct attachments are read once. Accepted for the hackathon; noted as a limitation.

## Migration Notes

None. Existing baselines stay valid (optional fields).

## References

- Research: `context/changes/asd-oss-t020-oss-03-l7b-add-design-review-validat/research.md`
- Cross-module read example: `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/attachmentStager.ts:52-72`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure design-review rules

#### Automated

- [x] 1.1 delivery_os lib jest scope green
- [x] 1.2 designReview.ts has no ORM or data imports

### Phase 2: Attachment verification in the baseline command

#### Automated

- [x] 2.1 delivery_os jest scope green
- [x] 2.2 Core typecheck green
- [x] 2.3 New test files type-check with a temporary tsconfig
- [x] 2.4 No ORM relation decorators in delivery_os/data

#### Manual

- [ ] 2.5 Live smoke: PNG upload, right and wrong sha256, baseline 201 / 422
