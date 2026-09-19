# FLOW-F2 hand-over — staff Kanban link, design comment import, triage (OSS stream)

Stage F2 of the flow addendum (FLOW-03/04 domain side + FLOW-08 regression). Branch `dev-mateusz`.
No master-plan Progress row is ticked; acceptance stays with humans.

## Commits

| Layer | SHA | What |
|---|---|---|
| L16 (T053) | `52c64b13d` | entities `DeliveryStaffLink` / `DeliveryCommentThread` / `DeliveryCommentReply`, F2 migration + snapshot, encryption map (comment `author`/`body`), validators, pure rules `lib/commentImport.ts` |
| L17a (T054) | `e120b9dec` | commands `delivery_os.staff.link` (F10), `delivery_os.comments.triage` (F13); F8 reads real comment blockers |
| L17b (T055) | `f8eb5651d` | command `delivery_os.comments.import` (F11), DI seam `deliveryStaffKanbanAdapter` |
| L18a (T056) | `95ffda0e3` | routes F10–F13 with OpenAPI |
| L18b (T057) | this task (orchestrator commit) | `TC-DELIVERY-FLOW-03/04`, spec-kit F2 helpers/cleanup, cursor no-rewind guard in `storeSyncCursor` (+ unit test), OpenAPI 422 for `duplicate_stable_id`, this hand-over |

## Migration

`packages/core/src/modules/delivery_os/migrations/Migration20260919160535_delivery_os_flow_f2.ts` + `.snapshot-open-mercato.json`
(additive: `delivery_staff_links`, `delivery_comment_threads`, `delivery_comment_replies`). **Applied locally** on :5442
(`mikro_orm_migrations_delivery_os`, 2026-09-19 16:06 UTC, consent recorded). Not applied anywhere else.
Note: the shared local DB also carries `Migration20260919152308_delivery_os_flow_f4` from lane B; that file is not on this branch.

## Routes (unchanged since T056)

| ID | Route | ACL | Lock / idempotency |
|---|---|---|---|
| F10 | `GET/PUT /api/delivery_os/projects/:id/staff-link` | view / `delivery_os.flow.manage` | project lock on PUT; same staff id replays 200 without header |
| F11 | `POST …/projects/:id/comment-imports` | `delivery_os.comments.import` | `Idempotency-Key` required; no lock header; never bumps project `updatedAt` |
| F12 | `GET …/projects/:id/comment-threads?stageId&status&triage&page&pageSize` | view | — |
| F13 | `POST …/comment-threads/:threadId/triage` | `delivery_os.comments.import` | **thread** lock (`updatedAt` from F12) |

## Normalized payload for Adam — `delivery.comment-import/v1` (confirmed on the real DB)

Body = `commentImportBatchV1Schema` (`lib/contracts.ts`), fixture `lib/fixtures/flow/comment-import.v1.json`, one Figma
file page per request (≤ 200 threads, ≤ 500 replies each, body ≤ 1 MB). `artifactId` is `null` or an artifact of the
batch stage in this project.

Result (`commentImportResultSchema`), proven by TC-DELIVERY-FLOW-03:

- **201 created** — thread outcomes: `created` (new card: title = thread body, description starts `Source: <sourceUrl>`,
  then author, date, stage, artifact + `version confirmed|unconfirmed`, Figma version, body), `updated` (source text,
  status or version binding changed → card text rewritten; unchanged text skips the staff write), `unchanged`,
  `skipped` (stage mismatch or failed thread). Reply outcomes: `created` (new card comment), `updated` (edited reply →
  new reply revision row, same staff comment updated in place), `unchanged`.
- **`versionConfirmed`** is true only when `figmaVersion` is carried by a `figmaRefs` entry (`fileKey` + `figmaVersion`)
  of an artifact of that stage; `figmaVersion: null` or an unknown version → false, bound to `batch.artifactId` (may be null).
  Never auto-bound to the latest approved artifact.
- **200 `replayed: true`** — same key + same batch: nothing written, all counts 0, outcomes `unchanged`.
- **Cursor** — the stored per-file cursor becomes `cursor.next` only when every thread succeeded; the next page must send
  `cursor.after` = stored cursor.
- **Errors**: 400 `idempotency_key_required` / `validation_failed`; 404 project (also for any
  other organisation); 409 `idempotency_conflict` (same key, other batch), 409 `sync_cursor_conflict` (detail message =
  expected cursor); 413; 422 `unsupported_schema_version`, `duplicate_stable_id` (repeated `threadKey`/`commentKey`), `staff_link_required` (no link, or staff module absent:
  detail `staff_module_unavailable`), `flow_not_pinned`, `stage_unknown`, `foreign_reference`.
- **No default status** (linked staff project without any task column): 201, every thread counted in `counts.skipped`
  (new threads are not listed — they have no card), cursor NOT advanced, `staff-link.syncCursors[fileKey].lastError` set;
  the same key retries after the board is repaired.
- **Parallel imports of the same page** with different keys: one card per thread key in every case (DB unique +
  row locks). Both may pass the cursor pre-check; threads then interleave under the project lock, so `created`
  outcomes can be split between two 201 responses, or the later one answers 409 `sync_cursor_conflict`. The first
  delivery to finish stores its `lastBatchKey` and cursor; a later one never rewinds it (T057 fix in `storeSyncCursor`),
  so a retry of the other key answers 409 `sync_cursor_conflict` — continue from the stored cursor.

## Kanban adapter seam

DI key `deliveryStaffKanbanAdapter` (`commands/staffKanbanAdapter.ts`): `resolveDefaultStatusId`, `createTask`,
`updateTask`, `createComment`, `updateComment`, optional `settle(session, committed)`. The OSS default runs the public
staff commands `staff.timesheets.tasks.create/update` and `staff.timesheets.task_comments.create/update` inside the
thread transaction; now **proven live** by FLOW-03/04 (real cards and comments visible through `/api/staff/timesheets/tasks`
and `/tasks/:id/comments`). Tests and other hosts may register their own implementation.

## Verification (local runner, capped, one command at a time)

| Command | Result |
|---|---|
| `BASE_URL=http://localhost:3100 npx playwright test --config .ai/qa/tests/playwright.config.ts …/TC-DELIVERY-FLOW-0[34]-*.spec.ts --retries=0 --workers=1` | 4/4 passed (FLOW-03 ×2, FLOW-04 ×2), before and after the review fix |
| before/after counts (delivery comment/link/project/artifact/decision/task, staff projects/statuses/tasks/comments, users, orgs, action_logs) | identical (`/tmp/t057-before.txt` vs `/tmp/t057-after.txt`) |
| `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` | 98 suites / 1829 tests passed (rerun after the review fix) |
| `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` + `tsc -p` scoped to `__integration__/*.ts` | exit 0 / exit 0 |
| OSS-only: `OM_ENABLE_ENTERPRISE_MODULES{,_SSO,_SECURITY,_AGENTS}=false yarn generate`, then normal `yarn generate` | exit 0; `delivery_os` and `staff` enabled, `record_locks`/`sso`/`security`/`agent_orchestrator` absent; no `@open-mercato/enterprise` import in `delivery_os` sources |
| `…/TC-DELIVERY-OSS-001.spec.ts` (FLOW-08 v1 regression) | 4/4 passed |
| `git status packages/core/src/modules/staff` | no change |

What the specs prove:

- **FLOW-03**: one staff card per thread and one card comment per reply through the staff API; source link in the card;
  replay 200 with zero counts; 409 `idempotency_conflict` and `sync_cursor_conflict` write nothing; two concurrent imports
  of page 2 → 2 cards total, edited reply updated in place, new reply added, thread without `figmaVersion` →
  `versionConfirmed: false`; the import never bumps the project version; unlinked project → 422 `staff_link_required`;
  a sibling organisation gets 404 on F10 GET/PUT, F11, F12 and F13 without leaking the id.
- **FLOW-04**: an open unconfirmed thread blocks UX approval (422 `blocking_comments_open`); `triaged` + linked delivery
  task still blocks; moving the staff card to the Done column changes nothing in delivery (flow currencies, pending
  approvals, thread triage) and the delivery task stays `draft`; stale thread lock → 409 `optimistic_lock_conflict`,
  missing → 428; deferral with a wrong hash → 422 `hash_mismatch`; deferral bound to the UX v1 hash → approval 201;
  UX v2 → blocked again; a staff project of another organisation or an unknown id → 404 on F10; own board links and replays.

Master-plan rows with new evidence: FLOW-03 (domain side, deterministic batch — live Figma still open), FLOW-04, FLOW-08.

## Limitations

- Live Figma comment access is not exercised (Adam's provider + probe); fixtures never count as live FLOW-03.
- Comment author/body are encrypted on delivery rows but copied as plaintext into staff card/comment text (spec-mandated;
  staff has no encryption map for tasks). The local tenant has encryption off, so encrypted-at-rest is unverifiable here.
- Staff lets only the comment author or a `staff.timesheets.manage_all` holder edit a card comment: an edited reply
  imported by another user without that grant fails the thread (`lastError`, cursor kept).
- A rolled-back thread can leave a staff audit (`action_logs`) row.
- Only threads with `artifactId: null` (an unconfirmed thread from a batch without `artifactId`) block every version of
  the stage; a thread bound to an older artifact, confirmed or not, stops blocking newer versions. Providers should send
  `artifactId` only when they know the design version the comments were made on.
- OM → Figma write-back is out of scope.
- `yarn db:migrate` under turbo ignores a `DATABASE_URL` override.

## Patch requests for other owners

- **UI (Adam):** i18n keys `delivery_os.audit.staff.link`, `delivery_os.audit.comments.triage`,
  `delivery_os.audit.comments.import`; show `syncCursors[fileKey].lastError` and `counts.skipped` after a sync; the
  triage form must send the thread's `updatedAt` as the lock header.
- **Adam (Figma provider):** send one page per request with a stable `Idempotency-Key` per page (e.g. `<fileKey>:<cursor.after>`),
  retry the same key after a 5xx or partial failure, continue from `staff-link.syncCursors[fileKey].cursor` after a 409
  `sync_cursor_conflict`; put the Figma file version into F7 artifacts' `figmaRefs` so threads get `versionConfirmed`.
- **QA (Michał):** the live FLOW-03 run needs a Figma file with comment read access; the rest of FLOW-03/04 is covered by
  the two specs above.

## Estimate vs actual

F1 hand-over estimated F2 at ≈ 8 h. Actual: five layers T053–T057, ≈ 2 h 30 min of agent wall-clock (17:53 → 19:50 CEST
on 2026-09-19) plus review. Remaining: F3 (report `flow` section, DI seams) ≈ 4 h; F4 (publications, final gate) ≈ 4 h.
Blockers unchanged: Figma comment access (Adam), Marcin's template provider, publication target (Michał).
