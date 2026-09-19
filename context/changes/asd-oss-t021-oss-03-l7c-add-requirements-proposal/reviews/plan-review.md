<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-03 (L7c) requirements-proposal import

- **Plan**: context/changes/asd-oss-t021-oss-03-l7c-add-requirements-proposal/plan.md
- **Mode**: Deep (claims verified directly against the code, no sub-agent needed for this scope)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
6/6 paths ✓, symbols ✓ (`lockScopedProject`, `lockProjectForWrite`, `readCappedRouteBody`, `validateRequirementsProposal`, `isUniqueViolation`), brief↔plan ✓, Progress↔Phase ✓. Verified: `runRouteMutationGuards` does not check the lock header, so a stale-header replay reaches the command; no other package keeps a strict copy of `BaselineContent v1`.

## Findings

### F1 — Error precedence differs from the manual source and is not pinned

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details — Lock order
- **Detail**: Manual answers 428 before anything else; the import must answer 422 (manifest) and the replay before 428. Without a stated order the implementer and UI guess.
- **Fix**: State the order 404 → 400/422 manifest → replay 200/409 → 428 → platform 409 → draft/freeze 4xx, and pin it in a test.
- **Decision**: FIXED

### F2 — Replay answer shape for `openCommentIds`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Command
- **Detail**: A replay does not run the freeze, so it has no open-comment list.
- **Fix**: Replay returns `openCommentIds: []`; documented in the spec row.
- **Decision**: FIXED

### F3 — Replay lookup must read stored content defensively

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Command
- **Detail**: `content` is `Record<string, unknown>`; a full-schema parse of every stored baseline would turn one altered row into a failed import.
- **Fix**: Parse only the `importedManifests` field with its own small schema; rows without it are skipped.
- **Decision**: FIXED

### F4 — Project side effect needs the project indexer config

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Command
- **Detail**: `projectCrudIndexer` is a private const in `projects.ts` and duplicated in `decisions.ts`.
- **Fix**: Follow the existing local-const pattern in `baselines.ts` (no cross-file refactor in this task).
- **Decision**: FIXED

### F5 — Live smoke runs against the built core package

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Success Criteria
- **Detail**: The dev server bundles `packages/core/dist`; changed command code is only live after the package is rebuilt and the server restarted.
- **Fix**: Add the rebuild + restart to step 2.4's description.
- **Decision**: FIXED
