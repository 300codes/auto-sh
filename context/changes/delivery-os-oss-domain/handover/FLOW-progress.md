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

## T056 — FLOW-F2 L18a: the four F10–F13 routes

- Exists now: `api/projects/[id]/staff-link/route.ts` (GET/PUT), `.../comment-imports/route.ts` (POST),
  `.../comment-threads/route.ts` (GET), `.../comment-threads/[threadId]/triage/route.ts` (POST); serializers
  `serializeStaffLink` (re-export of the command's `toStaffLink`) + `serializeCommentThread`; route schema
  `commentThreadTriageResponseSchema`. All four paths are in `apps/mercato/.mercato/generated/openapi.generated.json`.
- For Adam: `PUT staff-link` answers exactly `staffLinkSchema` (no `unchanged` flag; a same-id replay is 200 and needs no
  version header); `GET staff-link` is 404 while unlinked; `POST comment-imports` needs `Idempotency-Key`, caps the body
  at 1 MB and answers 201 new / 200 replayed; `GET comment-threads?stageId=&status=&triage=&page=&pageSize=` is newest
  `updatedAt` first with the replies inline; triage takes the **thread** `updatedAt` as the lock header.
- Test kit: `api/__tests__/commentRouteKit.ts` (`prepareLinkedProject`, `registerStaffProjects`, `registerFakeKanban`,
  `batchFixture`, `postCommentImport`, `listCommentThreads`, `postTriage`); `routeTestKit` gained the
  `staffAccess` / `kanbanAdapter` slots and orders the two comment entities. Helper names must not start with `use`
  (react-hooks lint).
- Live proof on :3100 (`/tmp/t056-smoke.sh`, project `1f143b7d…`): link 428→200→200 replay, GET link 200, import 400 (no
  key) →201→200 replay, thread list shows `staffTaskId` + `staffCommentId`, `pageSize=101` 400, triage 428→200→409 stale.
  The real staff card ("The booking button is hard to find on mobile.") exists in `staff_time_tasks` — first live run of
  the default `deliveryStaffKanbanAdapter`. The dev server MUST be restarted after the F2 entities landed, otherwise
  every F2 route answers 500 (stale ORM metadata).
- Tests: `jest src/modules/delivery_os --maxWorkers=2` → 98 suites / 1828 green; core typecheck green; scoped test tsc
  (`/tmp/t056/tsconfig.json`) shows only the two pre-existing `routeTestKit` `em` inference errors; eslint clean.
- Open for L18b: `TC-DELIVERY-FLOW-03/04` integration specs against the real DB (the route suites use fakes), and the
  still thread-agnostic wording of the 428 lock-header message.

## T057 FLOW-F2 L18b — integration specs and F2 close

- `__integration__/TC-DELIVERY-FLOW-03-comment-import.spec.ts`, `TC-DELIVERY-FLOW-04-kanban-approval.spec.ts`; kit F2 helpers + staff cleanup in `flowSpecKit.ts` (`registry.staffProjectIds`, `createStaffProject`, `listStaff*`, `importComments`, `triageThread`; `createSiblingOrgUser` takes optional `features`).
- Review fix: `storeSyncCursor` never rewinds a cursor an overlapping delivery already advanced (+ unit test); F11 OpenAPI lists `duplicate_stable_id` under 422.
- Runner: `BASE_URL=http://localhost:3100 npx playwright test --config .ai/qa/tests/playwright.config.ts …/TC-DELIVERY-FLOW-0[34]-*.spec.ts --retries=0 --workers=1` → 4/4; jest delivery_os 98/1829. Stage hand-over: `FLOW-F2.md`.

## T058 — FLOW-F3 L19 report flow section (lane B, 2026-09-19)

- Exists now: R22 answers `flow` for pinned projects (`commands/reportQueries.ts` option `includeFlow`, `lib/flowStatus.ts#buildUnreadableReportFlowSection`, `lib/contracts.ts#deliveryReportWithFlowSchema`); fake v1/v2 provider `lib/fixtures/flow/fakes.ts`; route-kit override `routeState.flowTemplateProvider`.
- Stand-alone hand-over for the workflow owner: `FLOW-F3.md`.
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2 --ci` → 89 suites / 1702 tests, 1 snapshot green (local runner); `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green. Live R22 curl not run (shared server runs lane A) — after merge.

## T059 — FLOW-F4 L20a publication data + rules (lane B, 2026-09-19)

- Exists now: entity `DeliveryPublication` (`data/entities.ts`, table `delivery_publications`, append-only, FK ids only); migration `migrations/Migration20260919152308_delivery_os_flow_f4.ts` (only this table, with `down`) + module snapshot; validators `recordPublicationCommandInputSchema` (`{ projectId, publication }`, `foreign_reference` on mismatch) and `publicationListQuerySchema` (`pageSize ≤ 100`); pure rules `lib/publicationRules.ts` (`checkPublicationDeployConsent`, `checkPublicationVerification`, `buildDeploymentEvidencePayload`, `hashPublicationPayload`, `publicationBuildId`).
- For L20b: the consent rule checks only the decision named by `deployDecisionId`; also run `decisions.ts#checkDeployConsent` over all deploy decisions so a newer reject on the same revision wins. The derived evidence payload is `verified` only for a verified publication (`observedBuildId = buildId`), else `verification: null` → `unverified`.
- Migration applied to the local omhack DB (`yarn db:migrate`, consent recorded); `yarn db:generate` afterwards: `delivery_os: no changes` (unrelated `wms` drift output deleted, not committed). At merge the human regenerates the snapshot together with lane A's F2 migration.
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 92 suites / 1733 tests green; `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green (local runner).
- L20b order: run the pure `checkPublicationDeployConsent` first (named decision → `revision_mismatch` for another/unreadable revision), then `checkDeployConsent` over all deploy decisions to catch a newer reject. `releaseDecisionId` is part of the payload hash but has no column (spec table); the GET list returns stored columns only.

## T060 — FLOW-F4 L20b `delivery_os.publications.record` (lane B, 2026-09-19)

- Exists now: `commands/publications.ts` — feature `delivery_os.results.import` (wildcard-aware, fail closed 403) → replay by payload hash (no lock) → lock header → tx: project row lock + optimistic lock, baseline of project, named deploy decision (`checkPublicationDeployConsent`) then `checkDeployConsent` over all deploy decisions, `verification.evidenceId` scoped, flow gate (`422 stage_not_approved`, unreadable snapshot fails closed, legacy skips), v1 `deployment` evidence via the new `commands/evidence.ts#recordEvidenceWithinTransaction` + `delivery_publications` row in the SAME tx; unique violation → duplicate; one audit entry (`delivery_os.audit.publications.record`, i18n key still a UI patch request); existing `delivery_os.evidence.recorded` event + index side effects for the derived evidence, no new event.
- Registry diffs: `commands/index.ts` +1 line; `scopeChange.test.ts` id list + `publications` in the append-only subjects; `flowGate.ts` exports `unreadableSnapshotDetails`; `evidence.ts` exports `RecordOutcome`, `evidenceCrudIndexer`.
- Tests: `commands/__tests__/publications.test.ts` (21 cases: happy path + R21 release on the returned evidence id, unverified → `deployment_unverified`, replay/unique violation → duplicate, 409/428/404/403, `deploy_decision_missing`/`revision_mismatch`/`foreign_reference`, gate UX pending / all approved / unreadable / legacy no stage query, fake tx rollback). `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 93 suites / 1754 tests green; `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green. Runner: local.
- Next (L20c/L20d): route F14 `api/projects/[id]/publications/route.ts` (POST → 201 / 200 on duplicate, GET list via `publicationListQuerySchema`), fake deploy adapter in `lib/fixtures/flow/fakes.ts`, `TC-DELIVERY-FLOW-07` spec (run blocked until merge).

## T061 FLOW-F4 L20c — route F14 + fake deploy adapter (lane B)

- Exists now: `api/projects/[id]/publications/route.ts` (POST 201/200-duplicate, GET list newest first), `api/serializers.ts#serializePublication`, `lib/contracts.ts#publicationListItemSchema/publicationListResponseSchema/PUBLICATION_LIST_MAX_PAGE_SIZE`, `lib/fixtures/flow/fakes.ts#createFakeDeployAdapter` (for Michał/Marcin: `publish({ projectId, baselineId, sourceRevision, deployDecisionId, target, verified, evidenceId? })` → PublicationResult v1, `publishedAt` = 2026-09-19T12:00Z + 1 min per call).
- Tests: `api/__tests__/publications.route.test.ts`, `commands/__tests__/publicationChain.test.ts` (WordPress-profile chain R22 → R20 → F14 unverified → R21 422 → R19 `reference_material` URL check → F14 verified → R21 201 → revision B 422 `revision_mismatch`; pinned project 201, KV v2 → 422 `stage_not_approved`), `lib/__tests__/fakeDeployAdapter.test.ts`; `scopeChange.test.ts` lists the new append-only route. `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 96 suites / 1771 tests green; core typecheck green. Runner: local.
- `yarn generate`: only gitignored `apps/mercato/.mercato/generated/*` (api-routes, api-route-metadata, api-route-shard.016.delivery_os, command-loaders, modules*.generated.ts, openapi.generated.json). The OpenAPI bundler falls back to static extraction on Node 24 (known noise), so openapi.generated.json lists the path with `200` only for every route; the full status list lives in the route's `openApi` export (asserted in the route test).
- Follow-up (from review, T060 command): `assertVerificationEvidence` checks only that `verification.evidenceId` belongs to the project — consider requiring the same `sourceRevision` and a `reference_material`/`screenshot` kind. Live F14 smoke needs a server with lane-B code (after merge).

## T062 FLOW-07 seam — TC-DELIVERY-FLOW-07-publications + FLOW-08 regression (lane B)

- Exists now: `__integration__/TC-DELIVERY-FLOW-07-publications.spec.ts` (real DB, wordpress-theme): legacy chain R20 → F14 unverified → R21 422 `deployment_unverified` → R19 URL check → F14 verified → R21 201 → GET two rows newest first → lockless replay 200 duplicate (no new rows) → foreign-tenant user 404 on GET/POST (also with a lock header); pinned project: all four stages approved → R10/R14/R20 → KV v2 approved → F14 422 `stage_not_approved` (`stages.design_system_ui` stale) → UI v2 recorded, still 422 and zero rows → UI v2 approved → 201. SQL teardown includes `delivery_publications` and index/audit rows.
- Fix found by review: `commands/publications.ts` did not set `id` in `tx.create`, so `publicationId` was `undefined` before the flush → 500 after commit on a real DB (the jest kit assigned ids). Now `id: randomUUID()` like `evidence.ts`; `publications.test.ts` stops faking the publication id (9 cases fail without the fix).
- Tests: `npx playwright test --config .ai/qa/tests/playwright.config.ts --list TC-DELIVERY-FLOW-07` → 2 tests listed; `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2 --ci` → 96 suites / 1771 tests green; `jest src/__tests__/module-decoupling` → 12/12; core typecheck green. Runner: local.
- Blocked for the human: the Playwright run needs a server running lane-B code (merge + dev server restart, F4 migration applied), then `yarn test:integration packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-07-publications.spec.ts`.

## T063 — FLOW-F4 lane-B close-out (docs only)

- Lane-B hand-over: `handover/FLOW-F3-F4-lane-b.md` (SHAs, migration, tests, blockers, merge notes). Spec status line and changelog updated in `.ai/specs/2026-09-18-delivery-os-hackathon.md`; F3 and F4 are complete for this lane. Progress rows 5.1 and 5.4: evidence pointers only, nothing ticked.

- T064 FLOW-F4: F14 `verification.evidenceId` now bound to the publication baseline (422 baseline_mismatch) and, when non-null, revision (422 revision_mismatch); null-revision evidence accepted. commands/publications.ts + 3 tests in commands/__tests__/publications.test.ts.

- T066 FLOW-F4 audit fixes (lane B): F14 verification evidence must be a passed `test`/`screenshot`/`scan`/`review` (422 `unsupported_evidence_kind`, self-verification via the derived `deployment` row refused); consent detail path `deployDecisionId`; snapshot path `snapshotRef.attachmentId`; `releaseDecisionId` validated (422 `foreign_reference`); replay hash normalises uuid case and timestamps; fake deploy adapter fixture-marked (`*.example.test`, `fixture:` ref). Files: `commands/publications.ts`, `lib/publicationRules.ts`, `lib/fixtures/flow/fakes.ts`, `commands/flowQueries.ts`, FLOW-07 spec (+ negatives, second org, 428, F15 report gate). `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 96 suites / 1809 tests green; core typecheck + eslint clean; Playwright spec lists (2 tests), run pending after merge.
- T066 lane-B commit SHA: `06c6da26b` (`fix(delivery): FLOW-F4 close audit findings on publication verification, FLOW-07 negatives and merge`); recorded in `handover/FLOW-F3-F4-lane-b.md` (Commits table, T066 section, Blocker 4).
(T061 chain superseded by T066: the URL check is a `scan`, not `reference_material`)

- T068 FLOW-F4 audit fix (lane B): F14 compares the verification-evidence baseline with the stored baseline id and `projectId` case-insensitively; F14 OpenAPI 422 lists `unsupported_evidence_kind`, `baseline_mismatch` and the evidence `revision_mismatch`; F6 `flowStatus` fails closed on an unreadable pinned template ref; FLOW-07 spec: strict foreign-fixture cleanup, view-only 403, pagination cases. Commit `749b93fa2`. Files: `commands/publications.ts`, `commands/flowQueries.ts`, `data/validators.ts`, FLOW-07 spec. No migration, ACL, event or DI change.
- T070 FLOW-F4 docs audit fix (lane B, no file under `packages/`): `handover/FLOW-F3-F4-lane-b.md` rewritten as of final code SHA `3bf1a7435` (full commit table, re-measured tests, runnable R22 check, Status section, merge notes from a trial `git merge-tree`, 9 missing audit i18n keys + F14 detail codes for the UI owner, `delivery_agents` ACL-title patch for the enterprise owner). Spec: F14 row gains `unsupported_evidence_kind`, FLOW-07 coverage row marked not executed, status line re-synced to `dev-mateusz`, changelog entry. Tests run at `3bf1a7435`: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2 --ci` → 96 suites / 1821 tests, 1 snapshot; Playwright `--list TC-DELIVERY-FLOW-07` → 5 tests (not run).
