<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-04 (L8b): complete result acceptance checks

- **Plan**: context/changes/asd-oss-t025-oss-04-l8b-complete-result-acceptanc/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after F1–F4 |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria run: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 38 suites,
973 tests passed after the fixes (969 before). Scoped `tsc` over touched production and test files: no new errors
(two pre-existing errors in the untouched `api/__tests__/routeTestKit.ts`). `git status`: no migration, generated file
or dependency change. Manual row 2.4 stays open for a human; an API-level live smoke on :3100 is recorded as evidence.

Plan drift agent: every planned change MATCH; one trivial EXTRA (log text "baseline verification" → "verification",
needed because the function now serves results too). All five acceptance criteria proven by tests.

## Findings

### F1 — A criterion named like an Object.prototype key crashes the checks rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/lib/resultChecks.ts:61
- **Detail**: `requiredTests[acId] ?? []` on a plain object: an AC id `constructor` with only a manual check returns the `Object` function, `.includes` throws, the route answers 500 instead of `422`.
- **Fix**: Read the map through `Object.hasOwn`; add a test.
- **Decision**: FIXED

### F2 — Check kind was detected with `some` over all definitions sharing a command profile

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/lib/resultChecks.ts:47-56
- **Detail**: A profile with a `test` and a `lint` check under one `commandProfileId` would reject the honest lint report as `unknown_test_id` (fails closed, no bypass, but the task could never be accepted).
- **Fix**: Resolve a non-test definition by `checkId === testId` first, then fall back to the test catalogue; add a test.
- **Decision**: FIXED

### F3 — Stored artifacts were read before the transition check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/evidence.ts:136-140
- **Detail**: Up to 64 MiB of storage reads under the task row lock ran before the pure `canTransition` check, so a task that cannot move paid the reads and then failed.
- **Fix**: Move the transition assertion above `verifyResultArtifacts`; add a test that the inspector is not called.
- **Decision**: FIXED

### F4 — The stored-total 413 used baseline wording and a path the manifest does not have

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/core/src/modules/delivery_os/commands/attachments.ts (verifyResultArtifacts)
- **Detail**: "The baseline attachments are too large together", path `attachments`; undocumented and untested on the result path.
- **Fix**: `verifyResultArtifacts` rewrites that answer to path `artifacts`, detail `artifacts_total_too_large`; test + spec + hand-over updated.
- **Decision**: FIXED

### F5 — Artifact MIME allow-list is the baseline list

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: packages/core/src/modules/delivery_os/lib/resultAcceptance.ts (collectArtifactReferences)
- **Detail**: XML/HTML/zip artifacts are refused (`attachment_hash_mismatch` / `unsupported_mime_type`). Intended: nothing executable or archived is imported (master plan: "import nie uruchamia kodu z archiwum"); the hand-over lists the allowed types for EXEC.
- **Fix**: None now; add an `artifact` role with its own list if EXEC needs JUnit XML.
- **Decision**: ACCEPTED — documented in the hand-over

### F6 — Declared-size limits are advisory

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/lib/resultAcceptance.ts:103-111
- **Detail**: `sizeBytes` is optional and agent-supplied. The real bound is the stored-size check before any read, which holds.
- **Fix**: None.
- **Decision**: DISMISSED — by design, the stored bound is enforced

### F7 — `source_revision_mismatch` is unreachable through the manifest schema

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: packages/core/src/modules/delivery_os/lib/resultChecks.ts:69-71
- **Detail**: The schema answers `revision_mismatch` first. Kept on purpose for the R19 reuse (plan decision 6), unit-tested directly.
- **Fix**: None.
- **Decision**: DISMISSED — planned

### F8 — Trust gaps outside this change

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: N/A
- **Detail**: `changedPaths` is self-declared (EXEC must take it from the real diff — hand-over item 5); a `passed` check with `acIds: []` must never be credited to an AC (the report in OSS-05 computes AC proof from the frozen map, not from `acIds`); `testDefinitionHash` is not compared with anything yet.
- **Fix**: Carry into `lib/acProof.ts` / report tasks (T027+).
- **Decision**: ACCEPTED — noted for the next tasks
