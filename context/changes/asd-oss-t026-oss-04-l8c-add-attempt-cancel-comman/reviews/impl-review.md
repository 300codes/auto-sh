<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-04 (L8c): attempt cancel command and route R17

- **Plan**: context/changes/asd-oss-t026-oss-04-l8c-add-attempt-cancel-comman/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Drift review: every planned change MATCH (check order, idempotent repeat, reason in audit only, task status untouched,
side effects after commit on change only, 5-field response, all planned tests). EXTRA: harmless additional tests.
Safety review: scope, path-over-body precedence, row lock before register read, stale check against the locked row,
side effects after commit — all correct. Success criteria re-run after fixes: delivery_os jest 39 suites / 992 tests
pass; scoped tsc clean apart from the pre-existing implicit-any errors in the unchanged `api/__tests__/routeTestKit.ts`;
core `typecheck` clean before the fixes (fixes are a one-line throw swap plus docs/tests). Manual row 2.5 stays open.

## Findings

### F1 — Plain Error (500) on inconsistent stored cancellation

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/attempts.ts (toCancelResult)
- **Detail**: `executionAttemptSchema` does not pair `cancel_requested` with `stop_unconfirmed` + `cancellationRequestedAt`; bad stored data on the repeat path answered 500.
- **Fix**: Throw `unreadableRegisterError()` (409 reconciliation_required / unreadable_attempt_register) and test it.
- **Decision**: FIXED

### F2 — Repeat without header answers 428 while a stale header answers 200

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/core/src/modules/delivery_os/api/tasks/[id]/attempts/[attemptId]/cancel/route.ts (openApi)
- **Detail**: Differs from the reserve replay (no header needed); matches the spec row "428 when missing" and plan decision 2.
- **Fix**: State it explicitly in the OpenAPI description (behaviour kept per spec).
- **Decision**: FIXED (documented)

### F3 — Reason of a repeat cancel silently dropped

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: same route openApi + spec changelog
- **Detail**: By design (no write on a repeat); undocumented.
- **Fix**: One line in OpenAPI and spec changelog.
- **Decision**: FIXED (documented)

### F4 — Audit snapshot contains the full attempt

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: commands/attempts.ts (cancel buildLog)
- **Detail**: Reserve logs no attempt fields; the cancel log carries `workerRef`, `externalRunId`, `workflowRef`.
- **Decision**: DISMISSED — the internal attempt commands (T024) already log the full attempt; the fields are tenant-scoped transport refs, not secrets, and the plan review fixed this shape (F2 of the plan review).

### F5 — Changelog/hand-over implied claim/link/package were newly tested

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: .ai/specs/2026-09-18-delivery-os-hackathon.md changelog; handover OSS-04-L8c-cancel.md
- **Fix**: Reword to "already covered by earlier tests".
- **Decision**: FIXED
