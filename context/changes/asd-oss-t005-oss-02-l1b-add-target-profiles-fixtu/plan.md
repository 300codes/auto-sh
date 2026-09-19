# OSS-02 (L1b): target profiles, fixtures and the H4 contract hand-over — Implementation Plan

## Overview

Finish the "H4" contract hand-over of OSS-02. Add the three target profiles as pure data, a set of versioned
fixtures (positive and labelled negative) with typed loaders and a deterministic fake-executor
`buildResultManifest`, and a hand-over note. With these, UI, EXEC and QA can build against real contract
artefacts before the domain exists (UA-21, UA-26, UA-27, UA-14).

## Current State Analysis

- `packages/core/src/modules/delivery_os/lib/contracts.ts` (T004) holds the v1 zod schemas, `parseVersioned`,
  the error catalogue (`deliveryErrorCodes`), `DELIVERY_CONTRACT_VERSION = 1` and `repoRelativePathSchema`.
  `lib/hash.ts` holds `hashCanonical` / `sha256Hex`.
- There is no `targetProfiles.ts`, no fixtures, and no reserve request or response schema. The spec
  (`.ai/specs/2026-09-18-delivery-os-hackathon.md`, UA-10) freezes the response
  `{ attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl }` and the body
  `{ mode: 'manual_handoff', baseRevision }`.
- Correlation (UA-12 step 3) and full DAG cycle detection do not exist yet. T004 explicitly left them to
  `lib/resultAcceptance.ts` and `lib/dag.ts`.
- JSON imports work under the package toolchain. `tsconfig.base.json` sets `resolveJsonModule: true`, the jest
  config lists `json` in `moduleFileExtensions`, and core tests already import JSON
  (`customers/__tests__/i18n-pl-terminology.test.ts:1`). `build.mjs` copies `src/**/*.json` into `dist`.
  Plain Node ESM, however, needs `with { type: 'json' }` for a JSON import from `dist`.

## Desired End State

- `lib/targetProfiles.ts` exports `react-vite@1` (git), `open-mercato-module@1` (git) and `wordpress-theme@1`
  (snapshot, which permits `reference_material`). It also exports `getTargetProfile(id, version)` (returns
  `undefined` for an unknown profile), `assertRevisionKind(profile, revision)` (returns a result;
  `revision_kind_mismatch` on failure), `isPathWithinProfileRoots` / `checkAllowedPathsForProfile`
  (`path_not_allowed`) and `countsAsAcEvidence(kind)`.
- `lib/fixtures/*.v1.json` and `lib/fixtures/negative/*.v1.json` exist. `lib/fixtures/index.ts` exports typed
  loaders, the negative fixture catalogue with labels, and `buildResultManifest(taskPackage, overrides)`.
- `lib/__tests__/{targetProfiles,fixtures}.test.ts` pass: every positive fixture parses with its published
  schema, every negative fixture fails at its labelled stage with its labelled code, and the builder output
  parses and correlates with its package.
- The spec is updated additively, and the hand-over note exists.

### Key Discoveries:

- zod 4 skips `superRefine` when the base shape fails. A negative fixture for a rule code must therefore be a
  valid document with exactly one property changed (T004 notes).
- `repoRelativePathSchema` rejects empty segments, so profile roots use `src/**`, not `src/`
  (`contracts.ts:142-153`).
- `executionWidgetContextV1Schema` requires function callbacks (`contracts.ts:668-676`). JSON cannot hold
  functions, so the fixture stores the data fields and the loader adds no-op callbacks.
- The demo repo test id (Vitest fullName) is `service catalogue AC-001: service list renders seeded services` in
  `src/__tests__/service-catalogue.test.tsx` (`delivery-demo-react`, T002).

## What We're NOT Doing

- No entities, migrations, commands, routes, DI, `index.ts` or `modules.ts` registration (L2+).
- No glob matching of `changedPaths` against task `allowedPaths` (`lib/allowedPaths.ts`, later). Profile-root
  containment is prefix-based only.
- No full `resultAcceptance` pipeline. Only `checkResultCorrelation` (step 3 of UA-12) lands now.
- No DeliveryReport v1 schema (OSS-05).
- No edits to UI, i18n, QA, EXEC or enterprise files, or to the master plan.

## Implementation Approach

Keep profiles as frozen data typed by a zod schema, so the profile shape itself is validated in tests. Every
helper returns the same `{ ok: true } | ({ ok: false } & DeliveryErrorResult)` shape as `parseVersioned`, so
routes and workers map the result without try/catch. Each negative fixture is a self-describing wrapper
`{ description, expected: { stage, code }, against?, document }`. That lets QA reuse the files directly, and the
matrix test dispatches on `stage` (`schema`, `profile`, `correlation`, `dag`, `idempotency`).

## Critical Implementation Details

**JSON imports.** Use static `import … from './x.v1.json' with { type: 'json' }` if jest (ts-jest, CJS) and core
typecheck accept it; that is the only form that also works from `dist` under plain Node ESM. If either tool
rejects it, fall back to plain JSON imports and record in the hand-over that runtime Node consumers must import
through a bundler or jest.

## Phase 1: Target profiles, contract additions and pure helpers

### Changes Required:

#### 1. Contract additions (additive only)

**File**: `packages/core/src/modules/delivery_os/lib/contracts.ts`

**Intent**: Publish the wire shapes that the fixtures and UA-10 need and that are not yet executable.

**Contract**:
- `deliveryEvidenceKindSchema`: an enum of `result_manifest test review screenshot deployment scan reference_material` (spec data model).
- `reserveAttemptRequestSchema`: `{ mode: z.literal('manual_handoff'), baseRevision }`.
- `reserveAttemptResponseSchema`: `{ attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl }`.
  A refine requires `packageUrl === buildPackageUrl(taskId, attemptId)` (`correlation_mismatch`).
- `buildPackageUrl(taskId, attemptId)` returns `/api/delivery_os/tasks/<taskId>/package?attemptId=<attemptId>`.

#### 2. Target profiles

**File**: `packages/core/src/modules/delivery_os/lib/targetProfiles.ts`

**Intent**: Describe React, OM and WordPress targets as data (C2, BN-15), with no provider code.

**Contract**: `targetProfileSchema` has `{ id, version, label, revisionKind, allowedPathRoots[], testFilePatterns[],
commandProfiles{id→{command}}, checks: ValidationCheckDefinition[], testCatalogue: DeclaredTest[],
requiredEvidenceKinds[], permittedEvidenceKinds[] }`. `TARGET_PROFILES` is a frozen array. The helpers are
`getTargetProfile(id, version)`, `assertRevisionKind(profile, revision)`, `isPathWithinProfileRoots(profile, path)`,
`checkAllowedPathsForProfile(profile, paths)` and `countsAsAcEvidence(kind)`. `AC_EVIDENCE_KINDS` is
`result_manifest | test | review`; `reference_material` never counts.
- `react-vite@1`: git. Roots `src/**`, `public/**`, `tests/**`, `index.html`. Checks are vitest test, vite build,
  tsc typecheck, oxlint and an `npm audit` scan. Its catalogue holds the demo AC-001 test.
- `open-mercato-module@1`: git. Roots `src/modules/**`. Checks are jest test, typecheck and a scan.
- `wordpress-theme@1`: snapshot. Theme roots. Evidence kinds permit `reference_material`.

#### 3. Pure helpers the negative fixtures need

**Files**: `packages/core/src/modules/delivery_os/lib/resultAcceptance.ts`, `packages/core/src/modules/delivery_os/lib/dag.ts`

**Intent**: Make the correlation and cycle negatives verifiable with the functions later layers will reuse.

**Contract**: `checkResultCorrelation(taskPackage, manifest)` compares project, task and attempt ids and
`targetProfileVersion` (`correlation_mismatch`), `baselineId` / `baselineHash` (`baseline_mismatch`), and
`baseRevision` / `baseCommit` (`base_revision_mismatch`). `findDependencyCycle(nodes: {key, dependsOn}[])` returns
the cycle path or `null`, ignoring unknown keys; foreign dependencies are the schema's job.

#### 4. Tests

**File**: `packages/core/src/modules/delivery_os/lib/__tests__/targetProfiles.test.ts`

**Intent**: Profiles parse with `targetProfileSchema`. Lookup returns `undefined` for an unknown id or version.
React rejects a snapshot revision and WP accepts it, and the reverse holds for git. The roots checks cover
`../`, absolute paths, paths outside the roots and paths inside them. `reference_material` never counts as AC
evidence. Profile check ids are unique. Correlation and DAG cases are also covered here or in `fixtures.test.ts`.

### Success Criteria:

#### Automated Verification:

- targetProfiles jest suite passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2`

---

## Phase 2: Fixtures, loaders, builder and the positive/negative matrix

### Changes Required:

#### 1. Positive fixtures

**Files**: `packages/core/src/modules/delivery_os/lib/fixtures/{task-package,task-package.snapshot,result-manifest,result-manifest.snapshot,baseline-content,requirements-proposal,plan-proposal,design-manifest,execution-widget-context,reserve-response,error-body}.v1.json`

**Intent**: One coherent scenario (project, baseline, task, attempt) shared by all positive fixtures, so the
git manifest correlates with the React package and the snapshot manifest with the WP package.

#### 2. Negative fixtures

**Files**: `packages/core/src/modules/delivery_os/lib/fixtures/negative/*.v1.json`

**Intent**: Each fixture holds exactly one labelled defect:
- `task-package.unknown-schema-version` fails at the schema stage with `unsupported_schema_version`.
- `result-manifest.foreign-task` and `result-manifest.foreign-attempt` fail at the correlation stage with `correlation_mismatch`.
- `result-manifest.snapshot-for-react` fails at the profile stage with `revision_kind_mismatch`.
- `result-manifest.missing-check-fields` and `result-manifest.status-skipped` fail at the schema stage with `validation_failed`.
- `reserve.duplicate-key` (a first and second body under one key) fails at the idempotency stage with `idempotency_conflict`.
- `plan-proposal.cycle` (A→B→A) fails at the dag stage with `cycle`.
- `plan-proposal.self-cycle` fails at the schema stage with `cycle`.
- `plan-proposal.path-traversal` and `plan-proposal.absolute-path` fail at the schema stage with `path_not_allowed`.
- `plan-proposal.outside-profile-roots` fails at the profile stage with `path_not_allowed`.

#### 3. Loaders and builder

**File**: `packages/core/src/modules/delivery_os/lib/fixtures/index.ts`

**Contract**: `deliveryFixtures` holds the raw positive JSON by name. Typed loaders (`loadTaskPackageFixture`,
`loadResultManifestFixture`, …) parse through the published schema and return a structured clone of the parsed
data. `buildExecutionWidgetContextFixture(overrides)` adds no-op callbacks. `negativeDeliveryFixtures` is a typed
list with labels. `buildResultManifest(taskPackage, overrides)` is deterministic: revision and commit hashes are
derived from `attemptId`, there is one check per required test id (grouped `acIds`) plus the non-test profile
checks, `usage` is `{ source: 'runner', values: 'unknown' }`, `changedPaths` and `artifacts` default to `[]` (callers pass concrete paths through overrides), and it has no clock or randomness. The
`checkStatus` override sets every check's status, and a `resultRevision` override flows into the checks and
`resultCommit`.

#### 4. Matrix test

**File**: `packages/core/src/modules/delivery_os/lib/__tests__/fixtures.test.ts`

**Intent**: Every positive fixture parses. Every negative fixture fails at its labelled stage with its labelled
code, and its positive twin passes that same stage (R1). The builder output parses, correlates with both
packages, is deterministic, and honours the overrides.

### Success Criteria:

#### Automated Verification:

- delivery_os lib jest passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2`
- Core typecheck is clean: `yarn turbo run typecheck --concurrency=2 --filter=@open-mercato/core`

---

## Phase 3: Spec update and H4 hand-over note

### Changes Required:

**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`. **Intent**: Additive changes only. Add a profile table,
the reserve request/response schema names, the fixture layout, and the new lib helpers in the module layout, plus
a changelog row.

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-02-H4-contracts.md`. **Intent**: Record the SHA (a
placeholder the orchestrator fills), `DELIVERY_CONTRACT_VERSION`, schema versions, profile versions, import paths,
the reserve response shape, scope rules, error responses, the fixture catalogue and builder usage, and the
statement "fixtures unblock UI/EXEC/QA; the domain is NOT yet implemented". Also list assumptions A5 and R3.

### Success Criteria:

#### Automated Verification:

- The hand-over note exists and names `DELIVERY_CONTRACT_VERSION` and every profile version
- `git status` shows only OSS-owned paths, `.ai/specs/` and the OSS change folders

#### Manual Verification:

- UI/EXEC/QA confirm the proposal contracts (A5) and the fixture shapes against their consumers

## Testing Strategy

Unit tests only (pure data and functions). `tsc` excludes `__tests__`, so every typed API lives in `fixtures/index.ts` and the tests rely on ts-jest diagnostics. Negatives are paired with positive twins so that a test which
trivially rejects everything fails (R1).

## References

- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md`
- Contracts: `packages/core/src/modules/delivery_os/lib/contracts.ts`
- Breakdown: sections 3.3 (UA-21, UA-26, UA-27), 4 (C1, C2) and 7 (A5, R1)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Target profiles, contract additions and pure helpers

#### Automated

- [x] 1.1 targetProfiles jest suite passes

### Phase 2: Fixtures, loaders, builder and the positive/negative matrix

#### Automated

- [x] 2.1 delivery_os lib jest passes
- [x] 2.2 Core typecheck is clean

### Phase 3: Spec update and H4 hand-over note

#### Automated

- [x] 3.1 Hand-over note exists with contract and profile versions
- [x] 3.2 Only OSS-owned paths, specs and OSS change folders touched

#### Manual

- [ ] 3.3 UI/EXEC/QA confirm proposal contracts and fixture shapes
