# FLOW-F2 L17b — Plan Brief
> Full plan: `plan.md` · Research: `research.md`
- What: `delivery_os.comments.import` — Figma thread → one staff card, reply → one comment, idempotent under retry/parallel runs.
- How: pure rules from `lib/commentImport.ts`; per-thread transaction; staff reached through DI seam `deliveryStaffKanbanAdapter`.
- Key decision: the default adapter shares the thread transaction with staff's public commands (em fork keeps the transaction
  context) and replays staff side effects only after commit.
- Cursor + batch key stored only when every thread succeeded; replay answers from stored rows with `replayed: true`.
- Out of scope: route/OpenAPI/integration spec (L18), staff changes, migrations.
- Risk: the shared-transaction adapter is unit-tested only until the L18 route allows a live run.
