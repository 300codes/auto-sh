<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-03 (L7d) Plan-Proposal Import

- **Plan**: context/changes/asd-oss-t022-oss-03-l7d-add-plan-proposal-import/plan.md
- **Mode**: Deep (claims verified directly against the code, no sub-agent — single module, memory rule)
- **Date**: 2026-09-19
- **Verdict**: SOUND after fixes (was REVISE)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 6/6 paths ✓ (`lib/proposals.ts`, `commands/{baselines,tasks,index}.ts`, `api/projects/[id]/tasks/route.ts`, `api/schemas.ts`), symbols ✓ (`findImportedManifest`, `resolveActiveBaseline`, `readCappedRouteBody`, `taskGraphCheck`, `operation: 'create' | 'custom'`), brief↔plan ✓, Progress↔Phase ✓

## Findings

### F1 — Draft sync can throw or drop data when the stored draft is malformed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decision 6 / Phase 1 §3
- **Detail**: `project.draftSpec` is raw jsonb. Parsing it with `draftSpecV1Schema` inside the plan import would turn an unrelated draft problem into a refused plan import (the plan is validated against the *baseline*, not the draft).
- **Fix**: sync by shallow spread over the stored record (`{ ...draft, architectureSummary, planSummary, acTestMap, declaredTests }`), never parse the draft in this command. `descriptionSchema` and `longTextSchema` are both `max(8000)` so the copied values always fit the draft schema.
- **Decision**: FIXED

### F2 — Replay with archived tasks is unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Decision 4
- **Detail**: If a user archived an imported task, a replay returns fewer tasks than the first answer; the partial unique index ignores `deleted_at`, so re-creating is impossible anyway.
- **Fix**: state it: replay returns live tasks only, never re-creates; documented in spec + hand-over and pinned by a test.
- **Decision**: FIXED

### F3 — Shared test kit change can break existing suites

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §4
- **Detail**: `baselineTestKit.makeHarness().persist` routes rows by `'contentHash' in row`; adding tasks must not reroute baselines/decisions. `Store` gains a field used by four suites.
- **Fix**: add `tasks` to `emptyStore()` and route `'proposalTaskKey' in row` first; run the whole delivery_os scope, not just the new file.
- **Decision**: FIXED

### F4 — `baseline_not_approved` before `baseline_hash_mismatch`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Decision 2
- **Detail**: A plan made for an old version answers `baseline_not_approved`/`baseline_not_active` (naming the active id) rather than a hash mismatch. Both are 422 and both tell the agent to re-plan; the chosen order is pinned by a test and written in the spec.
- **Fix**: none needed.
- **Decision**: ACCEPTED
