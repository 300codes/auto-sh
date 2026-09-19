<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-06 Full Capped Gate & OSS-only Reproduction

- **Plan**: context/changes/asd-oss-t037-run-the-full-capped-gate-once-reprod/plan.md
- **Mode**: Quick (single-session, autonomous)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
4/4 paths ✓ (jest.config.base.cjs:39 maxWorkers 2, apps/mercato/src/modules.ts:197, apps/mercato/.env enterprise=false, apps/mercato/next.config.ts:24 distDir), progress↔phase ✓, brief↔plan ✓

## Findings

### F1 — Unfiltered `turbo run build` would also run next build and the docs site build

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — gate run
- **Detail**: The task says "yarn turbo run build --concurrency=2 (packages)". Without a filter turbo also builds `@open-mercato/app` (next build, duplicated by `yarn build:app`) and the docs site — double RAM-heavy work.
- **Fix**: Keep `--filter='./packages/*'` and state in the gate record that app build is covered by `yarn build:app` and docs build is not run.
- **Decision**: FIXED (plan already uses the filter; gate record states it)

### F2 — A delivery_os fix after later steps invalidates earlier results

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — delivery_os fixes
- **Detail**: If a fix lands after e.g. typecheck, the recorded typecheck no longer describes the final tree.
- **Fix**: After any fix, re-run the scoped affected commands (core typecheck/lint/delivery_os jest) and record them as re-runs next to the original result; the gate record names which tree each result describes.
- **Decision**: FIXED

### F3 — Commit SHA of the final tree is not known at run time

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — gate record
- **Detail**: No git writes allowed; the gate runs on HEAD + uncommitted working-tree changes.
- **Fix**: Record HEAD SHA plus "working tree: clean / list of changed files"; the orchestrator's commit carries the record.
- **Decision**: FIXED
