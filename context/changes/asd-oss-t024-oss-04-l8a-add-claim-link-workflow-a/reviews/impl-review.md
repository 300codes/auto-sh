<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-04 (L8a) claim, link_workflow, mark_delivery and closing the attempt on accept

- **Plan**: context/changes/asd-oss-t024-oss-04-l8a-add-claim-link-workflow-a/plan.md
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (NEEDS ATTENTION before F1)
- **Findings**: 1 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL → PASS after F1 |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (924 tests, core typecheck, test tsconfig, eslint; manual 3.3 pending for EXEC) |

## Findings

### F1 — The trusted gate could be satisfied from an HTTP call through generic command dispatchers

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/attempts.ts (gate), commands/evidence.ts:57
- **Detail**: `notifications/lib/notificationService.ts:733-754` and `messages/commands/actions.ts:354` execute a stored free-string `commandId` with a ctx that has no `request` and spread the HTTP payload into the input. A tenant user could therefore call `delivery_os.attempts.claim|link_workflow|mark_delivery` (and the pre-existing `reserve` automatic / `accept` adapter) with a forged `trustedExecution` JSON object, bypassing the delivery_os ACL and spoofing the audit actor. Scope stayed tenant-bound.
- **Fix**: replace the forgeable JSON marker with an object issued in-process: `lib/trustedExecution.ts` (`issueTrustedExecution` registers a frozen object in a `WeakSet` on a `Symbol.for` global, so duplicated module instances share it); all five trusted paths check `isIssuedTrustedExecution(rawInput.trustedExecution)` on the raw input reference.
  - Strength: nothing parsed from JSON can ever pass; no core/shared change; OSS still never imports enterprise.
  - Tradeoff: EXEC must issue the option inside the worker (cannot put it in a queue payload); `results.accept` adapter now needs the option.
  - Confidence: HIGH — forged-copy tests for all five paths; command bus only shallow-copies input (`command-bus.ts:253`).
  - Blind spot: a future in-process module could import `issueTrustedExecution` itself; that is trusted code by definition.
- **Decision**: FIXED

### F2 — Flow test swallowed the reason a redelivered claim was skipped

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: commands/__tests__/results.test.ts (makeBridge)
- **Detail**: bare `catch { return 'skipped' }`; the plan asked to show the redelivered claim answers `attempt_closed`.
- **Fix**: assert `409 attempt_closed` on the caught `CrudHttpError`, rethrow anything else.
- **Decision**: FIXED

### F3 — Link must precede accept, otherwise the delivery never becomes pending

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lib/attempts.ts (recordAttemptResult / linkAttemptWorkflow)
- **Detail**: pending is decided at accept time from `workflowRef`; a later link answers `attempt_closed`. By design (master plan: link + enqueue before dispatch), but the executor must know.
- **Fix**: state the ordering rule in the hand-over (done); covered by the lib test "rejects a link on a result_received attempt".
- **Decision**: FIXED (documented)

### F4 — Gate order for in-process callers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: commands/attempts.ts runner
- **Detail**: the missing-option check ran after parsing, so an untrusted in-process caller could get validation hints (400) instead of 403.
- **Fix**: with F1 the whole gate (request + issued option) runs on the raw input before parsing.
- **Decision**: FIXED via F1

### F5 — Failed deliveries bump `updatedAt` and write an audit row each

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/attempts.ts (mark_delivery)
- **Detail**: retry loops can cause optimistic-lock 409s for a human editing the task and grow the audit log.
- **Fix**: documented in the hand-over (back off between retries); the counter + last error are the required behaviour.
- **Decision**: ACCEPTED

### F6 — Crash after claim leaves the attempt claimed

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: hand-over bridge order
- **Detail**: same-worker retry gets `changed: false` and must not run the CLI; the attempt waits for reconcile.
- **Fix**: documented; this is the master-plan rule "an unknown process never restarts by itself" (reconcile is the next OSS-04 step).
- **Decision**: ACCEPTED

### F7 — Side-effect assertions only on claim; no `task.updated` event from the internal commands

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: commands/__tests__/attempts.test.ts
- **Detail**: one shared runner, so index/audit/lock assertions on claim cover all three; the missing domain event is plan decision 9 and is in the spec.
- **Fix**: none.
- **Decision**: DISMISSED — intended, shared code path.
