<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-03 (L7b) Design-Review Validation and Attachment Verification for Baselines

- **Plan**: context/changes/asd-oss-t020-oss-03-l7b-add-design-review-validat/plan.md
- **Mode**: Deep (claims verified directly against the code, no sub-agent needed)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
6/6 paths ✓ (`commands/baselines.ts`, `lib/contracts.ts`, `di.ts`, both test kits, spec), 4/4 symbols ✓
(`checkAttachmentScope`, `parseVersioned`, `storageDriverFactory`, `designManifestV1Schema`), brief↔plan ✓, Progress↔Phase ✓.

## Findings

### F1 — Stored mime type is whatever the uploader declared

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — commands/attachments.ts
- **Detail**: `Attachment.mimeType` comes from the upload request. A text file uploaded as `image/png` would pass the
  "render is an image" rule although the bytes are already in memory for hashing.
- **Fix**: the inspector also returns `detectedMimeType` from the magic bytes (png, jpeg, webp, pdf; else null); a screen
  needs `detectedMimeType` equal to the stored type, otherwise `missing_render` / `render_bytes_not_image`.
  - Strength: real "render bytes" guarantee for ~15 lines. Tradeoff: one more fact in the seam. Confidence: HIGH.
- **Decision**: FIXED

### F2 — DI registration must not resolve `storageDriverFactory` eagerly

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — di.ts
- **Detail**: `di.ts` uses the `{ resolve: (c) => … }` form (`di.ts:7-9`). Resolving the factory at registration/resolve
  time couples container construction to the attachments registrar order.
- **Fix**: register `deliveryOsAttachmentInspector` in the same form and resolve `storageDriverFactory` lazily inside the
  inspector call.
- **Decision**: FIXED

### F3 — "parseVersioned-style" is not a contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — validateDesignManifest
- **Fix**: call `parseVersioned({ [DELIVERY_SCHEMA_VERSIONS.designManifest]: designManifestV1Schema }, raw)` so an unknown
  version answers `unsupported_schema_version` like every other manifest; the raw render check runs after the version
  check and before the shape parse.
- **Decision**: FIXED

### F4 — Snapshot fields reach TaskPackage `designArtifactRefs`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — contracts
- **Detail**: `screenRefSchema` is reused by `taskPackageV1Schema` (`lib/contracts.ts:347`), so new baselines export screens
  with `sizeBytes` / `mimeType`. OSS schemas are non-strict; a strict copy on the EXEC side would reject them.
- **Fix**: keep the additive fields, add a contract test that a package screen with the fields parses, and call it out in
  the hand-over for EXEC/UI.
- **Decision**: FIXED

### F5 — URL heuristic scope

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Detail**: "any string value starting with http" only runs for screens without `attachmentId`, so it cannot reject a
  valid screen. Keep.
- **Decision**: DISMISSED — no false-positive path.
