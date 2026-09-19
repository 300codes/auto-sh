<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F2 L17b — idempotent comments.import

- **Plan**: context/changes/asd-oss-t055-flow-f2-l17b-add-the-idempotent-comm/plan.md
- **Mode**: Deep (claims verified by the author against staff commands, command bus and `withAtomicFlush`) · **Date**: 2026-09-19
- **Verdict**: SOUND after fixes · **Findings**: 0 critical, 2 warnings, 1 observation
- Grounding: 5/5 paths ✓, symbols ✓ (`loadStaffLink`, `requirePinnedTemplateStage`, `checkCommentImportBatch`), brief↔plan ✓

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

| ID | Severity | Finding | Decision |
|---|---|---|---|
| F1 | WARNING | The command bus `prepare` of staff update commands uses `container.resolve('em')` directly (no fork), so a `{ fork }` stub breaks snapshots. The ctx must answer `em` with a real EntityManager (transaction-keeping fork) wrapped in a Proxy that only overrides `fork`. | FIXED in plan |
| F2 | WARNING | `withAtomicFlush` joins an ambient transaction (no savepoint), so staff's task-reference retry cannot recover inside our transaction: a reference race aborts the thread transaction. Treat as thread failure; retry the thread once on a unique violation in a fresh transaction. | FIXED in plan |
| F3 | OBSERVATION | The staff command's action-log row is written by the bus outside our transaction; a rolled-back thread can leave an audit entry for a card that does not exist. | ACCEPTED (audit only; hand-over note) |
