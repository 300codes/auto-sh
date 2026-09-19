<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-03 (L7c) requirements-proposal import

- **Plan**: context/changes/asd-oss-t021-oss-03-l7c-add-requirements-proposal/plan.md
- **Scope**: Phases 1–2 of 2 (independent read-only reviewer sub-agent + own pass)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Checked clean by the reviewer: tenant/organization scoping on every query; replay-before-lock never writes and only
matches `manifestId` + hash; feature check vs command input (both commands re-check `source`, path id wins); no query
after the first mutation; manual command behaviour unchanged; conflict detail stays inside the project scope;
`importedManifests` cannot be forged through the draft (schema strips it, builder takes provenance only from extras).

## Findings

### F1 — "no query after the first mutation" test measured persist, not the mutation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/baselines.test.ts (import describe)
- **Detail**: A query added between `project.draftSpec = …` and `persist` would still have passed.
- **Fix**: Setter spy on `draftSpec` records the query count at the first mutation; the test asserts no later query.
- **Decision**: FIXED

### F2 — Unique-violation recovery test found the row it had just written

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/baselines.test.ts (both describes)
- **Detail**: The mocked transaction persisted the row and then threw, so the "winner" was self-made.
- **Fix**: `persist` is a no-op, another writer's row with its own id is seeded, the result must carry that id; a rethrow leg was added for the import.
- **Decision**: FIXED (manual test strengthened the same way)

### F3 — Content-hash duplicate branch and recovery are practically unreachable for imports

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: commands/baselines.ts (import transaction)
- **Detail**: Imported content embeds the manifest identity and both writers hold the project row lock.
- **Fix**: Keep as defensive code — the task explicitly requires unique-violation recovery.
- **Decision**: ACCEPTED

### F4 — Import overwrote draft sections without an audit trace of what was dropped

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/baselines.ts buildLog
- **Fix**: Command result and audit `snapshotAfter` now carry `prunedAcIds`; covered by a test.
- **Decision**: FIXED

### F5 — Project is read three times per new import

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Detail**: Pre-transaction 404, row lock for the replay, `lockProjectForWrite`. Correct; keeps the pinned error precedence and reuses the shared helper.
- **Decision**: ACCEPTED

### F6 — `projectUpdatedAt` is required in the response schema, plan said optional

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Detail**: Both commands always return it, so required is the more accurate documentation.
- **Decision**: ACCEPTED
