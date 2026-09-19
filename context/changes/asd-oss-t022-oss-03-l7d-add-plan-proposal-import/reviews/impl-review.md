<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-03 (L7d) Plan-Proposal Import

- **Plan**: context/changes/asd-oss-t022-oss-03-l7d-add-plan-proposal-import/plan.md
- **Scope**: Phases 1–2 of 2 (full)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes; was NEEDS ATTENTION)
- **Findings**: 0 critical, 3 warnings, 3 observations
- **Method**: one independent read-only reviewer sub-agent (drift + safety + patterns combined; a single agent because of the 16 GB memory rule), success criteria re-run by the implementer.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after F1, F2) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (35 suites / 862 tests; filtered tsc + eslint clean; live smoke 21/21) |

Confirmed by the reviewer: all reads precede the first mutation, one flush inside one transaction, every rejection
throws before any `persist`, every query is tenant+organization scoped through `findWithDecryption`, per-source
feature check before the command, scope never from client input, precedence matches decision 2, `activeBaselineId`
never written.

## Findings

### F1 — Draft sync could make the draft unfreezable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/planImport.ts (draft sync)
- **Detail**: The merged `acTestMap` is keyed by the parent baseline's ACs. If the user removed an AC from the draft after approval, the synced map carried a key the draft no longer has and the next manual freeze failed `checkKnownAcKeys`.
- **Fix**: `pickDraftAcEntries` keeps only entries whose AC id is in the draft's `acceptanceCriteria`; test with a drifted draft.
- **Decision**: FIXED

### F2 — Parent content hash was not verified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/planImport.ts (after `readBaselineContent`)
- **Detail**: Content altered in storage after approval would have been copied into a new, self-consistent baseline. The decision command and the ready gate both verify the hash.
- **Fix**: `tryHashBaseline(parentContent) !== parent.contentHash` → `422 hash_mismatch`; negative test added.
- **Decision**: FIXED

### F3 — Test gaps on lineage idempotency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/planImport.test.ts
- **Detail**: No test for a second plan on the activated merged baseline (v3 inherits both manifests, replay of the first still answers v2 with a stable `updatedAt`), nor for a plan/requirements `manifestId` collision.
- **Fix**: both tests added.
- **Decision**: FIXED

### F4 — `importedManifests` max(50) answers a generic 400

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lib/proposals.ts / lib/contracts.ts
- **Detail**: 50 plan imports in one lineage; unreachable at hackathon scale, already documented for `importedManifestHashes` (T019).
- **Decision**: SKIPPED

### F5 — Unique-violation recovery is practically unreachable

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Detail**: The project row lock serialises imports. Required by the task text; kept as cheap defensive code (same decision as T021).
- **Decision**: ACCEPTED

### F6 — Route cap (1 MB) is below the manifest schema cap

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Detail**: Harmless; the route answers `413` first. A plan of 100 tasks is far below 1 MB.
- **Decision**: ACCEPTED
