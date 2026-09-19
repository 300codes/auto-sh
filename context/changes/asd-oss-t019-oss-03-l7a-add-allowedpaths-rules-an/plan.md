# OSS-03 (L7a) allowedPaths Rules and Pure Proposal Import Validation — Implementation Plan

## Overview

Add two pure, ORM-free domain modules under `packages/core/src/modules/delivery_os/lib/`:

- `allowedPaths.ts` — the one grammar for task `allowedPaths` (exact repo-relative file or `dir/**`), checked against the
  target profile roots, plus `isPathAllowed(changedPath, allowedPaths)` for the later result check (OSS-04).
- `proposals.ts` — `validateRequirementsProposal` (UA-06) and `validatePlanProposal` (UA-07): versioned parse, foreign
  reference checks, AC / test / path / DAG rules, normalized outputs (merged draft, merged baseline content, task drafts in
  dependency order, frozen AC→test map) and the canonical `manifestHash` used for idempotent re-import.

This is the "agent proposes, system decides" boundary for the two agent sessions (requirements-from-brief,
plan-from-baseline): nothing an agent writes reaches a baseline or a task without passing these rules. Commands and routes
that call them (R7 `requirements_proposal`, R10 `plan_proposal`, the merged-baseline transaction, dedupe) are L7b.

## Current State Analysis

- `lib/contracts.ts` already carries the frozen schemas: `requirementsProposalV1Schema` (unique requirement/AC/question/
  risk ids → `duplicate_stable_id`, AC → unknown requirement → `foreign_reference`, invalid stable id → `validation_failed`)
  and `planProposalV1Schema` (`tasks` 1..100, unique `proposalTaskKey` and declared `testId`, self-dependency → `cycle`,
  unknown `dependsOn` → `foreign_dependency`, every path through `repoRelativePathSchema` → `path_not_allowed` for absolute,
  `~`, drive letter, backslash, control chars, `.`/`..`/empty segments). `parseVersioned(map, input)` answers
  `unsupported_schema_version` before shape validation and `payload_too_large` above depth 64.
- `lib/targetProfiles.ts` has `allowedPathRoots` (`src/**`, `index.html`, …), `testCatalogue`, and a weaker
  `checkAllowedPathsForProfile` / `isPathWithinProfileRoots` (prefix match only: `src/*/x`, `src/**/x.ts`, duplicates pass).
  `commands/tasks.ts:522` uses it for manual tasks.
- `lib/dag.ts` `findDependencyCycle(nodes)` finds multi-node cycles over string keys.
- `lib/hash.ts` `hashCanonical`; `lib/baseline.ts` `buildBaselineContent`, `hashBaseline`.
- `data/validators.ts` `draftSpecV1Schema` / `DraftSpecV1` (requirements, acceptanceCriteria, questions, risks, adr, screens,
  tokens, summaries, acTestMap, manualChecks, declaredTests, attachments, comments). `lib/` does not import `data/` today
  (data imports lib), so proposals must not either.
- Fixtures: `plan-proposal.v1.json` targets baseline `6666…`, hash `39969f…`, which is exactly the `baseline-content`
  fixture with `planSummary: null`, `acTestMap: {}`, `declaredTests: []`, `manualChecks: {}` (the pre-plan baseline;
  verified by hashing). Negative fixtures are wrapped `{ description, expected: { stage, code, status }, documentType,
  correlatesWith?, targetProfile?, document }` and executed per stage in `lib/__tests__/fixtures.test.ts`; stages are
  `schema | profile | correlation | dag | idempotency` (`negativeFixtureStages` in `lib/fixtures/index.ts`).
- Every error code the task needs already exists in `deliveryErrorCodes` (`unsupported_schema_version`, `foreign_reference`,
  `duplicate_stable_id`, `unknown_ac`, `unknown_test_id`, `missing_required_tests`, `path_not_allowed`, `cycle`,
  `foreign_dependency`, `unknown_target_profile`, `validation_failed`).

## Desired End State

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` is green, including new
  `lib/__tests__/allowedPaths.test.ts` and `lib/__tests__/proposals.test.ts` where every rejection rule has a failing
  input and a passing twin that differs only in the offending field.
- Three new negative fixtures (`plan-proposal.foreign-baseline`, `plan-proposal.path-escape`,
  `plan-proposal.false-test-mapping`) run through the fixture suite at a new additive stage `proposal`.
- `grep -rnE "mikro-orm|@open-mercato/.*/data/|from '\.\./data" packages/core/src/modules/delivery_os/lib` finds nothing.
- `deliveryErrorCodes` unchanged (no new codes → catalogue and pinned catalogue test untouched); spec changelog records
  the new helpers and the additive fixture stage.

### Key Discoveries:

- `planProposalV1Schema` already rejects most structural faults (`lib/contracts.ts:544-571`); `proposals.ts` must not
  duplicate them, only add the rules that need context (project, baseline, profile) and multi-node cycles.
- `isPathWithinProfileRoots` treats `src/**` roots as a prefix, so a `dir/**` entry must be checked with its own rule: a
  directory entry is inside a root only when the root is `d/**` and the entry directory is `d` or under `d/`
  (`lib/targetProfiles.ts:162`).
- The pre-plan fixture baseline hash is reproducible from `baseline-content.v1.json` (see Current State) — the positive
  plan fixture can be validated against a real, hash-consistent context instead of a hand-built one.
- `baselineContentV1Schema.importedManifestHashes` has `max(50)`; `longTextSchema` caps summaries at 8000 chars.

## What We're NOT Doing

- No commands, routes, transactions, dedupe/replay (`idempotency_conflict`), baseline approval check
  (`baseline_not_approved` needs decisions) or task creation — L7b.
- No result-side `changedPaths` enforcement (OSS-04 uses `isPathAllowed`).
- No new error codes, no contract/schema shape change, no migration, no generated files.
- No lower task cap than the frozen schema's 100.

## Implementation Approach

Decisions taken autonomously (no human available; each picked for predictability of the live demo and safety boundary):

1. **Path grammar** — an allowed path is an exact repo-relative file or a directory followed by `/**`. Any other glob
   metacharacter (`*`, `?`) anywhere → `path_not_allowed`/`unsupported_glob`. *(Adapted during implementation: `[`, `]`, `{`, `}`, `!` stay literal because Next.js/OM route files such as `src/modules/x/api/[id]/route.ts` must be allowable under `open-mercato-module@1`; matching is literal, so they cannot widen the scope.)* `**` alone or a
   directory glob above a root (`**`, `public/../**` already fails the schema) → `outside_profile_roots`. A file root
   (`index.html`) grants only that file, never `index.html/**`. Duplicates → `duplicate_path`. Top code always
   `path_not_allowed`, per-index detail codes tell the user which rule fired.
2. **Requirements merge** — the proposal is the full requirements document: it replaces `requirements`,
   `acceptanceCriteria`, `questions`, `risks` in the draft; every other draft section is kept. `acTestMap`/`manualChecks`
   entries whose AC id disappeared are pruned and returned as `prunedAcIds` (otherwise the next baseline build would fail
   with `unknown_ac` on data the user never touched).
3. **Test catalogue** for `acTestMap` — manifest `declaredTests` ∪ baseline `declaredTests` ∪ profile `testCatalogue`; the
   same `testId` defined with a different `file` → `duplicate_stable_id`/`test_definition_conflict`; declared test files
   must sit inside the profile roots (`path_not_allowed`/`declared_test_outside_roots`) — a test living outside the
   delivered repo area cannot prove an AC.
4. **AC coverage** — every AC referenced by a task needs ≥1 required test in the merged map or a baseline manual check,
   else `missing_required_tests`; an `acTestMap` key with an empty list and no manual check is also rejected. Baseline ACs
   no task references are allowed (the project status shows the coverage gap).
5. **Merged outputs** — plan: new `BaselineContent v1` = parent content + `architectureSummary` + generated `planSummary`
   (one line per task, capped at 8000 chars) + merged `acTestMap` (proposal entries win) + merged `declaredTests` +
   `manifestHash` appended to `importedManifestHashes` (not duplicated), re-parsed with `baselineContentV1Schema` and
   hashed with `hashBaseline`. Tasks come back deduped (`acIds`, `dependsOn`) in dependency-first order (stable by manifest
   order) so the command can resolve `dependsOnTaskIds` in one pass.
6. **Check order / error shape** — `parseVersioned` against a single-entry map (a plan posted as requirements →
   `unsupported_schema_version`), then correlation (`foreign_reference`, stops), then profile identity
   (`unknown_target_profile`, stops), then all content rules collected into one body; the top code is the first by fixed
   priority `unknown_ac → unknown_test_id → duplicate_stable_id → missing_required_tests → path_not_allowed → cycle`, and
   `details[]` lists every problem so the operator fixes the proposal in one round.
7. **Task cap** — export `MAX_PLAN_PROPOSAL_TASKS = 100` from `contracts.ts` and use it in the schema (value unchanged,
   additive export); 101 tasks → `400 validation_failed`.
8. **Fixtures** — add stage `proposal` (additive enum value) whose context is `loadPlanProposalContextFixture()` (project
   `1111…` pinned to `react-vite@1`, pre-plan baseline `6666…` derived from the baseline-content fixture).
9. **manifestHash** = `hashCanonical(parsed manifest)` (zod-stripped, so unknown extra keys do not change identity).

## Critical Implementation Details

- **Import direction** — `allowedPaths.ts` imports only the `TargetProfile` *type* from `targetProfiles.ts`, because
  `targetProfiles.ts#checkAllowedPathsForProfile` now delegates to `validateAllowedPaths` (no runtime import cycle).
- **Replay before validation (L7b)** — after a plan import the project points at the merged baseline, so an identical
  replayed manifest (pre-plan `baselineHash`) would fail `baseline_hash_mismatch`; L7b must look up `manifestId` +
  `manifestHash` before calling `validatePlanProposal`.

## Phase 1: allowedPaths rules

### Overview

One pure module for the path grammar, profile roots and changed-path matching, with paired tests.

### Changes Required:

#### 1. allowedPaths module

**File**: `packages/core/src/modules/delivery_os/lib/allowedPaths.ts`

**Intent**: Single source of truth for which `allowedPaths` a task may carry for a profile and whether a changed file is
covered by them.

**Contract**:
- `export const ALLOWED_PATH_DIRECTORY_SUFFIX = '/**'`
- `export type AllowedPathIssue = { index: number; path: string; code: <detail code> }` with detail codes
  `empty_path | absolute_path | home_path | drive_letter | backslash | control_character | parent_segment | invalid_segment |
  unsupported_glob | outside_profile_roots | duplicate_path | too_long`.
- `export function collectAllowedPathIssues(paths: readonly unknown[], profile: TargetProfile): AllowedPathIssue[]`
- `export function validateAllowedPaths(paths: readonly unknown[], profile: TargetProfile, pathPrefix?: string): DeliveryCheckResult`
  → `422 path_not_allowed` with `details[{ path: '<prefix><index>', code: <detail code>, message }]`; empty list → ok.
- `export function isPathAllowed(changedPath: string, allowedPaths: readonly string[]): boolean` — false for any
  changed path that is not a valid repo-relative non-glob path; true on exact match or under a `dir/**` entry.

#### 2. One rule for manual and proposal tasks (plan-review F1)

**File**: `packages/core/src/modules/delivery_os/lib/targetProfiles.ts`

**Intent**: Manual tasks (`commands/tasks.ts:522`) and imported plan tasks must accept exactly the same `allowedPaths`.

**Contract**: `checkAllowedPathsForProfile(profile, paths)` keeps its signature and top code and returns
`validateAllowedPaths(paths, profile)`; detail paths stay `String(index)`. `isPathWithinProfileRoots` unchanged.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/allowedPaths.test.ts --maxWorkers=2` passes (each rule: failing input + passing twin)
- `targetProfiles.test.ts` and `commands/__tests__/tasks.test.ts` still pass after the delegation
- No ORM or `data/` import in `lib/` (grep)

---

## Phase 2: Proposal validation, fixtures and spec

### Overview

`proposals.ts` with both validators, the fixture context loader and three negative fixtures at a new `proposal` stage,
paired tests, the spec changelog.

### Changes Required:

#### 1. Task cap constant

**File**: `packages/core/src/modules/delivery_os/lib/contracts.ts`

**Intent**: Name the frozen task cap so validators, tests and the spec share it.

**Contract**: `export const MAX_PLAN_PROPOSAL_TASKS = 100`; `planProposalV1Schema.tasks` uses `.max(MAX_PLAN_PROPOSAL_TASKS)`.

#### 2. Proposal validators

**File**: `packages/core/src/modules/delivery_os/lib/proposals.ts`

**Intent**: Validate agent proposals against the project, baseline and profile and return exactly what the import
commands need to persist.

**Contract**:
- `RequirementsDraftSections` = `{ requirements, acceptanceCriteria, questions, risks, acTestMap, manualChecks }` (structural;
  `DraftSpecV1` satisfies it).
- `validateRequirementsProposal<TDraft extends RequirementsDraftSections>(manifest: unknown, context: { projectId: string; draftSpec: TDraft })`
  → `{ ok: true; manifest: RequirementsProposalV1; manifestId; manifestHash; draftSpec: TDraft; prunedAcIds: string[] } | { ok: false } & DeliveryErrorResult`.
- `PlanProposalContext = { project: { id; targetProfileId; targetProfileVersion }; baseline: { id; projectId; contentHash; content: BaselineContentV1 }; profile: TargetProfile }`.
- `validatePlanProposal(manifest: unknown, context: PlanProposalContext)` → `{ ok: true; manifest: PlanProposalV1;
  manifestId; manifestHash; tasks: PlanTaskDraft[] (dependency order); acTestMap: Record<string, string[]> (frozen);
  declaredTests: DeclaredTest[]; baselineContent: BaselineContentV1; contentHash: string } | { ok: false } & DeliveryErrorResult`.
- `PlanTaskDraft = { proposalTaskKey; title; description; acIds; dependsOn; allowedPaths }`.
- Correlation details: `foreign_project` (manifest projectId ≠ project), `foreign_baseline` (baseline not of the project or
  manifest baselineId ≠ baseline id), `baseline_hash_mismatch` (manifest hash ≠ stored hash).

#### 3. Fixture context and negative fixtures

**File**: `packages/core/src/modules/delivery_os/lib/fixtures/index.ts`, `lib/fixtures/negative/plan-proposal.{foreign-baseline,path-escape,false-test-mapping}.v1.json`

**Intent**: Give QA/UI/EXEC a hash-consistent plan-import context and labelled negatives for the three new failure classes.

**Contract**: `negativeFixtureStages` gains `'proposal'`; `loadPlanProposalContextFixture(): PlanProposalContext`; the
fixtures are `stage: 'proposal'` with codes `foreign_reference`, `path_not_allowed`, `unknown_test_id`.

#### 4. Fixture suite stage

**File**: `packages/core/src/modules/delivery_os/lib/__tests__/fixtures.test.ts`

**Intent**: Execute `proposal`-stage negatives through `validatePlanProposal`, require the new failure classes, and prove the
positive plan fixture passes the same stage.

#### 5. Tests

**File**: `packages/core/src/modules/delivery_os/lib/__tests__/proposals.test.ts`

**Intent**: One failing input and one passing twin per rule of both validators, plus output shape (merge, prune, order,
hash stability, merged baseline hash).

#### 6. Spec

**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`

**Intent**: Changelog entry for the helpers, detail codes, the `proposal` fixture stage and `MAX_PLAN_PROPOSAL_TASKS`;
fixture paragraph lists the new stage and loader. No error-catalogue change.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` passes
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes (no regression in commands/routes)
- Core typecheck passes: `yarn turbo run typecheck --concurrency=2 --filter=@open-mercato/core`
- Existing positive fixtures still parse and the pinned error catalogue test is unchanged

---

## Testing Strategy

### Unit Tests:

- allowedPaths: every detail code with a failing and passing twin; profile roots for all three profiles (file root vs
  directory root); `isPathAllowed` exact, nested, sibling-prefix (`srcx/a` vs `src/**`), invalid changed paths.
- proposals: unknown/wrong schemaVersion, foreign project, foreign baseline, stale baseline hash, profile mismatch,
  unknown AC in task and in map, unknown test id, test conflict, declared test outside roots, missing required tests
  (and manual-check twin), illegal allowedPaths, duplicate key, unknown/self/multi-node cycle, 101 tasks; merge/prune,
  dependency order, manifest hash stable under key order and unknown fields, merged baseline parses and re-hashes;
  `prunedAcIds` lists each pruned AC once and untouched draft sections (screens, comments, adr, attachments, tokens)
  come back identical (plan-review F2).

### Manual Testing Steps:

1. None beyond reading the test output — pure functions with no UI or route yet.

## References

- Master plan `context/changes/autonomous-software-delivery/plan.md` (Progress 3.3, 3.6; lines 286, 300-301, 450)
- Spec `.ai/specs/2026-09-18-delivery-os-hackathon.md` (UA-06/UA-07 rows, error catalogue, coverage R6-R13)
- `lib/contracts.ts:516-572`, `lib/targetProfiles.ts:162-183`, `lib/dag.ts:5`, `lib/baseline.ts:106`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: allowedPaths rules

#### Automated

- [x] 1.1 allowedPaths.test.ts passes with a failing input and a passing twin per rule
- [x] 1.2 No ORM or data/ import in lib/ (grep)
- [x] 1.3 targetProfiles and tasks command tests still pass after the delegation

### Phase 2: Proposal validation, fixtures and spec

#### Automated

- [x] 2.1 delivery_os lib jest suite passes
- [x] 2.2 Whole delivery_os jest suite passes
- [x] 2.3 Core typecheck passes
- [x] 2.4 Existing positive fixtures parse and the pinned error catalogue is unchanged
