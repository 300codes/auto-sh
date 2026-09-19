# FLOW-F2 L16 — staff link, comment entities, F2 migration, encryption map, pure comment-import rules

## Overview

Persist the Figma → staff Kanban linkage (F10–F13 of the frozen F0 contract) and encode the import rules D8–D10 as
pure functions, so L17 (commands) and L18 (routes) only wire transactions and staff public commands around them.

## Current State Analysis

- Contract schemas exist (`lib/contracts.ts` L1619–1740); no entity, migration, validator or rule module for them.
- `lib/stageDecisions.ts#CommentThreadRecord` is the thread view F8 already consumes (seams `loadStageCommentThreads` in
  `commands/stages.ts` answer no threads until L17).
- `staffSyncCursorSchema` has `cursor | lastSyncAt | lastError`; A14 needs `lastBatchKey | lastBatchHash` there.
- Migration/test patterns: F1 entities, `flowMigration.test.ts`, `encryption.test.ts` (see `research.md`).

## Desired End State

Three new entities + `Migration<ts>_delivery_os_flow_f2.ts` (only `delivery_*` DDL, six unique/index definitions) applied on
:5442; encryption map covers thread/reply `author`, `body`; validators for F10–F13; `lib/commentImport.ts` with tests
that replay the fixture batch and a create → reply → edit → delete → reopen sequence. `grep -rn 'modules/staff'
packages/core/src/modules/delivery_os` stays empty.

## Decisions (autonomous, answered from spec/breakdown)

| # | Question | Choice |
|---|---|---|
| D1 | Batch key storage (A14) | `delivery_staff_links.sync_cursors[fileKey] = {cursor, lastBatchKey, lastBatchHash, lastSyncAt, lastError}`; `staffSyncCursorSchema` gains the two fields as nullable with default `null` (additive; fixture still parses). Recorded in spec changelog. |
| D2 | Cursor rule (spec changelog states the partial-batch rule explicitly) | `cursor.after` must equal stored `cursor` (`null` when no entry). Replay (same `lastBatchKey` + same hash) wins over the cursor check; same key + other hash → `idempotency_conflict`; otherwise mismatch → `sync_cursor_conflict`. Cursor advances to `cursor.next` and the batch key/hash are stored only when no thread write failed (`failedThreadKeys` from the command; revised in impl review — a deterministic `stage_mismatch` skip advances and is named in `lastError`, otherwise the file would be blocked forever); a failed batch keeps the cursor, stores `lastBatchKey/Hash = null` (so a retry is not answered as a replay) and sets `lastError`. |
| D3 | Version binding | Input `artifacts: { id, stageId, version, figmaRefs }[]` (the command maps design-stage `content.figmaRefs`; non-design stages have none). `figmaVersion` present and an artifact of the batch stage carries `{fileKey, figmaVersion}` → bind to the highest `version` among matches, `versionConfirmed: true`; otherwise `artifactId` as sent, `versionConfirmed: false`. Never the latest approved artifact. |
| D4 | Reply revisions | Latest revision per `commentKey`; new revision when `body`, `editedAt` or `deleted` differ (`deleted` → row kept with `deleted: true`); otherwise unchanged. New reply → revision 1. |
| D5 | Triage reset | `created` → `new`; reopen (`sourceStatus ≠ open` → `open`) or any newly created reply → `new`; otherwise triage preserved. Source `resolved`/`deleted` never changes triage (staff/Figma status is not authority). |
| D6 | Thread `skipped` in the pure layer | Only when the stored thread belongs to another stage than the batch (never silently move a card); the command adds `skipped` for a failed per-thread transaction. |
| D7 | Staff rendering | Title = first non-empty body line ≤ 255; description = `Source/Author/Date/Stage/Artifact` header + blank + body ≤ 8000; comment body = `author · date` + body (`[deleted at source]` prefix when deleted) ≤ 5000. Overlength text is cut so that text + marker `… [truncated]` fits the limit; the full text stays on the delivery row. Rendered strings are trimmed and never empty (fallback `(no text)`) because the staff validators `.trim().min(1)`. |
| D8 | Stored types | `lib/contracts.ts` gains `commentThreadListItemSchema` / `commentThreadListResponseSchema` (F12 shape, spec L502) now; `lib/commentImport.ts` exports `StoredCommentThread` (= list item, assignable to `CommentThreadRecord`) and `StoredCommentReply`, so L17 maps rows once for F8, F11 and F12. |
| D9 | Validators | `staffLinkCommandSchema` (projectId + `staffLinkRequestSchema`), `commentImportCommandSchema` (projectId, idempotencyKey, batch; `foreign_reference` when `batch.projectId ≠ projectId`), `commentThreadListQuerySchema` (`stageId?`, `status?`, `triage?`, page, pageSize ≤ 100), `commentThreadTriageCommandSchema` (projectId, threadId, triage). |
| D10 | Work split | Piece B (`lib/commentImport.ts` + test) by one subagent with this design; Piece A (entities, contracts, encryption, validators, migration, tests, spec) by me — registries stay single-editor. |

## What We're NOT Doing

Commands F10–F13, routes, staff command calls, transactions, `TC-DELIVERY-FLOW-03/04`, UI/i18n, publications (lane B).

## Phase 1: Data layer (Piece A)

1. `lib/contracts.ts` — `staffSyncCursorSchema` + `lastBatchKey`, `lastBatchHash` (nullable, default null); `commentThreadReplyItemSchema`, `commentThreadListItemSchema`, `commentThreadListResponseSchema` (F12). Fixture `staff-link.v1.json` gains the two fields (`lastBatchHash` = `hashCanonical` of the comment-import fixture, `lastBatchKey` = the key the test uses).
2. `data/entities.ts` — `DeliveryStaffLink`, `DeliveryCommentThread`, `DeliveryCommentReply` with the spec columns, uniques
   `delivery_staff_links_scope_project_uq`, `delivery_staff_links_scope_staff_project_uq`,
   `delivery_comment_threads_scope_file_thread_uq`, `delivery_comment_replies_scope_thread_comment_revision_uq`, index
   `delivery_comment_threads_scope_staff_task_idx` (+ `delivery_comment_replies_scope_thread_idx` for the reply loader).
3. `encryption.ts` — two entries (`author`, `body`).
4. `data/validators.ts` — D9 schemas.
5. `yarn db:generate` → keep only the delivery_os migration (renamed `_delivery_os_flow_f2`) + snapshot; review on
   `open_mercato_ossreview`; apply on the local DB.
6. Tests: parametrize `data/__tests__/flowMigration.test.ts` over F1 and F2 files (generic delivery_*/additive checks shared, F2 uniques/index asserted), extend `encryption.test.ts`, `data/__tests__/commentValidators.test.ts`.

## Phase 2: Pure rules (Piece B)

`lib/commentImport.ts`: `hashCommentImportBatch`, `checkCommentImportBatch` (replay / idempotency_conflict /
sync_cursor_conflict / proceed), `bindThreadVersion`, `planCommentThread`, `planCommentImport`, `renderStaffTask`,
`renderStaffComment`, `truncateForStaff`, `advanceSyncCursor`, `summarizeCommentImport`, `buildCommentImportResult`.
Tests `lib/__tests__/commentImport.test.ts`: start from a link with no `FIGFILE0001` cursor (the staff-link fixture is the post-import state — replaying the batch against it must answer `sync_cursor_conflict`), plan the fixture batch, assert counts/outcomes equal the result fixture and `advanceSyncCursor` equals the fixture cursor entry; plus the fake sequence create → reply → edit → delete → reopen, whitespace-only body, and the negative fixtures.

## Phase 3: Verification and docs

Module jest (`--maxWorkers=2`), core typecheck (`--concurrency=2`), staff-import grep, spec changelog (A14), FLOW-progress note.

## References

- `.ai/specs/2026-09-18-delivery-os-hackathon.md` L461–463, L500–503, L521–541
- `research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data layer (Piece A)

#### Automated

- [x] 1.1 Contract cursor fields, entities, encryption map, validators added
- [x] 1.2 F2 migration generated, reduced to delivery_* DDL, reviewed on a throw-away DB and applied locally
- [x] 1.3 Data tests green (migration, encryption, validators)

### Phase 2: Pure rules (Piece B)

#### Automated

- [x] 2.1 lib/commentImport.ts implemented
- [x] 2.2 commentImport.test.ts green (fixtures + fake sequence)

### Phase 3: Verification and docs

#### Automated

- [x] 3.1 Module jest suite and core typecheck green; no modules/staff import
- [x] 3.2 Spec changelog (A14) and FLOW-progress note written
