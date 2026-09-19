# Delivery OS contracts v1, canonical hash and error catalogue — Implementation Plan

## Overview

Turn the frozen contract names of `.ai/specs/2026-09-18-delivery-os-hackathon.md` into executable zod schemas
(`delivery_os/lib/contracts.ts`) plus a canonical hash helper (`lib/hash.ts`), so UI, EXEC and QA can build on
real types and OSS commands (next tasks) validate every manifest the same way. "The agent proposes, the system
decides" starts here: nothing an agent sends is trusted before it passes these schemas.

## Current State Analysis

- `packages/core/src/modules/delivery_os/` does not exist. The spec (T003) froze names, `schemaVersion` strings,
  the error body and the code catalogue; nothing is executable yet.
- zod `4.4.3` in core; callbacks modelled with `z.custom` (`staff/lib/time-tracking/componentContracts.ts:16`).
- No shared canonical-JSON helper; `node:crypto` `createHash('sha256')` is used directly across the repo.
- Jest for core: `packages/core/jest.config.cjs`, tests in `lib/__tests__/*.test.ts`.

## Desired End State

`import { taskPackageV1Schema, parseVersioned, deliveryErrorCodes, … } from '@open-mercato/core/modules/delivery_os/lib/contracts'`
works for every stream. A document with a missing, unknown or wrong-type `schemaVersion` is rejected with
`unsupported_schema_version` before its shape is looked at; a shape or rule violation yields
`{ error, code, details[] }` with deterministic codes. `hashCanonical` gives the same sha256 for the same
content regardless of key order. Verified by the scoped jest run, core typecheck and three greps.

### Key Discoveries:

- `schemaVersion` is a typed string per document (spec:167-179), so `parseVersioned` dispatches on a
  `schemaVersion → schema` map and also rejects a valid version of another document type.
- The frozen rejection code is `unsupported_schema_version` (spec:324); the task text's `unknown_schema_version`
  and eight other names come from the pre-spec breakdown. Spec changelog (spec:402) and the T003 decision make the
  spec authoritative. Mapping recorded in `research.md`; it must also be repeated in the task hand-over
  (decisions and notes), because a reviewer reading the task text will look for the old names.
- QA asserts "tenant in manifest ignored" (spec:352): transport objects strip unknown keys instead of failing, so
  scope fields never survive parsing; only `SourceRevision` variants are strict (a snapshot with `commitSha` must fail, plan.md:123).

## What We're NOT Doing

- No fixtures (`lib/fixtures/*.v1.json`), no `lib/targetProfiles.ts` — next task (L1b). Profile-dependent rules
  (which revision kind a profile allows, test catalogue membership) stay in later domain libs.
- No `DeliveryReport v1` schema (OSS-05); only its `schemaVersion` string constant is reserved.
- No entities, validators for routes, commands, routes, `index.ts`, `yarn generate`, migrations.
- No cycle detection (`lib/dag.ts`) or path containment (`lib/allowedPaths.ts`); contracts only check the
  path *shape* (relative, no `..`, no backslash).

## Implementation Approach

Two pure files, no platform imports beyond `zod` and `node:crypto`. Schemas are composed from small shared
primitives (ids, hashes, stable ids, repo-relative path, `SourceRevision`). Cross-field rules use `superRefine`
with a delivery code carried in the custom issue `params.code`, which `parseVersioned` copies into
`details[].code`. Top-level code is deterministic: if any issue is a plain shape issue the result is
`validation_failed` (400); otherwise it is the delivery code of the first issue in zod order, with the HTTP status
taken from the catalogue. Every issue stays in `details[]`.

## Critical Implementation Details

- **Ordering in `parseVersioned`**: read `schemaVersion` from the raw input first (non-object, missing,
  non-string, not in the map → `unsupported_schema_version`), only then run the mapped schema. A test proves it by
  sending an unknown version together with an otherwise invalid body and expecting only the version code.
- **Strip vs strict**: objects use zod's default strip. `SourceRevision` variants use `z.strictObject`.
- **Usage truth**: `usage.values` is `'unknown'` or an object with at least one non-negative number; `{}` is
  rejected so "unknown" can never be written as an empty/zero cost (plan.md:198).

## Phase 1: Canonical hash

### Overview

Deterministic hashing used for baseline content, payloads, manifests and idempotency payloads.

### Changes Required:

#### 1. Hash helper

**File**: `packages/core/src/modules/delivery_os/lib/hash.ts`

**Intent**: Canonical JSON serialisation and sha256 so equal content always has an equal hash.

**Contract**: `canonicalize(value: unknown): string` — object keys sorted by code unit recursively, `undefined`
properties dropped, arrays keep order (`undefined` items become `null` like JSON), `Date` → ISO string; throws
`[internal]`-prefixed errors for non-finite numbers, `bigint`, functions, symbols and circular references.
`sha256Hex(input: string | Uint8Array): string`. `hashCanonical(value: unknown): string`.
`SHA256_HEX_PATTERN` exported for the contracts.

#### 2. Tests

**File**: `packages/core/src/modules/delivery_os/lib/__tests__/hash.test.ts`

**Intent**: Prove order independence, content sensitivity and the rejected inputs.

**Contract**: literal canonical string expectation; published sha256 vector for `abc`; key order and nested key
order → same hash; changed value, changed array order, `0` vs `'0'`, `null` vs missing → different/explicit
result; `undefined` property equals missing property; NaN/bigint/function/circular throw `[internal]`.

### Success Criteria:

#### Automated Verification:

- Hash tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/hash.test.ts --maxWorkers=2`

---

## Phase 2: Contracts v1, error catalogue and parseVersioned

### Overview

All v1 schemas, inferred types, the code catalogue and the versioned parser.

### Changes Required:

#### 1. Contracts

**File**: `packages/core/src/modules/delivery_os/lib/contracts.ts`

**Intent**: Executable source of truth for every DTO named in spec § *Contracts v1* except the report.

**Contract** (exports; every schema has a `z.infer` type with the same base name):

- `DELIVERY_CONTRACT_VERSION = 1`; `DELIVERY_SCHEMA_VERSIONS` (`taskPackage`, `resultManifest`,
  `baselineContent`, `requirementsProposal`, `planProposal`, `designManifest`, `report`, `executionWidgetContext`
  → the frozen strings); `DELIVERY_EXECUTION_SPOT_ID = 'delivery_os.project.execution'`,
  `DELIVERY_EXECUTION_CONTEXT_CONTRACT = 'delivery_os.project.execution.v1'`.
- Primitives: `sourceRevisionSchema` (strict discriminated union), `repoRelativePathSchema`
  (issue code `path_not_allowed`), stable-id, sha256, commit-sha (40 or 64 hex), uuid helpers, `deliveryLimitsSchema`.
- `taskPackageV1Schema`: fields of spec:172. Rules: git `baseRevision` ⇒ `baseCommit` required and equal to
  `commitSha`; snapshot ⇒ `baseCommit` absent (`revision_kind_mismatch`); `validationProfile.requiredTests` keys
  and every `acceptanceCriteria[].requirementId` must exist in the package (`unknown_ac` / `foreign_reference`).
- `resultManifestV1Schema`: fields of spec:173. Rules: base and result revision of the same kind; git ⇒ both
  commits required and equal to their revision; snapshot ⇒ both absent; check status enum is exactly
  `passed | failed | not_run`; `agentDeclaration` is its own optional object; `usage` per *Usage truth*; bounded array sizes.
- `baselineContentV1Schema`: requirements/AC with stable unique ids (`duplicate_stable_id`), AC → existing
  requirement, screens with `attachmentId + sha256 + fileKey + nodeId + capturedAt + figmaVersion?`, `tokens`,
  `architectureSummary`/`planSummary`, `acTestMap` and `manualChecks` keyed by existing AC (`unknown_ac`),
  `attachments[{attachmentId, sha256}]`, `resolvedComments`, `importedManifestHashes[]`.
- `requirementsProposalV1Schema`, `planProposalV1Schema` (unique `proposalTaskKey`, `dependsOn` only to keys of
  the same proposal and not to itself → `foreign_dependency`), `designManifestV1Schema`.
- `executionAttemptSchema` with the states, `stopConfirmation`, `reconciliation`, `completionDelivery` of spec:126;
  `executionAttemptsSchema` (max 16); `ACTIVE_ATTEMPT_STATES`.
- `executionWidgetContextV1Schema` (spec:213; callbacks via `z.custom`).
- `deliveryErrorCodes` (`as const` map code → HTTP status, exactly the spec catalogue), `DeliveryErrorCode`,
  `deliveryErrorBodySchema`, `buildDeliveryError(code, error, details?)`.
- `parseVersioned(schemaMap, input)` → `{ ok: true, schemaVersion, data } | { ok: false, status, body }`;
  `deliveryDocumentSchemas` (the six transport documents) as the default full map.
- No tenant/organization field in any schema.

#### 2. Tests

**File**: `packages/core/src/modules/delivery_os/lib/__tests__/contracts.test.ts`

**Intent**: Paired positive/negative cases whose expectations come from the master plan text, not from the code.

**Contract**: zod skips `superRefine` when the base shape fails, so every negative case is a fully valid document
with exactly one property changed. Builders for a valid git package, snapshot package, manifest, baseline, proposals, attempt. Cases:
unknown, missing, numeric and wrong-document `schemaVersion` → `unsupported_schema_version` (also when the body is
otherwise invalid); git without `baseCommit` / snapshot with `baseCommit` / snapshot revision with `commitSha` /
mixed revision kinds rejected, valid twins accepted; check status `skipped` rejected while `not_run` accepted;
usage `'unknown'` accepted and stays `'unknown'`, `{ costUsd: 0 }` stays numeric 0, `{}` rejected;
`tenantId`/`organizationId` in a manifest never appear in the parsed data and no schema declares them;
absolute path / `..` rejected; duplicate stable id, AC map to an unknown AC, unknown dependency rejected;
17 attempts rejected; catalogue contains every spec code with its status; error body schema accepts the
documented shape and rejects an unknown code; widget context requires callable `refresh`.

### Success Criteria:

#### Automated Verification:

- Scoped tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2`
- Core typecheck is clean: `yarn workspace @open-mercato/core typecheck`
- Grep shows no `any`, no enterprise or delivery-cezar import and no inline comments in the new files
- Scoped lint is clean for the new files: `yarn eslint packages/core/src/modules/delivery_os/lib` from the repo root

---

## Testing Strategy

### Unit Tests:

- As listed per phase; each negative case has a positive twin differing in exactly the tested property.

### Integration Tests:

- None in this task (no routes yet). QA-owned TC-DELIVERY specs consume these contracts later.

### Manual Testing Steps:

- None; pure library code.

## Performance Considerations

Array and string bounds in the schemas cap validation cost for hostile manifests; `canonicalize` is linear.

## Migration Notes

Additive new files only. No contract surface of the platform changes.

## References

- Research: `context/changes/asd-oss-t004-oss-02-l1a-add-versioned-contracts-v/research.md`
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md:126,165-181,300-339`
- Master plan: `context/changes/autonomous-software-delivery/plan.md:115-123,196-198`
- Callback schema idiom: `packages/core/src/modules/staff/lib/time-tracking/componentContracts.ts:16`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Canonical hash

#### Automated

- [x] 1.1 Hash tests pass

### Phase 2: Contracts v1, error catalogue and parseVersioned

#### Automated

- [x] 2.1 Scoped tests pass
- [x] 2.2 Core typecheck is clean
- [x] 2.3 Grep shows no any, no enterprise or delivery-cezar import and no inline comments in the new files
- [x] 2.4 Scoped lint is clean for the new files
