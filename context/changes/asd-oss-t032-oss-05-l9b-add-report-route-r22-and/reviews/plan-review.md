<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-05 (L9b) report route R22 and the report query

- **Plan**: context/changes/asd-oss-t032-oss-05-l9b-add-report-route-r22-and/plan.md
- **Mode**: Deep (inline, no sub-agent — single-module read path)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
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
5/5 paths ✓ (validators.ts, di.ts, commands/evidence.ts, routeTestKit.ts, spec), symbols ✓ (`parseDeliveryInput`, `MAX_TRACEABILITY_ROWS = 1000`, `deliveryReportV1Schema`, `requireVerifiedBaselineContent`), brief↔plan ✓

## Findings

### F1 — Snapshot ref parsing ambiguous when the workspace id contains `:`
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach, decision 1
- **Detail**: `snapshot:<sha256>:<externalWorkspaceId>` — workspace ids are free strings (1–200) and may contain `:`.
- **Fix**: split on the first two `:` only; the remainder is the workspace id; validate the object with `sourceRevisionSchema`.
- **Decision**: FIXED

### F2 — Unknown project profile path untested
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §5 Tests
- **Detail**: decision 2 promises `422 unknown_target_profile` but no test covers it; also unreadable/altered baseline (`hash_mismatch`) untested.
- **Fix**: add both cases to `report.route.test.ts`.
- **Decision**: FIXED

### F3 — Unbounded evidence read per baseline
- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, decision 4
- **Detail**: all evidence rows (with payloads) of one baseline are loaded in one query. At demo scale (tens of rows) this is fine; a paged read would change nothing in the result since the builder needs all rows to decide AC status.
- **Fix**: accept for the hackathon; note it in the hand-over as a known limit.
- **Decision**: ACCEPTED

### F4 — Exporting a private helper from commands/evidence.ts
- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §3
- **Detail**: reusing `requireVerifiedBaselineContent` is better than duplicating the hash check; exporting it is additive and in the same module.
- **Fix**: none.
- **Decision**: DISMISSED
