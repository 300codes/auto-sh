# FLOW-F3/F4 hand-over — lane B (branch `dev-mateusz-flow-b`)

Scope: F3 (`flow` section on the R22 report, `deliveryOsFlowQueries`, provider seam) and F4 (publications, route F14, fake deploy adapter, FLOW-07 seam). Contract source: FLOW-F0 delta in `.ai/specs/2026-09-18-delivery-os-hackathon.md`. F10–F13 (comments, staff link) belong to lane A.

Final lane-B code SHA: `3bf1a7435` (T069). Everything below is stated as of that commit; the T070 docs commit that rewrote this file changes no code.

## Commits

| Task | SHA | Kind | Subject |
|---|---|---|---|
| T058 F3 | `0007f0d18` | code | add the flow section to the delivery report and document workflow seams |
| T059 F4 L20a | `3e2071fdf` | code | publication entity, F4 migration, pure publication rules |
| T060 F4 L20b | `31732ea0e` | code | `publications.record` with deploy consent correlation, flow gate, deployment evidence in one tx |
| T061 F4 L20c | `13213a102` | code | publications route, fake deploy adapter, publication chain test |
| T062 FLOW-07 | `63360dfe0` | test | publications integration spec, FLOW-08 regression rerun (jest) |
| T063 | `d321f18fc` | docs | lane-B hand-over and spec changelog for the publication seam |
| T064 F4 fix | `e9001c592` | code | bind publication verification evidence to baseline and revision |
| T065 | `1a5bbf2bc` | docs | record the evidence-binding fix in the lane-B hand-over |
| T066 audit fix | `06c6da26b` | code | close audit findings on publication verification, FLOW-07 negatives and merge |
| T067 | `c12abb281` | docs | record the audit-fix commit in the lane-B hand-over |
| T068 audit fix | `749b93fa2` | code | close final audit findings on id case, flow status parity and merge notes |
| T069 audit fix | `3bf1a7435` | code | close audit findings on feature policy, gate parity and publication tests |

## Contract

- `delivery.publication-result/v1` (`publicationResultV1Schema`), response `publicationRecordResponseSchema { publicationId, deploymentEvidenceId, duplicate }`.
- List (`GET /projects/:id/publications`): `publicationListResponseSchema { items, total }`, items = `publicationListItemSchema` (stored PublicationResult fields without `releaseDecisionId`, plus `publicationId`, `deploymentEvidenceId`, `recordedBy`, `createdAt`; `publishedAt` in UTC), newest first (`createdAt, publishedAt, id` desc), `pageSize` ≤ `PUBLICATION_LIST_MAX_PAGE_SIZE` (100, above → 400 `validation_failed`), archived projects readable.
- F15: `deliveryReportWithFlowSchema` (optional `flow`, pinned projects only; legacy body byte-identical, no `flow` key). `/report` answers 404 before a baseline exists; use F6 `GET /projects/:id/flow` for a project without a baseline.
- Errors on F14: 422 `deploy_decision_missing`, `revision_mismatch` (consent on another revision, or `verification.evidenceId` with a differing non-null revision; an unreadable stored revision also yields it), `stage_not_approved` (pinned projects; v1 routes keep `baseline_not_approved`), `deployment_unverified`, `unsupported_evidence_kind`, `baseline_mismatch` (verification evidence of another baseline), `foreign_reference` (incl. verification evidence or `releaseDecisionId` of another project), `unsupported_schema_version`; 428 missing project version header (new publications only); 409 stale project version; 413 over 1 MB.
- Verification proof (for Michał's adapter): `verification.evidenceId` must be a `test`, `screenshot`, `scan` or `review` evidence that passed. Record the HTTP URL check as a `scan` (`checkId: publication-url-check`, `status: passed`, `rawReportHash`, with `sourceRevision`). `deployment` (including the row F14 itself derives), `reference_material` and `result_manifest` → `422 unsupported_evidence_kind`. Replays are matched after lowercasing uuids and normalising timestamps; ids are compared case-insensitively. `deploymentEvidenceId` may be shared by publications with identical deployment facts.
- The fixture marker (`*.example.test` host, `fixture:` ref — `FAKE_DEPLOY_HOST_SUFFIX` / `FAKE_DEPLOY_REF_PREFIX` in `lib/fixtures/flow/fakes.ts`) is enforced only by the fake adapter, not by F14. The live FLOW-07 checklist MUST reject such a publication; fixture output never counts as live evidence.

## Migration

`packages/core/src/modules/delivery_os/migrations/Migration20260919152308_delivery_os_flow_f4.ts` (only `delivery_publications`, with `down`) + module snapshot. Applied to the local `omhack` DB with `yarn db:migrate` (consent `allow_local_migrations`).

## Runner and tests

Runner: local mode (no compose `app` container used), in the lane-B worktree, capped, one heavy command at a time. The shared :3100 dev server runs lane A's code and was not used.

- Run at `3bf1a7435` (T070): `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2 --ci` → 96 suites / 1821 tests passed, 1 snapshot passed.
- Run at `3bf1a7435` (T070): `npx playwright test --config .ai/qa/tests/playwright.config.ts --list TC-DELIVERY-FLOW-07` → 5 tests listed in 1 file. **Not run** — listing only; see Blockers.
- Run at `3bf1a7435` (T069, not repeated in T070): core `src/__tests__` 24 suites / 224 tests green (includes `module-decoupling`, OSS-only); `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green (covers `__integration__`); eslint on changed files 0 errors.
- Run at `3bf1a7435` (T070): `yarn workspace @open-mercato/core jest src/modules/auth/__tests__/acl-feature-catalog.i18n.test.ts --maxWorkers=2 --ci` → **1 failed** (enterprise `delivery_agents` titles, not lane-B code; see Patches requested).
- FLOW-08 on this branch means the jest regression pair above (whole `delivery_os` suite incl. v1 route/contract/`scopeChange` suites, plus `module-decoupling`). No Playwright `TC-DELIVERY-FLOW-08` spec exists on this branch; lane A owns it.

## Generated-file diffs

All gitignored under `apps/mercato/.mercato/generated/` (api-routes, api-route-metadata, route shard, command-loaders, modules*, openapi). Nothing hand-edited. `yarn generate` needed after merge on a fresh checkout.

## Limitations

- No publication event: the derived `deployment` evidence re-uses `delivery_os.evidence.recorded`.
- An `unverified` publication is allowed and stored; it yields deployment evidence `unverified` and R21 refuses release (`deployment_unverified`).
- Fixture/fake-adapter publications never count as live FLOW-07; live proof needs a real target.
- `releaseDecisionId` has no column; the list does not return it.

## Blockers for the human

1. After the merge, on a server running lane-B code with the F4 migration applied: `yarn test:integration packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-07-publications.spec.ts`.
2. Live R22 check after the merge: `curl -H 'cookie: <session>' 'http://localhost:3100/api/delivery_os/projects/<pinnedId>/report' | jq .flow` must print the flow section; the same call for a legacy (unpinned) project must have no `flow` key at all (`jq 'has("flow")'` → `false`). Not run here.
3. Live FLOW-07 needs Michał's publication target and verification access.
4. Regenerate `migrations/.snapshot-open-mercato.json` once both lanes' migrations are merged.

## Status

- F3 and F4 are complete for lane B as of `3bf1a7435`; later changes, if any, will be recorded in `FLOW-progress.md`.
- Manual acceptance items in the master plan (Progress 5.1, 5.4) stay unticked; this hand-over is evidence only.

## Merge notes (lane B into `dev-mateusz`)

A trial `git merge-tree HEAD dev-mateusz` (T070) conflicts in these files. Resolution: keep both sides, lane A's lines first, lane B's last.

1. `.ai/specs/2026-09-18-delivery-os-hackathon.md` — the status line is byte-identical to lane A's current text (auto-merges; if lane A edits it again, keep lane A's). The only remaining conflict is the changelog tail where both lanes append: keep both blocks, lane A first.
2. `context/changes/delivery-os-oss-domain/handover/FLOW-progress.md` — both lanes append; keep both.
3. `api/__tests__/routeTestKit.ts` — single-line `emptyRouteStore` / `ORDERED_ENTITIES`: take lane A's line and append `publications` / `DeliveryPublication` last. Same for `IMMUTABLE_SUBJECTS` in `commands/__tests__/scopeChange.test.ts` (`'publications'` last).
4. `api/serializers.ts` — import block: keep lane B's `DELIVERY_FLOW_SCHEMA_VERSIONS` and lane A's `CommentThreadListItem` / `CommentThreadReplyItem`; at the end keep lane A's comment serializers and lane B's `serializePublication`.
5. `commands/index.ts` — both registry lines.
6. `data/entities.ts` — lane A's entities, then `DeliveryPublication`.
7. `data/validators.ts` — lane A's schemas, then the publication schemas.
8. `migrations/.snapshot-open-mercato.json` — never hand-merge; take either side and regenerate after both migrations are in place.

Files that auto-merged in the trial but must keep lane B's side:

- `lib/stageDecisions.ts` — lane B switched `hasAllFeatures(grantedFeatures, templateStage.approverFeatures)` (`@open-mercato/shared/security/features`) to `authorizeFeatures(templateStage.approverFeatures, { grantedFeatures })` (`@open-mercato/shared/security/featurePolicy`); lane A has the file unchanged, so take lane B's side, otherwise `feature-policy-authorization-coverage` stays red.
- `commands/flowQueries.ts`, `commands/flowGate.ts` — if their import blocks conflict with lane A's comment-thread additions, take both sides.

Other:

- `commands/__tests__/attemptQueries.test.ts`: add `deliveryStaffKanbanAdapter` to the DI key list once lane A lands.
- Migration order: F4 `Migration20260919152308_delivery_os_flow_f4.ts` sorts before lane A's F2 `Migration20260919160535_delivery_os_flow_f2.ts`; on a DB that already ran F2 it runs as an older pending migration (additive, independent tables). Do not rename or reorder either file. `db:generate` emits unrelated `wms` drift — delete it.
- `flow.gate` filters `open_comments` by design (`gateFrom` in `lib/flowStatus.ts`); no `openThreadsByStage` wiring is needed (`handover/FLOW-F3.md`).
- Gotcha for F2: an entity with `defaultRaw: 'gen_random_uuid()'` has no id before the flush; assign `randomUUID()` in `tx.create` (the route test kit hides this).
- Run `yarn generate` after the merge. Estimate (not measured): ~1–1.5 h — resolve the conflicts, regenerate the snapshot, `yarn generate`, `yarn db:migrate` (ask first), run the FLOW-07 Playwright spec and the FLOW-08 regression.

## Patches requested

### UI owner — i18n (`packages/core/src/modules/delivery_os/i18n/**`, all five locales; out of lane-B ownership, so this stays a patch request)

- Audit labels used by the commands but missing from `en.json` (9 of 27 `delivery_os.audit.*` keys): `delivery_os.audit.decisions.deploy`, `delivery_os.audit.decisions.release`, `delivery_os.audit.flow.pin`, `delivery_os.audit.flow.link_instance`, `delivery_os.audit.intake.update`, `delivery_os.audit.intake.import_proposal`, `delivery_os.audit.stages.create_artifact`, `delivery_os.audit.stages.decide`, `delivery_os.audit.publications.record` (fallback 'Record delivery publication').
- F14 error codes needing user-facing strings: `revision_mismatch`, `deploy_decision_missing`, `stage_not_approved`, `baseline_mismatch`, `unsupported_evidence_kind`, `foreign_reference`, `deployment_unverified`.
- F14 detail codes needing user-facing strings: `verification_evidence_kind`, `verification_evidence_not_passed`, `foreign_release_decision`, `baseline_mismatch` (plus `foreign_evidence`, `deploy_decision_rejected`, `deploy_revision_mismatch`).

### Enterprise owner (Marcin) — auth ACL catalog

`packages/core/src/modules/auth/__tests__/acl-feature-catalog.i18n.test.ts` is red: `packages/enterprise/src/modules/delivery_agents/acl.ts` declares two features without English titles in the auth catalog (`packages/core/src/modules/auth/i18n/en.json`). Expected entries from the test output:

- `auth.acl.features.delivery_agents.execute` → "Execute delivery tasks via Cezar"
- `auth.acl.features.delivery_agents.monitor` → "Monitor execution status and attempt lifecycle"

Not a lane-B file.

## Hours vs the F0 estimate

F3 ≈ 4 h and F4 ≈ 4 h estimated. Actual, from task timestamps: T058 finished 17:16, T059 17:27, T060 17:38, T061 17:48, T062 18:00 (2026-09-19) — roughly 10 minutes per task, plus audit fixes T064–T069; earlier lane-B start time is not recorded, so F3 is not measured. Human wall-clock was not tracked.
