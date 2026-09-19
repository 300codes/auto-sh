<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-06 Final-Commit Regression Suite

- **Plan**: context/changes/asd-oss-t036-add-the-final-commit-regression-suit/plan.md
- **Mode**: Deep (claims verified directly in code, no sub-agent — small plan)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL → PASS after F1 |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding
5/5 paths ✓ (routeTestKit.ts, attemptRouteKit.ts, module-registration.test.ts, apps/mercato/src/modules.ts, spec), symbols ✓ (subject_hash_mismatch, reconciliation_required, result_conflict, FORBIDDEN_IMPORT_PATTERN), brief↔plan ✓

## Findings

### F1 — A manual_handoff attempt can never emit completionDelivery 'pending'

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Critical Implementation Details / scenario 3
- **Detail**: `lib/attempts.ts:399` sets `completionDelivery: attempt.workflowRef ? 'pending' : null`; `workflowRef` is only set by the internal `delivery_os.attempts.link_workflow` command, which needs the issued trusted option (HTTP cannot). A duplicate on the manual path emits `completionDelivery: null`, so the acceptance wording ("re-emitted event with completionDelivery pending") is unreachable through HTTP alone. The plan left this as "verify during implementation".
- **Fix**: Scenario 3 models the real callback: reserve (automatic), claim and link_workflow through the registered commands with `issueTrustedExecution` exactly like the EXEC bridge, then POST the same manifest twice through the HTTP results route R16 (the duplicate callback), asserting 201/200, one evidence row and the second emitted event `{ duplicate: true, completionDelivery: 'pending' }`. The changed manifest answers 409 `result_conflict`.
- **Decision**: FIXED

### F2 — Requiring the app's modules.ts from core jest may not transform

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — manual_handoff describe
- **Fix**: Try `jest.isolateModules` + env unset first; if the transformer refuses the path outside rootDir, fall back to a text assertion on the same file (`delivery_os` from core outside any enterprise guard) and record it.
- **Decision**: FIXED (fallback written into plan)

### F3 — Restart "executor" is a test counter, not a real process

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: scenario 4
- **Fix**: Keep it (HTTP can only run the executor via a 201 reservation); the command-level worker bridge counter already lives in `commands/__tests__/executorFlow.test.ts` QA scenario (c). State this in the hand-over.
- **Decision**: ACCEPTED
