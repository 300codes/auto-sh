# FLOW running hand-over (internal layers)

Stand-alone notes per stage live in `FLOW-F0-contracts.md`, `FLOW-F1-L13a-commands.md`, `FLOW-F1-L13b-stages.md`; this file collects the layers that change no cross-stream contract.

## T046 — FLOW-F1 L13c gate call sites (2026-09-19)

- Exists now: `commands/flowGate.ts` — `checkProjectFlowGateV1(em, project, scope)` (v1 `422 baseline_not_approved` + per-stage `details[]`), `loadFlowGateStates` (for the future publications command / DI read service), shared row loaders reused by `stages.ts`. Call sites: `tasks.ts#checkReadyGate` (reached by task update and attempt reconcile), `attempts.ts` reserve (both modes, before the register write), `decisions.ts` deploy `approved`.
- Gate key: `flowTemplateId` non-null only (`grep -n flowTemplateId packages/core/src/modules/delivery_os/commands/*.ts`); unpinned projects issue no stage query. Unreadable snapshot fails closed. Required stages are the four `FLOW_APPROVAL_STAGE_ORDER` stages, the same list F6 `flowStatus.ts#gateFrom` uses (the template schema requires exactly one stage of each kind).
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 83 suites / 1627 tests green (local runner); new `flowGate.test.ts` (8) and `flowRegression.test.ts` (7).
- Route-level evidence for UA-48 (R10/R12/R14/R20 answering the gated body) is L14's route tests + L15 `TC-DELIVERY-FLOW-02`; no route or registry changed here, dev server untouched.

## T051 — FLOW-F1 L15a integration specs FLOW-01/02/09 (2026-09-19)

- Exists now: `__integration__/TC-DELIVERY-FLOW-01-intake.spec.ts`, `TC-DELIVERY-FLOW-02-stage-approvals.spec.ts`, `TC-DELIVERY-FLOW-09-upstream-change.spec.ts` + shared non-spec helper `__integration__/flowSpecKit.ts` (wordpress-theme@1 seed with snapshot revisions, `templates/**` paths; SQL teardown by project id incl. the three F1 tables, indexes/tokens, action logs, sibling-org users). Each spec: failure paths assert status + code, sibling-org 404 on every F1 route, `afterAll` asserts nothing left.
- FLOW-02 proves the addendum bypass risk directly: a legacy v1 project (verified task A, ready task B, draft task C) is pinned in flight; with UX pending, R12 ready / R14 reserve / R20 deploy consent all answer the frozen `422 baseline_not_approved` with `stages.ux stage_not_approved`; after four approvals all three succeed. Note: after a reserve, `gates.dispatchable` is closed by `attempt_active` alone (by design).
- FLOW-09: while scope v2 is pending, dependants report `upstream_not_approved`; `upstream_stale` appears only once scope v2 is approved and UX is still bound to v1. Cancel (`cancel_requested`) still blocks a new artifact version; reconcile `stopped` releases it.
- Runner (local dev stack :3100/:5442): `BASE_URL=http://localhost:3100 npx playwright test --config .ai/qa/tests/playwright.config.ts packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-0<N>-*.spec.ts --retries=0` → 2/2, 2/2, 2/2 passed (≈3 min each, ~130 s of that is spec discovery); `/tmp/t050-counts.sh` identical before/after; `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 88 suites / 1689 tests green.

## T053 — FLOW-F2 L16 data layer and comment-import rules (2026-09-19)

- Exists now: entities `DeliveryStaffLink` / `DeliveryCommentThread` / `DeliveryCommentReply` (`data/entities.ts`, FK ids only, no staff import), migration `migrations/Migration20260919160535_delivery_os_flow_f2.ts` + snapshot (three tables, six spec uniques/indexes plus two lookup indexes; reviewed via the pg catalog on :5442 and applied there — the `DATABASE_URL` override is ignored by `yarn db:migrate` under turbo, so the shared local DB was migrated directly under the recorded consent), encryption map entries for comment `author`/`body`, validators `staffLinkCommandSchema` / `commentImportCommandSchema` / `commentThreadListQuerySchema` / `commentThreadTriageCommandSchema` (`data/validators.ts`), contracts `commentThreadListItemSchema` / `commentThreadListResponseSchema` / `StaffSyncCursor` (+ `lastBatchKey`, `lastBatchHash`), pure rules `lib/commentImport.ts` (see its exports; L17 wires them into one transaction per thread with the staff public commands).
- A14: batch key/hash live in `delivery_staff_links.sync_cursors[fileKey]`; a batch with a failed thread write clears them so a retry is a fresh import (spec changelog T053).
- L17 seam: pass `failedThreadKeys` (threads whose transaction threw) to `advanceSyncCursor`, `summarizeCommentImport` and `buildCommentImportResult`; a `stage_mismatch` skip advances the cursor and is named in `lastError`. When triage resets to `new`, the command must also null `deferral`. Replay is detected only against the last batch key of the same file.
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` (module suite) — new `data/__tests__/commentValidators.test.ts`, parametrized `flowMigration.test.ts` (F1 + F2), extended `encryption.test.ts`, `lib/__tests__/commentImport.test.ts`.
- Next: L17 commands F10/F11/F13 (`delivery_os.staff.link`, `delivery_os.comments.import`, `delivery_os.comments.triage`) replacing the `loadStageCommentThreads` / `recordThreadDeferrals` seams; L18 routes + `TC-DELIVERY-FLOW-03/04`.

## T054 — FLOW-F2 L17a staff.link, comments.triage, real F8 thread seams (2026-09-19)

- Exists now: `commands/staffLink.ts` (`delivery_os.staff.link`; exports `loadStaffLink`, `toStaffLink`, `DELIVERY_STAFF_LINK_RESOURCE_KIND` for L17b/L18), `commands/comments.ts` (`delivery_os.comments.triage`, `DELIVERY_COMMENT_THREAD_RESOURCE_KIND`), `commands/stages.ts` `loadStageCommentThreads(em, projectId, stageId, scope, lock?)` + `recordThreadDeferrals(lockedThreadRows, deferrals, { stageId, actor, now })` on real rows; flow status (`flowQueries.ts`) therefore reports real comment blockers.
- Staff coupling: DI key `timeTrackingAccessResolver` + feature id `staff.timesheets.projects.manage` (shared `hasFeature`) + query-engine entity id `staff:staff_time_project` for the manager existence probe — no staff import. Resolver absent → `422 staff_link_required`.
- L17b (import) must take the project row lock before thread row locks (same order as F8 and triage) and null `deferral` when triage resets to `new`.
- Test kits: `baselineTestKit` and `routeTestKit` stores gained `staffLinks` / `commentThreads` / `commentReplies`; `matches` understands `$ne`. The known-commands list in `scopeChange.test.ts` lists the two new ids (append-only subjects unchanged).
- Patch request (UI owner): i18n keys `delivery_os.audit.staff.link`, `delivery_os.audit.comments.triage` (English fallbacks in code).
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 92 suites / 1756 tests green; core typecheck green; eslint on touched files clean.
- Open for L17b/L18 (impl-review #4/#5/#6/#8): thread-specific wording of the 428 lock-header error, deferral to an older artifact version is accepted (never unblocks F8), import must `lockScopedProject` before creating cards (re-link guard relies on it), live smoke of the manager probe (`queryEngine` on `staff:staff_time_project`) once the F10 route exists.

## T055 — FLOW-F2 L17b: `delivery_os.comments.import` + DI seam `deliveryStaffKanbanAdapter`

- Exists now: `commands/comments.ts` (`delivery_os.comments.import`, result = `commentImportResultSchema`), `commands/staffKanbanAdapter.ts` (seam + command-bus default), `di.ts` registers `deliveryStaffKanbanAdapter`. L18 route only needs to pass `{ projectId, idempotencyKey, batch }`.
- For Adam (provider): call F11 with the frozen `delivery.comment-import/v1` batch; the provider never writes domain tables. A fake adapter for tests = an object with the five methods (see `commands/__tests__/comments.import.test.ts#makeAdapter`).
- Limits: the default adapter is unit-tested only (fake bus/em) — first live run comes with the L18 route / TC-DELIVERY-FLOW-03; a rolled-back thread can leave a staff action-log row (audit only); staff allows a comment edit only to its author or `staff.timesheets.manage_all`, so an edit imported by another user without that grant fails the thread (visible in `lastError`, cursor kept); author/body are plaintext on the staff card (spec-mandated).
- Retry semantics (impl-review F1): the unique-violation retry is gated on "no staff write happened yet" (`ThreadProgress.staffWritten`), so a
  violation raised after `createTask`/`createComment` fails the thread instead of creating a second card. Verified in source that
  `fork({keepTransactionContext:true})` + `isInTransaction()` make staff's `withAtomicFlush` join our thread transaction.
- Patch request (UI owner): i18n key `delivery_os.audit.comments.import`.
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 94 suites green; core typecheck + scoped test tsconfig (`/tmp/t055/tsconfig.json`) green; eslint on touched files clean.
