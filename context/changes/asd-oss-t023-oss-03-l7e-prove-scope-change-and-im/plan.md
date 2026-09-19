# OSS-03 (L7e): prove scope-change and immutability rules — Implementation Plan

## Overview

Close OSS-03 acceptance with **tests first, fixes second**. One new unit-test file,
`packages/core/src/modules/delivery_os/commands/__tests__/scopeChange.test.ts`, proves the master-plan rows 3.1/3.2
one rule per `describe` block, driving the real registered commands (`baselines.create`, `baselines.import_requirements`,
`tasks.import_plan`, `decisions.record`, `attempts.reserve`, `results.accept`) and the pure projections
(`lib/traceability`, `lib/projectStatus`). Production code changes only where a rule turns out to be unguarded
(additive error code only). Then run the capped gate, a live smoke of R7 + R10 on :3100 and write the H14 hand-over.

## Current State Analysis

Research of the module (read directly, no sub-agents needed — the module is ~6.5 k lines and was built in T001–T022):

- **Append-only surfaces.** Registered delivery_os commands: `projects.{create,update,delete}`,
  `tasks.{create,update,delete,import_plan}`, `baselines.{create,import_requirements}`, `decisions.record`,
  `attempts.reserve`, `results.accept` (`commands/*.ts` `registerCommand`). Route files exporting write methods for
  baselines/decisions/results export only `POST` (`api/projects/[id]/baselines/route.ts:47,70`,
  `api/baselines/[id]/decisions/route.ts:23`, `api/tasks/[id]/results/route.ts:31`). Existing tests pin single ids
  (`decisions.test.ts:305`, `baselines.test.ts:394`) but nothing pins the whole registry or scans every route file.
- **Pinned tasks.** `taskUpdateSchema` (`data/validators.ts:194`) has no `baselineId` → a task cannot be re-pinned.
  `baselines.create` freezes the draft into the next version and never touches older rows (`baselines.test.ts:124`).
- **Late results.** `results.accept` (`commands/evidence.ts:101`) writes `baselineId: task.baselineId`; correlation
  against the reserved attempt/package rejects a manifest that names another baseline (`lib/resultAcceptance.ts`
  `baseline_mismatch`). `loadTaskPackage(..., { attemptGate: 'none' })` does not require the baseline to be active,
  so a late result for the old baseline is accepted as old-baseline evidence.
- **Projections.** `buildTraceability` filters tasks and evidence by `baseline.id` (`lib/traceability.ts:81-90`);
  `deriveProjectStatus` takes the denominator from the active baseline's AC ids and counts only tasks pinned to it
  (`lib/projectStatus.ts:78-90`).
- **Reserve on a superseded baseline.** Already guarded: `attempts.ts` answers `422 baseline_not_active` when
  `task.baselineId !== project.activeBaselineId` (tested in `attempts.test.ts:369` with a bare pointer switch).
- **Decisions.** `checkDecisionSubject` answers `409 subject_hash_mismatch` for a foreign hash/version; the project
  lock (`lockProjectForWrite(..., { force: true })`) makes the second of two concurrent contradictory writers lose with
  the platform `409 optimistic_lock_conflict`; `requireActorUserId` needs a signed-in human; decisions are created only
  in `commands/decisions.ts`. No worker/subscriber exists in the module.
- **Schema.** Manual create, requirements import and plan import all persist content validated by
  `baselineContentV1Schema` (`lib/contracts.ts:482`); each suite checks its own source, none checks all three together.

Conclusion: every rule appears guarded; the task's value is one auditable file that would fail on the wrong behaviour,
plus the gate evidence and the hand-over. Any gap found while writing tests is fixed in the same phase.

## Desired End State

- `scopeChange.test.ts` green with six `describe` blocks named after rules (1)–(6); each has at least one assertion
  that fails if the guard is removed (verified by a temporary mutation of the guard for rules 3/4/5 during
  implementation, reverted afterwards).
- Module jest scope, core typecheck and eslint on the module green, commands + counts recorded.
- Live smoke on :3100 exercised R7 requirements import and R10 plan import from `lib/fixtures`, records cleaned up.
- `context/changes/delivery-os-oss-domain/handover/OSS-03-H14.md` present. `git status` shows only OSS-owned paths.

### Key Discoveries:

- Test kit `commands/__tests__/baselineTestKit.ts` gives `makeHarness(store)`, `makeProject/makeBaseline/makeApproval`,
  `makeDraft`, `draftAttachmentRows`, `makeRequirementsProposal`, `catchHttpError`, `expectFrozenBody`; its `Store`
  has no `evidence`, so the new file keeps a local store/`rowsFor` superset (pattern of `results.test.ts:62-76`).
- `commandRegistry.list()` exists (`packages/shared/src/lib/commands/registry.ts:96`).
- Fixture ids: `loadTaskPackageFixture('git')` / `loadResultManifestFixture('git')` are mutually correlated
  (used by `results.test.ts:138`).
- Wall clock on this machine is earlier than `UPDATED_AT`; never assert `new Date()` is later than fixture times.

## What We're NOT Doing

- No change to master-plan Progress, workstream docs or other streams' files; rows 3.4/3.5 stay manual.
- No new route, event, ACL feature, migration, DI key or generated file.
- No evidence/report API (OSS-05) and no traceability endpoint — the projections are tested as pure functions.
- No refactor of existing tests; duplicated coverage elsewhere stays.

## Implementation Approach

Decisions taken autonomously (the plan's questioning round answered from spec, code and judging criteria):

1. **Route immutability check = static scan of every `api/**/route.ts`** in the module (fs + regex on
   `export (async function|function|const) (PUT|PATCH|DELETE)` **and** names inside `export { … }` lists, the form used
   by the CRUD routes `api/tasks/route.ts:70` and `api/projects/route.ts:105`), asserting that files whose path contains
   `baselines`, `decisions`, `results` or `evidence` export no update/delete method, plus a positive control that the
   scanner sees their `POST` and sees `PUT`/`DELETE` on the tasks/projects CRUD routes (brace-export control).
   Covers future routes without importing Next handlers into a command test.
2. **Command immutability = pin the full delivery_os id set** from `commandRegistry.list()` and assert no id under
   `baselines|decisions|results|evidence` is an update/delete/archive. Adding such a command must fail the test.
3. **Scope change driven through real commands**: approved v1 + task pinned to v1 → draft edited → `baselines.create`
   → v2; v1 row deep-equal to its snapshot, active pointer unchanged until v2 is approved, task still on v1;
   `taskUpdateSchema` strips a `baselineId` key.
4. **Late result**: task + attempt on v1, v2 approved and active → `results.accept` accepts with
   `evidence.baselineId === v1`; the same attempt's manifest re-labelled with v2 id/hash is rejected
   (`baseline_mismatch`); `buildTraceability(v2)` has no evidence row and `deriveProjectStatus` reports `total` = v2 AC
   count with 0 proven even when the v1 task is verified.
5. **Reserve guard** exists — prove it with a realistic two-version store and a positive control (a task pinned to v2
   reserves). No production change expected.
6. **Decisions**: hash/version of v1 against v2 → `409 subject_hash_mismatch`, nothing persisted, pointer unchanged;
   contradictory concurrent pair → `409 optimistic_lock_conflict`; "no timeout path" = source scan proving only
   `commands/decisions.ts` creates `DeliveryDecision`, a decision without a user is refused, and
   `resolveActiveBaseline` never approves with only one kind approved even with the clock moved a year ahead.
7. **Schema**: chain FROM_BRIEF (requirements import → approvals → plan import) and FROM_DESIGN (manual create) in the
   harness; every persisted content parses with `baselineContentV1Schema`, hash equals `hashCanonical(content)`, and
   the three sources share one key set. Fall back to independent seeds if fixture AC ids do not chain.

## Phase 1: Scope-change and immutability test file

### Overview

Write `scopeChange.test.ts`; fix any rule that turns out unguarded (additive error codes only).

### Changes Required:

#### 1. New test file

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/scopeChange.test.ts`

**Intent**: One-to-one executable proof of master-plan 3.1/3.2 rules (1)–(6) described above.

**Contract**: same mocks as the sibling suites (`i18n/server`, `encryption/find`, `../../events`); local store with
`projects, baselines, decisions, tasks, attachments, evidence`; `describe` titles start with `(1)`…`(6)`.

#### 2. Guard fixes (only if a rule fails)

**File**: `packages/core/src/modules/delivery_os/{commands,lib}/*.ts`

**Intent**: Close a gap found by the tests with the smallest change.

**Contract**: additive `DeliveryErrorCode` only; no contract field removed or renamed.

### Success Criteria:

#### Automated Verification:

- New test file green: `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/scopeChange.test.ts --maxWorkers=2`
- Each rule's key assertion fails when its guard is temporarily disabled (mutation check, reverted; `git diff --stat` afterwards shows no production file changed unless a real fix was needed)

---

## Phase 2: Gate, live smoke and H14 hand-over

### Overview

Run the capped gate sequentially, smoke R7 + R10 on :3100, write the hand-over.

### Changes Required:

#### 1. Hand-over

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-03-H14.md`

**Intent**: Real API for QA/UI at H14: base SHA, DTO/profile versions, R6–R10 bodies, error codes, header rules,
assumption that UI-03 confirms the OSS-frozen proposal contracts, limitations, Progress rows with evidence
(3.1–3.3, 3.6; 3.4/3.5 human).

**Contract**: markdown in the existing handover folder (OSS-owned change folder).

#### 2. Spec changelog

**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`

**Intent**: one changelog line for the rule proofs (as T021/T022 did).

### Success Criteria:

#### Automated Verification:

- Module jest scope green: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Core typecheck green: `yarn workspace @open-mercato/core typecheck` (fallback: scoped tsconfig if memory-killed)
- New test file type-checks: temporary tsconfig in `/tmp` extending `packages/core/tsconfig.json` with `include` = the new test file (core tsconfig excludes `__tests__`)
- ESLint green on the module: `yarn eslint packages/core/src/modules/delivery_os`
- Live smoke on :3100 of R7 requirements import + R10 plan import passes and cleans up its records
- Hand-over file present and `git status` lists only OSS-owned paths

#### Manual Verification:

- QA-03 / UI-03 confirm the approved merged baseline of both inputs (master-plan 3.4/3.5 remain human)

## Testing Strategy

### Unit Tests:

- Rules (1)–(6) as above, including negative controls (wrong behaviour must be refused) and positive controls
  (the refusal is caused by the rule, not by a broken fixture).

### Integration Tests:

- Owned by QA (`TC-DELIVERY-*`); the live smoke is the scenario handed over.

### Manual Testing Steps:

1. Import requirements (R7), approve both kinds (R8), import the plan (R10), approve the merged baseline, set a task ready.
2. Edit the draft, freeze v+1, check old tasks stay pinned and reserve on them answers `baseline_not_active`.

## References

- Master plan: `context/changes/autonomous-software-delivery/plan.md` (Lifecycle, Phase 3, Progress 3.1–3.6)
- Previous hand-overs: `context/changes/delivery-os-oss-domain/handover/OSS-03-L7c-requirements-import.md`, `OSS-03-L7d-plan-import.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scope-change and immutability test file

#### Automated

- [x] 1.1 New test file green
- [x] 1.2 Each rule's key assertion fails when its guard is temporarily disabled

### Phase 2: Gate, live smoke and H14 hand-over

#### Automated

- [x] 2.1 Module jest scope green
- [x] 2.2 Core typecheck green
- [x] 2.3 New test file type-checks
- [x] 2.4 ESLint green on the module
- [x] 2.5 Live smoke on :3100 of R7 requirements import + R10 plan import passes and cleans up its records
- [x] 2.6 Hand-over file present and git status lists only OSS-owned paths

#### Manual

- [ ] 2.7 QA-03 / UI-03 confirm the approved merged baseline of both inputs
