<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F1 L13a — Intake and Flow-Pin Commands

- **Plan**: context/changes/asd-oss-t044-flow-f1-l13a-add-intake-and-flow-pin/plan.md
- **Scope**: Phases 1–3 of 3 (independent sub-agent review of the uncommitted diff, read-only)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 1 critical, 2 warnings, 5 observations — all triaged

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (after F2/F3 fixes; deviations recorded in the plan addendum) |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after F1) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS — 66 suites / 1447 tests, core typecheck, eslint on touched files |

## Findings

### F1 — Intake response `updatedAt` taken before flush diverges from the stored value
- **Severity**: ❌ CRITICAL · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: commands/intake.ts (F2/F3 execute)
- **Detail**: `DeliveryIntake.updatedAt` has `onUpdate`, which MikroORM applies on UPDATE change sets after the manual assignment; the response built inside the transaction carried an earlier timestamp than the row, so the wizard's next autosave would 409 from the third save on.
- **Fix**: build the response after `em.transactional` resolves from `row.updatedAt` (v1 precedent `projects.ts`, `flow.ts`).
- **Decision**: FIXED

### F2 — F3 replay under the lock did not hold over HTTP
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence · **Location**: commands/intake.ts import_proposal tx
- **Detail**: the intake version was enforced before the locked merge, so a concurrent import of the same manifest answered 409 instead of the replay shape.
- **Fix**: merge first under the lock, return the replay shape on `duplicate`, enforce the version only on the write path. Covered by the new race test.
- **Decision**: FIXED

### F3 — Lock header made conditional on `ctx.request` for F2/F4
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence · **Location**: commands/intake.ts, commands/flow.ts
- **Fix**: `requireLockHeader` unconditional on F2 and F4 (F3 keeps the in-process exception for the trusted agent).
- **Decision**: FIXED

### F4 — Pin re-check under the lock unreachable over HTTP
- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Location**: commands/flow.ts pin tx
- **Fix**: `lockScopedProject` → pin-state check → project version check only on the real-pin path.
- **Decision**: FIXED

### F5 — Attachment storage I/O under two row locks
- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Location**: commands/intake.ts update
- **Fix**: verify `brief.materials` on a forked em before the transaction (scope-only check, lock-independent).
- **Decision**: FIXED

### F6 — Test name claimed the blocking-question path but hit `step_skipped`
- **Severity**: ℹ️ OBSERVATION · **Location**: commands/__tests__/intake.test.ts
- **Fix**: seed a `review` row and assert `blocking_question_unanswered`; added `duplicate_stable_id`, F3 `target_profile_frozen`, audit-snapshot PII and race tests.
- **Decision**: FIXED

### F7 — Dead `assertDeliveryFlowCheck` helper
- **Severity**: ℹ️ OBSERVATION · **Location**: commands/shared.ts
- **Decision**: FIXED (removed)

### F8 — Mixed resource id in the intake 409 body
- **Severity**: ℹ️ OBSERVATION · **Location**: commands/intake.ts enforceIntakeLock
- **Decision**: FIXED (`resourceId` = project id, the intake is 1:1 per project)

## Coverage gaps accepted
- F3 `unsupported_schema_version` / `manifest_required` are schema-level (a `schemaVersion` literal mismatch surfaces as 400 `validation_failed` through the v1 zod mapper, not the 422 the spec row lists) — contracts concern, carried to L14 route tests.
