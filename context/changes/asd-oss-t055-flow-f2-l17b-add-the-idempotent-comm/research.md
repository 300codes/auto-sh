---
topic: How can delivery_os write staff Kanban cards atomically through staff's public commands?
researcher: claude
date: 2026-09-19
---
# Research (T055)

- Pure rules already exist in `lib/commentImport.ts` (check → plan → cursor → counts → result). The command only orchestrates.
- Staff commands (`staff/commands/timesheets-tasks.ts:475`, `timesheets-task-comments.ts:244,353`) take `ctx.container.resolve('em').fork()`
  and open their own `withAtomicFlush({transaction:true})`. They ignore `ctx.transactionalEm`. A plain fork leaves the caller's transaction.
- MikroORM supports `em.fork({ keepTransactionContext: true })`; a nested `transactional` then becomes a savepoint on the same connection.
  So the adapter can hand staff a ctx whose container answers `em` with an object whose `fork()` keeps the thread transaction.
- Staff side effects are only queued (`emitCrudSideEffects` → `dataEngine.markOrmEntityChange`) and drained by the command bus
  (`flushOrmEntityChanges`). Drained inside our open transaction the indexer would not see the rows, so the adapter buffers the marks
  and replays them after commit (dropped on rollback).
- Staff comment update checks the optimistic-lock header of `ctx.request` and "author or manage_all". The adapter passes no `request`;
  a 403 for a non-author without manage_all becomes a per-thread `skipped`.
- Staff task create picks the default status itself, but the task requires "no default status → all threads skipped", so the adapter
  reads `staff_time_task_statuses` once (scoped, `is_default desc, position asc`).
- Validation `commentImportCommandSchema` already gives 422 foreign_reference (projectId) and duplicate_stable_id (thread/comment keys).
