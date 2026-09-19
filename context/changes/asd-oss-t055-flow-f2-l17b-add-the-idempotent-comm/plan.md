# FLOW-F2 L17b — idempotent `delivery_os.comments.import` Implementation Plan

## Overview

Add the F11 domain command that imports a normalized `delivery.comment-import/v1` batch: one Figma thread → one staff card, each
reply → one staff comment, idempotent under retry and parallel runs. Staff is reached only through a delivery-owned DI adapter that
calls staff's public commands.

## Current State Analysis

- `lib/commentImport.ts` holds every pure rule (batch check, version binding, thread/reply planning, cursor, counts, result).
- `commands/comments.ts` has only `comments.triage`. `commands/staffLink.ts` exports `loadStaffLink`. `events.ts` already declares
  `delivery_os.comment_thread.imported`. `data/validators.ts` has `commentImportCommandSchema` (foreign projectId, duplicate keys).
- Staff commands fork `container.resolve('em')` and open their own transaction; they ignore `transactionalEm` (see `research.md`).

## Desired End State

`delivery_os.comments.import` is registered, follows the check order of the task, writes per-thread transactions, advances the file
cursor only when every thread succeeded, and answers `commentImportResultSchema`. `deliveryStaffKanbanAdapter` is registered in `di.ts`.
Verified by `commands/__tests__/comments.import.test.ts` plus the module suite and the core typecheck.

### Key Discoveries

- Sharing the thread transaction with staff needs a ctx whose container answers `em` with a fork that keeps the transaction context
  (`em.fork({ keepTransactionContext: true })`); staff's nested `transactional` then runs as a savepoint.
- Staff side effects are queued on `dataEngine`; the adapter buffers them and replays them after commit, so the indexer never reads
  uncommitted rows and a rollback leaves no phantom event.
- The bus `prepare` step of staff update commands reads `container.resolve('em')` without forking, so the ctx answers `em` with a real
  transaction-keeping fork wrapped in a Proxy that only overrides `fork` (plan-review F1).
- `withAtomicFlush` joins an ambient transaction (no savepoint): a staff task-reference race aborts the thread transaction, so the
  command retries a thread once, in a fresh transaction, on any unique violation (plan-review F2).
- The adapter passes no `request` to staff, so the caller's headers never act as a staff optimistic-lock token.

## What We're NOT Doing

- No route (F11 HTTP is L18), no OpenAPI, no integration spec (TC-DELIVERY-FLOW-03 ships with the route).
- No change to staff files, no staff entity import, no new migration, no new event id (the event exists; only its emission is new).
- No OM → Figma write-back, no worker.

## Implementation Approach

Decisions (self-answered planning questions):
1. **Adapter session** — every adapter call gets `{ ctx, tx, scope }`; optional `settle(session, committed)` replays or drops buffered
   side effects. Fake adapters in tests ignore the session.
2. **Order of checks** — idempotency key (400) → schema (422 foreign_reference / duplicate_stable_id) → project 404 → staff link 422 →
   pinned stage 422 → artifactId of this project and stage (422 foreign_reference) → replay/conflict → cursor conflict → adapter missing 422
   `staff_link_required`/`staff_module_unavailable`.
3. **Replay** — rebuilt from fresh plans against stored rows with `replayed: true`; no writes, no events.
4. **Per thread** — new forked em, `transactional`: project row lock → link re-read (staff project unchanged) → thread insert-or-lock →
   plan → staff task create/update → replies → flush. A unique violation retries the thread once in a fresh transaction (the winner's
   row is then locked and planned as unchanged/updated). Any other error → thread key marked failed, logged + `reportError`, next thread.
5. **Staff task update** only when the rendered title/description differs from the stored thread's rendering.
6. **Triage reset** to `new` also nulls `deferral` (T053/T054 note).
7. **Cursor** — one final transaction under the project lock writes `advanceSyncCursor(...)` into `syncCursors[fileKey]`; the project
   `updatedAt` is not bumped (an import must not invalidate open project forms).
8. **Events** — `delivery_os.comment_thread.imported` for `created`/`updated` threads only, ids only, after commit.
9. **No default status** — every thread is reported failed (`skipped` count), cursor kept, `lastError` set by the lib.
10. **Failure reason** — the frozen result has no reason field; the reason goes to the log/telemetry and `lastError` names the keys.

## Phase 1: Adapter seam and import command

### Changes Required

#### 1. `commands/staffKanbanAdapter.ts` (new)
**Intent**: delivery-owned seam + default implementation over the staff public commands.
**Contract**: `DELIVERY_STAFF_KANBAN_ADAPTER_KEY = 'deliveryStaffKanbanAdapter'`; `DeliveryStaffKanbanAdapter { resolveDefaultStatusId,
createTask, updateTask, createComment, updateComment, settle? }`; `createCommandBusStaffKanbanAdapter()`. Command ids as string
constants; status read = one scoped SQL select on `staff_time_task_statuses`. No import from `../../staff`.

#### 2. `di.ts`
**Intent**: register the default adapter under the key (additive DI key).

#### 3. `commands/comments.ts`
**Intent**: add `delivery_os.comments.import` per the approach above; export `CommentImportCommandResult`.
**Contract**: input `commentImportCommandSchema`; result `CommentImportResult`; `buildLog` returns null for replay, else an audit entry
(`delivery_os.audit.comments.import`, English fallback) on the staff-link resource with counts only (no author/body).

#### 4. Tests `commands/__tests__/comments.import.test.ts`, `scopeChange.test.ts` (command id list), DI registration test
**Intent**: one named test per rule of the spec block + the failure paths of the task; subscriber-absence test for
`staff.timesheets.time_task.status_changed`.

#### 5. Spec + hand-over
**Intent**: spec changelog line for the additive DI key; 3–6 lines in `handover/FLOW-progress.md`.

### Success Criteria

#### Automated Verification
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green
- eslint on the touched files clean
- grep: no `modules/staff` / `../../staff` import under `delivery_os` (tests excluded); staff reached via command ids, DI key, table name

#### Manual Verification
- Live import against the running app creates a card on the linked staff board (possible once the L18 route exists)

## Testing Strategy

Unit tests with a fake adapter and the kit store; the em mock gets entity-aware `create/persist` and a `transactional` that restores
the thread/reply store on throw (rollback). Default adapter tested with a fake command bus + fake em (ctx proxy, buffered side effects,
SQL parameters).

## References

- Spec block "Comment import rules": `.ai/specs/2026-09-18-delivery-os-hackathon.md:529`
- Research: `context/changes/asd-oss-t055-flow-f2-l17b-add-the-idempotent-comm/research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Adapter seam and import command

#### Automated

- [x] 1.1 delivery_os jest suite green
- [x] 1.2 core typecheck green
- [x] 1.3 eslint on touched files clean
- [x] 1.4 grep confirms no staff import in delivery_os

#### Manual

- [ ] 1.5 Live import creates a card on the linked staff board (after L18 route)
