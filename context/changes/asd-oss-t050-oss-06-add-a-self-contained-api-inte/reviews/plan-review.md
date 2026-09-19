<!-- PLAN-REVIEW-REPORT -->
# Plan Review: TC-DELIVERY-OSS-001 — v1 manual flow on the real database

- **Plan**: context/changes/asd-oss-t050-oss-06-add-a-self-contained-api-inte/plan.md
- **Mode**: Deep (grounding done inline; claims verified by reading the code, no sub-agent — memory rule)
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
5/5 paths ✓ (shared.ts, dbFixtures.ts, builders.ts, playwright.config.ts, TC-CRM-072), symbols ✓ (`findScopedProject`, `withClient`, `createOrganizationInDb`, `buildResultManifest`), delivery_os registered in `apps/mercato/src/modules.ts:107` so discovery includes the spec, brief↔plan ✓.

## Findings

### F1 — Global 20 s test timeout vs. a 20+ request chain

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, test 1
- **Detail**: `.ai/qa/tests/playwright.config.ts` sets `timeout: 20_000`; the publication chain issues ~25 requests and first hits compile routes. The skill forbids per-test timeout overrides but the repo uses `test.slow()` (TC-CRM-072).
- **Fix**: Call `test.slow()` in each test; no config edit.
- **Decision**: FIXED

### F2 — Parallel freeze expectation under the project row lock

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, test 3
- **Detail**: `commands/baselines.ts:208-238` takes the project row lock with the header check before looking for identical content, so a second parallel request with the same header may answer the platform 409 instead of `duplicate`. Asserting "both duplicate" would be wrong.
- **Fix**: Assert: no 5xx; every answer ∈ {201, 200 duplicate:true same id, 409 optimistic_lock_conflict}; exactly one 201; exactly one row per `(project, content_hash)` in SQL. The sequential replay with the current header covers the duplicate answer deterministically.
- **Decision**: FIXED

### F3 — Mutation proof must confirm the watcher rebuilt dist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 success criterion 1.4
- **Detail**: The app serves `packages/core/dist`; if the watcher lags, a green run proves nothing.
- **Fix**: Before the mutated run, grep `packages/core/dist/modules/delivery_os/commands/shared.js` for the change; after restore, grep again and re-run the spec green.
- **Decision**: FIXED

### F4 — Before/after counts on a shared dev DB

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Success criterion 1.3
- **Detail**: Other activity on the dev DB could change counts; nobody else writes delivery rows unattended.
- **Fix**: Accept; additionally assert inside the spec that no row with the spec's project ids remains.
- **Decision**: ACCEPTED
