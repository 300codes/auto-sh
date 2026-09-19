# OSS-04 (L8b): complete result acceptance checks — Implementation Plan

## Overview

Replace the three pass-through seams in `packages/core/src/modules/delivery_os/lib/resultAcceptance.ts` with real
rules, so a result manifest is accepted only when its changed paths stay inside the task scope, its checks are bound
to the frozen AC/test maps and profile, its stored artifacts match their declared hash, and it stays within size
limits. This is the visible "the agent proposes, the system decides" boundary for results (UA-12 manual, UA-24 adapter).

## Current State Analysis

- `evaluateResultAcceptance` is pure and synchronous. Order: schema → canonical hash → attempt exists → idempotency →
  attempt gate → package → profile → revision kind → correlation → `RESULT_ACCEPTANCE_PENDING_CHECKS` (three stubs).
- `delivery_os.results.accept` (`commands/evidence.ts`) evaluates inside one transaction with the task row locked and
  writes evidence with `attachmentIds: []`.
- `isPathAllowed` exists and is unused in production. `verifyDraftAttachments` verifies baseline attachments
  (scope + bytes) and is tied to the `{ screens, attachments }` draft shape.
- The task package has `validationProfile.requiredTests` and `.checks` but not the baseline `declaredTests`.
- The manifest schema already rejects a check on another revision (`422 revision_mismatch`) and status `skipped`.

## Desired End State

`results.accept` rejects, with nothing persisted: a changed path outside `task.allowedPaths` (`422 path_not_allowed`,
one detail per path), a check with a foreign AC (`422 unknown_ac`), an unknown or falsely mapped test
(`422 unknown_test_id`), a wrong profile version or revision on a check (`422 correlation_mismatch`), a stored artifact
whose bytes do not match (`422 attachment_hash_mismatch`), an artifact attachment from another scope
(`422 foreign_reference`), and an oversized result (`413 payload_too_large`). An identical replay of an accepted
manifest still answers `duplicate: true`, even after the task's `allowedPaths` were narrowed. Verify with
`yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`.

### Key Discoveries:

- Idempotency already returns before the check loop (`lib/resultAcceptance.ts:114-124`), so rules added to the loop
  cannot beat a replay. The async attachment step must also run only on the `accept` outcome.
- Attachment verification needs the DB and the DI inspector, so it belongs in the command, not in the pure function.
- The fake executor (`lib/fixtures/builders.ts:29-81`) defines the check convention: test checks use the `test`
  definition's `commandProfileId` and mapped test ids; other checks use `testId === definition.checkId`.
- `lib/__tests__/fixtures.test.ts` fails on an unregistered negative JSON and on an unknown stage.
- `commands/__tests__/results.test.ts` has no attachment store or inspector; `baselineTestKit.makeAttachmentInspector`
  can be reused.

## What We're NOT Doing

- No migration, no new top-level error code, no route, ACL, event or DI key change.
- No change to the manifest or task-package zod schemas (DTO v1 is frozen); `revision_mismatch` at schema stage stays.
- No test-evidence import (R19/T028) — only the exported helper it will reuse.
- No files of other streams (`backend/`, `i18n/`, enterprise, QA specs); needs go to the hand-over note.
- No `exitCode` versus `status` consistency rule (a suite-wide exit code would reject honest per-test results).

## Implementation Approach

Pure rules live in `lib/`: a new `lib/resultChecks.ts` holds the check-mapping helper (reused later by R19) and the
runner-status mapper; `lib/resultAcceptance.ts` holds the path rule, the size rule and the ordered list. The async
artifact verification is a generalised form of the baseline verifier in `commands/attachments.ts`, called by the
command after the pure evaluation answers `accept`. Order after correlation: size limits → changed paths → checks →
stored artifacts (hashes last, as in UA-12).

Decisions (self-answered planning questions):

1. **Where attachments are verified** — in the command after `accept`, same transaction. The pure function stays pure;
   a replay never touches storage.
2. **Foreign artifact attachment code** — `foreign_reference` (task text), detail code `attachment_scope_mismatch`;
   other attachment failures keep `attachment_hash_mismatch`.
3. **Test catalogue** — `requiredTests` values ∪ baseline `declaredTests` ∪ profile `testCatalogue`. `declaredTests`
   is returned additively by `buildTaskPackageV1` next to the package. A whole-suite report stays acceptable.
4. **False mapping** — a check that lists an `acId` whose frozen `requiredTests[acId]` does not contain its `testId`
   is rejected (`unknown_test_id`, detail `test_not_mapped_to_ac`). The model cannot add coverage mappings.
5. **Non-test checks** — `commandProfileId` must belong to a profile check definition (`unknown_command_profile`
   detail under `unknown_test_id`); for kinds other than `test`, `testId` must equal that definition's `checkId`.
6. **Check `sourceRevision`** — schema keeps answering `revision_mismatch` first; the helper also compares it
   (`correlation_mismatch`) because R19 will call the helper without the manifest schema.
7. **`skipped`** — export `mapRunnerStatus`: `passed`→`passed`, `failed`→`failed`, anything else→`not_run`.
8. **Limits** — constants lower than the schema caps: 500 changed paths, 500 checks, 50 artifacts, 10 MiB per declared
   artifact, 64 MiB declared total → `413 payload_too_large` with additive detail codes. Size runs first of the new
   rules: it is cheap and bounds the detail lists of the later rules.
9. **Path source** — `task.allowedPaths` of the locked row (task text), not the package copy.
10. **Naming** — the list becomes `RESULT_ACCEPTANCE_CHECKS` (nothing is pending any more); only its own test used it.
11. **Negative fixture stage** — new additive stage `acceptance` with `correlatesWith: 'task-package'`.
12. **Evidence `attachmentIds`** — set to the verified artifact attachment ids, so the report can lead to the proof.

## Critical Implementation Details

- **Ordering**: the artifact verification must be called only when `evaluation.outcome === 'accept'`, before any
  write. The `duplicate` branch returns earlier and must stay free of I/O beyond what exists today.
- **Harness**: `verifyDraftAttachments` resolves the inspector only when something is referenced; keep that property
  in the generalised function, otherwise every existing `results.test.ts` case breaks on the missing DI key.

## Phase 1: Pure rules, fixtures and lib tests

### Overview

All synchronous rules and their fixtures; `evaluateResultAcceptance` rejects bad paths, checks and sizes.

### Changes Required:

#### 1. Check-mapping helper

**File**: `packages/core/src/modules/delivery_os/lib/resultChecks.ts` (new)

**Intent**: One pure place that decides whether reported checks are bound to the frozen maps; shared by result
acceptance now and test evidence (R19) later.

**Contract**: `mapRunnerStatus(status: string): CheckStatus`; `checkReportedChecks(input): DeliveryCheckResult` with
input `{ checks, resultRevision, validationProfile, acceptanceCriteriaIds, knownTestIds, pathPrefix? }`. Top code
priority `unknown_ac` > `unknown_test_id` > `correlation_mismatch`; every issue is listed in `details` with path
`checks.<index>.<field>`. Detail codes: `unknown_ac`, `unknown_test_id`, `test_not_mapped_to_ac`,
`unknown_command_profile`, `check_id_mismatch`, `validation_profile_version_mismatch`, `source_revision_mismatch`.

#### 2. Package result carries declared tests

**File**: `packages/core/src/modules/delivery_os/lib/taskPackage.ts`

**Intent**: Give the acceptance rules the baseline's declared test ids without a second baseline read.

**Contract**: ok branch of `TaskPackageResult` gains `declaredTestIds: string[]` (additive; `taskPackage` unchanged).

#### 3. Real rules and ordered list

**File**: `packages/core/src/modules/delivery_os/lib/resultAcceptance.ts`

**Intent**: Replace the stubs. `checkResultSizeLimits` (constants exported), `checkChangedPathsAllowed`
(`isPathAllowed` against `task.allowedPaths`, detail per path, code `outside_allowed_paths`), `checkResultChecks`
(delegates to the helper with the package, profile catalogue and declared tests). `checkArtifactAttachments` leaves
this file; `collectArtifactReferences(artifacts)` builds `AttachmentReference[]` (role `attachment`, path
`artifacts.<index>`) for artifacts with `attachmentId`.

**Contract**: `RESULT_ACCEPTANCE_CHECKS` = size → paths → checks; context gains `profile` and `declaredTestIds`.
Detail lists are capped by the size rule. Evaluation order before the list is unchanged.

#### 4. Negative fixtures and stage

**Files**: `lib/fixtures/negative/result-manifest.path-escape.v1.json`,
`lib/fixtures/negative/result-manifest.unknown-test.v1.json`, `lib/fixtures/index.ts`

**Intent**: Publish the two failure classes for UI/EXEC/QA. Both are copies of the published git manifest with one
defect: changed paths `package.json` and `.github/workflows/deploy.yml`; a test check with an undeclared test id.

**Contract**: stage enum gains `acceptance`; both fixtures use `correlatesWith: 'task-package'`, `status: 422`.

#### 5. Lib tests

**Files**: `lib/__tests__/resultChecks.test.ts` (new), `lib/__tests__/resultAcceptance.test.ts`,
`lib/__tests__/fixtures.test.ts`, `lib/__tests__/taskPackage.test.ts` (only if it pins the result shape)

**Intent**: Pairs for every rule (inside/outside path, known/unknown test, own/foreign AC, mapped/unmapped, right/wrong
version and revision, within/over each limit), replay beats narrowed paths, order size → paths → checks.
`fixtures.test.ts`: a `case 'acceptance'` in `runLabelledStage` that runs `RESULT_ACCEPTANCE_CHECKS` with the
correlated task-package fixture, the task's `allowedPaths` from that package, the react-vite profile and the
`declaredTests` ids of the baseline-content fixture; required labels gain `acceptance:path_not_allowed` and
`acceptance:unknown_test_id`; the positive-twin test asserts both published manifests pass the `acceptance` stage.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` passes
- Published positive fixtures still evaluate to `accept`

---

## Phase 2: Stored artifact verification in the command, command and route tests, docs

### Overview

Wire the async artifact check into `results.accept`, prove "nothing persisted" on every rejection, document.

### Changes Required:

#### 1. Generalised attachment verifier

**File**: `packages/core/src/modules/delivery_os/commands/attachments.ts`

**Intent**: Extract the reference loop of `verifyDraftAttachments` into `verifyAttachmentReferences(tx, ctx,
references, scope)` and keep `verifyDraftAttachments` as a thin caller (behaviour unchanged). Add
`verifyResultArtifacts(tx, ctx, artifacts, scope)` that uses `collectArtifactReferences` and remaps a scope failure
to `foreign_reference` while keeping the details.

**Contract**: returns `{ ok: true, attachmentIds }` or a delivery error; no DI resolve when nothing is referenced.
The extracted function keeps `checkTotalAttachmentBytes` on the *stored* sizes before the first byte is read, so the
work under the task row lock is bounded (64 MiB). Only `attachment_scope_mismatch` is remapped to
`foreign_reference`; every other answer (hash mismatch, `413` total) passes through unchanged. A manifest with both a
foreign and a tampered artifact answers `foreign_reference` with both details.

#### 2. Command wiring

**File**: `packages/core/src/modules/delivery_os/commands/evidence.ts`

**Intent**: After an `accept` evaluation and before any write, verify stored artifacts; persist the verified ids in
`DeliveryEvidence.attachmentIds`. The evaluation call itself does not change: the pure function resolves the profile
and reads `declaredTestIds` from the package result it already receives.

**Contract**: same command id, input and result. Same path for `manual` and `adapter`.

#### 3. Command and route tests

**Files**: `commands/__tests__/results.test.ts`, `api/__tests__/results.route.test.ts`

**Intent**: Command: path inside accepted / outside rejected with no evidence row, task unchanged and no event;
unknown test and foreign AC rejected; artifact with right sha accepted and ids stored / wrong sha rejected / foreign
attachment → `foreign_reference`; replay after narrowing `allowedPaths` → `duplicate: true`; adapter source hits the
same rule. Route: `422 path_not_allowed` body shape with per-path details and `413` for too many changed paths.
Harness gains an `attachments` store and the inspector.

#### 4. Spec and hand-over

**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`,
`context/changes/delivery-os-oss-domain/handover/OSS-04-L8b-result-acceptance.md` (new)

**Intent**: Changelog line (prepended, T025 format, names the rename `RESULT_ACCEPTANCE_PENDING_CHECKS` →
`RESULT_ACCEPTANCE_CHECKS`), stage list gains `acceptance`; hand-over lists rules, detail codes, limits, fixtures and
patch requests for EXEC/UI/QA. First EXEC item: report only declared tests as checks (other tests go to `findings`),
keep `acIds` within the task, use `mapRunnerStatus` semantics for `skipped`/`todo`.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes (includes `manualFlow.route.test.ts`)
- Type check of `@open-mercato/core` passes for the touched files (package build or scoped `tsc`), tests via temporary tsconfig
- `git status` shows no migration, generated file or dependency change

#### Manual Verification:

- A human confirms in the live app that a manual result import with an out-of-scope path shows the 422 and the task stays `executing`

---

## Testing Strategy

### Unit Tests:

- Pure helper and rules in isolation, each as a positive/negative pair; fixtures at their labelled stage.
- Command tests on the in-memory store assert store snapshots before/after a rejection.

### Integration Tests:

- Owned by QA (`TC-DELIVERY-*`); the hand-over names the new scenarios. Route tests here run the real command bus.

### Manual Testing Steps:

1. Live smoke through the API on :3100 after a core build and dev restart: reserve → import a manifest with
   `package.json` in `changedPaths` → expect 422 and no evidence; import a valid one → 201; replay → 200 duplicate.

## Performance Considerations

All rules are linear in the manifest size, which the size rule bounds (≤ 500 paths × ≤ 200 allowed entries).
Stored artifacts are read only for artifacts with an `attachmentId`, inside the existing transaction, as in the
baseline path.

## Migration Notes

None. Existing accepted evidence is untouched; replays compare hashes only.

## References

- Research: `context/changes/asd-oss-t025-oss-04-l8b-complete-result-acceptanc/research.md`
- Spec UA-12 order: `.ai/specs/2026-09-18-delivery-os-hackathon.md:306`
- Attachment verifier: `packages/core/src/modules/delivery_os/commands/attachments.ts:75-123`
- Fake executor convention: `packages/core/src/modules/delivery_os/lib/fixtures/builders.ts:29-81`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure rules, fixtures and lib tests

#### Automated

- [x] 1.1 Lib test suite of delivery_os passes with the new rules and fixtures
- [x] 1.2 Published positive fixtures still evaluate to accept

### Phase 2: Stored artifact verification in the command, command and route tests, docs

#### Automated

- [x] 2.1 Full delivery_os jest run passes including manualFlow.route.test.ts
- [x] 2.2 Type check passes for touched production and test files
- [x] 2.3 No migration, generated file or dependency change in git status

#### Manual

- [ ] 2.4 Human confirms the out-of-scope path rejection in the live app
