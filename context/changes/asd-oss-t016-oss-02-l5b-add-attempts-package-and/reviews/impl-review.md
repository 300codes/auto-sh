<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L5b) attempts, package and results routes + deliveryOsAttemptQueries

- **Plan**: context/changes/asd-oss-t016-oss-02-l5b-add-attempts-package-and/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-09-19
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes
- **Findings**: 0 critical, 2 warnings, 6 observations (one read-only sub-agent; triage done autonomously)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (three benign drifts, recorded in the plan addendum) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after F1, F2 |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS — jest 29 suites / 681 tests, core typecheck, eslint, live transcript re-run after the fixes |

Confirmed fine: tenant/organization scope on every read; `automatic`, `trustedExecution`, `source: 'adapter'`, `taskId`
and `idempotencyKey` cannot be set from a body (`pathInput` is spread last); GET package is read-only; 413 body matches
the catalogue; no import cycle; repo rules respected.

## Findings

### F1 — Pending-delivery scan could starve newer rows

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/attemptQueries.ts (listPendingDeliveries)
- **Detail**: The 500 oldest attempted tasks were scanned with no pending filter; past 500 finished tasks newer pending deliveries would never be returned.
- **Fix**: Page through the scan (200 rows) until `limit` is reached or rows run out.
- **Decision**: FIXED (test asserts the second page and the 100 cap)

### F2 — Size limit trusted only the declared Content-Length

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: api/tasks/[id]/results/route.ts
- **Detail**: A missing or false header let an arbitrarily large body be buffered before the 2 000 000-char check.
- **Fix**: Read the body through a byte-capped stream reader (`readCappedRouteBody` in `api/routeSupport.ts`).
- **Decision**: FIXED (test covers declared and streamed oversize)

### F3 — getAttempt reads archived tasks, buildTaskPackage does not

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: commands/attemptQueries.ts
- **Detail**: Asymmetry not decided in the plan.
- **Fix**: Keep (history must stay readable for reconciliation) and document it in the spec and hand-over.
- **Decision**: ACCEPTED — documented

### F4 — R16 parsed the body before the scope check

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: api/tasks/[id]/results/route.ts
- **Detail**: UA-12 orders scope (foreign → 404) before schema.
- **Fix**: `requireScopedTask` before reading the body.
- **Decision**: FIXED (test: foreign scope + bad body → 404)

### F5 — No test for a body-sent idempotencyKey

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: api/__tests__/attempts.route.test.ts
- **Fix**: Smuggle `idempotencyKey` in the body, assert the header key is stored and replays with 200.
- **Decision**: FIXED

### F6 — Vacuous assertions

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: api/__tests__/attempts.route.test.ts
- **Fix**: Remove the constant assertion and the unused fixture lookup; assert the `mode` detail path.
- **Decision**: FIXED

### F7 — Zero-writes test never proved the spies can fire

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: api/__tests__/package.route.test.ts
- **Fix**: Assert `em.transactional` was called by the reservation before clearing the spies.
- **Decision**: FIXED

### F8 — Limit clamp and paging untested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/attemptQueries.test.ts
- **Fix**: Clamp cases (0, -1, 1.5, NaN, 500) and an assertion on the options passed to `findWithDecryption`.
- **Decision**: FIXED
