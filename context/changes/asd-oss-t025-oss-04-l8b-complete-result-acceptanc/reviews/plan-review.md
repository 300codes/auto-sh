<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-04 (L8b): complete result acceptance checks

- **Plan**: context/changes/asd-oss-t025-oss-04-l8b-complete-result-acceptanc/plan.md
- **Mode**: Deep (claims verified by the reviewer against the code; no sub-agent, the research agents had just mapped the same files)
- **Date**: 2026-09-19
- **Verdict**: SOUND after fixes (was REVISE)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Grounding: 6/6 paths ✓ (`lib/resultAcceptance.ts`, `lib/taskPackage.ts`, `commands/attachments.ts`, `commands/evidence.ts`, `lib/fixtures/index.ts`, `lib/__tests__/fixtures.test.ts`), 4/4 symbols ✓ (`isPathAllowed`, `verifyDraftAttachments`, `makeAttachmentInspector`, `RESULT_ACCEPTANCE_PENDING_CHECKS`), brief↔plan ✓. Both published manifests (git, snapshot) were checked against the planned check rules: all checks conform (test checks use mapped ids and the `test` definition's command profile; other checks use `testId === checkId`).

## Findings

### F1 — Storage reads under the task row lock have no stated byte bound

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Generalised attachment verifier
- **Detail**: The size rule bounds *declared* sizes, and `sizeBytes` is optional. The stored files are what is read. `verifyDraftAttachments` already refuses when the stored `fileSize` total exceeds 64 MiB before reading any byte; the plan did not say the extracted function keeps that guard.
- **Fix**: State that `verifyAttachmentReferences` keeps `checkTotalAttachmentBytes` on stored sizes before the first read.
- **Decision**: FIXED

### F2 — Mixed attachment failures and the remap to `foreign_reference`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — `verifyResultArtifacts`
- **Detail**: The verifier picks the top code by priority (scope first). The plan did not say what happens to a `missing_render` top code — it cannot occur for role `attachment`, but a `413` total-size answer can and must pass through unchanged.
- **Fix**: Remap only `attachment_scope_mismatch`; every other answer passes through as is. Add a test for the mixed case (scope + hash → `foreign_reference` with both details).
- **Decision**: FIXED

### F3 — The `acceptance` stage runner needs declared tests and a positive twin

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Lib tests
- **Detail**: `fixtures.test.ts` throws on an unknown stage, pins the required `stage:code` classes and keeps a positive-twin test. The plan mentioned them only in passing; the runner must build its context from the task-package fixture plus `declaredTests` of the baseline-content fixture.
- **Fix**: Spell out the runner inputs, the two new required labels (`acceptance:path_not_allowed`, `acceptance:unknown_test_id`) and the twin (published manifest passes the `acceptance` stage).
- **Decision**: FIXED

### F4 — Vague sentence in the command wiring step

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Command wiring
- **Detail**: "Pass `profile`-independent inputs only…" says nothing actionable. The evaluation resolves the profile itself and reads `declaredTestIds` from the package result, so the command's evaluation call does not change.
- **Fix**: Replace the sentence.
- **Decision**: FIXED

### F5 — Renamed export is referenced in older documents

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Decision 10
- **Detail**: `RESULT_ACCEPTANCE_PENDING_CHECKS` appears in older changelog lines and hand-overs. Those are history and stay; the new changelog line and hand-over must name the rename so readers can follow.
- **Fix**: Mention the rename in the changelog line and hand-over.
- **Decision**: FIXED

### F6 — Strict check rules versus a not-yet-written EXEC adapter

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Decisions 3–5
- **Detail**: A real runner reports every test of the suite. With `declaredTests` in the catalogue and `acIds: []` allowed for tests outside the task, a whole-suite report passes; a test the agent wrote but nobody declared is rejected. That is the intended safety boundary (master plan: the model cannot add mappings), and the error lists each offending check, but EXEC must know it before the live trial.
- **Fix**: Keep the rule; make it the first patch request in the hand-over (report only declared tests, put the rest into `findings`).
- **Decision**: ACCEPTED (rule kept, hand-over item added to the plan)
