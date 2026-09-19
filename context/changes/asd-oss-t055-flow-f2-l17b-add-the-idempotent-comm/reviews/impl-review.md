<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F2 L17b — idempotent comments.import

- **Plan**: context/changes/asd-oss-t055-flow-f2-l17b-add-the-idempotent-comm/plan.md · **Scope**: Phase 1 of 1 · **Date**: 2026-09-19
- **Verdict**: APPROVED (after F1 fix) · **Findings**: 0 critical, 1 warning, 3 observations
- Review run by me sequentially (the two reviewer sub-agents died on a usage limit); claims verified against MikroORM and shared-helper source.

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after F1) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

| ID | Severity | Finding | Decision |
|---|---|---|---|
| F1 | WARNING | `importThread` retried on ANY unique violation. The tested race aborts at the thread insert (before any staff write), but a violation raised at the final flush — after `createTask`/`createComment` ran — would be replayed and create a second card/comment. | FIXED: retry is gated on `progress.staffWritten`; new named test `does not retry a unique violation raised after a staff write…` (commands/comments.ts:469, comments.import.test.ts) |
| F2 | OBSERVATION | Verified the load-bearing adapter assumption in source, not just in the fake: `EntityManager.fork({keepTransactionContext:true})` copies `#transactionContext` (node_modules/@mikro-orm/core/EntityManager.js, the same call MikroORM makes internally at :113/:628) and `isInTransaction()` reads it, so staff's `withAtomicFlush(...,{transaction:true})` joins our thread transaction (packages/shared/src/lib/commands/flush.ts:167). The Proxy binds methods to the target, so private-field access keeps working. | ACCEPTED |
| F3 | OBSERVATION | A rolled-back thread can still leave a staff `ActionLog` row (the bus writes it outside our transaction) — audit noise only, no card. | ACCEPTED, in the hand-over |
| F4 | OBSERVATION | `statusId === null` throws per thread, so N identical log lines for an N-thread batch. Matches the required "all threads skipped, cursor unchanged" behaviour. | ACCEPTED |

Spec-rule → test map (all 11 rules of the "Comment import rules" block have a named test): identity/no-duplicate, title+description rules, truncation marker, reply→comment, edit→revision+update, delete keeps rows, per-thread transaction + continue, unique-violation recovery (+F1 guard), batch key/hash + cursor advance, version marker both ways, reopen/new-reply→triage new, no `status_changed` subscriber.
