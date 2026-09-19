<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-04 H17/H21 — fake-executor flow, QA scenarios and hand-over

- **Plan**: context/changes/asd-oss-t030-oss-04-h17-h21-fake-executor-flow-te/plan.md
- **Scope**: all phases (2 of 2)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 4 warnings, 4 observations (independent sub-agent review of the test and hand-over)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: executorFlow 6/6; `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 46 suites / 1122 tests green; scoped tsc exit 0; live smoke exit 0. Manual row 2.4 (QA replay on a real DB) left pending for humans.

## Findings

### F1 — Scenario (b) acProof used a hand-built v1 row, so it did not prove "no credit"
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria · **Location**: executorFlow.test.ts scenario (b)
- **Fix**: also assert `proveAcceptanceCriteria` for v2 over `toProofEvidence(store.evidence)` (the real rows) is `missing`; keep the v1-row check as "a v1 row proves v1 only"; hand-over wording adjusted.
- **Decision**: FIXED

### F2 — Hand-over claimed OSS-04 added all ExecutionAttempt fields and that they are nullable
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence (doc accuracy) · **Location**: OSS-04-H21.md DTO section
- **Fix**: only `deliveryAttempts` (optional) is new; the other fields were frozen in v1 and are now filled.
- **Decision**: FIXED

### F3 — EXEC step 3 advised reconciling `unknown` straight from `claim.changed === false`, which could block a live run
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality · **Location**: OSS-04-H21.md patch requests
- **Fix**: do not run on `changed:false`; reconcile only after the worker's own process check shows no live CLI; `workerRef` must survive restarts (else `409 attempt_active`).
- **Decision**: FIXED

### F4 — EXEC step 6 relied on a "list claimed attempts" query that does not exist
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Architecture · **Location**: OSS-04-H21.md patch requests
- **Fix**: EXEC keeps its own job ledger + `getAttempt`; an additive `listOpenAttempts` can be requested from OSS. No production change in this test/doc task (frozen contracts).
- **Decision**: FIXED (documented)

### F5 — Trusted reconcile path not exercised (ctx had a signed-in user)
- **Severity**: OBSERVATION · **Location**: executorFlow.test.ts scenario (c)
- **Fix**: reconcile now runs with a non-user principal and `issueTrustedExecution(WORKER_ACTOR_ID)`; asserts `reconciliation.actorUserId`.
- **Decision**: FIXED

### F6 — Replay after `delivered` claimed in the hand-over but not tested
- **Severity**: OBSERVATION · **Location**: executorFlow.test.ts main flow
- **Fix**: added a replay after delivered asserting `completionDelivery: 'delivered'`.
- **Decision**: FIXED

### F7 — Recovery-scan `[]` in scenario (c) is structural
- **Severity**: OBSERVATION · **Location**: executorFlow.test.ts scenario (c)
- **Detail**: `listPendingDeliveries` cannot list an attempt without a result by design; the executor count and `getAttempt` carry the proof.
- **Decision**: ACCEPTED (stated in hand-over limitations)

### F8 — Hand-over "every reserve answers 409" overbroad; detail-code list mixed/incomplete
- **Severity**: OBSERVATION · **Location**: OSS-04-H21.md
- **Fix**: same-key reserve replay answers 200 (documented); top-level vs detail codes split; codes verified with grep.
- **Decision**: FIXED
