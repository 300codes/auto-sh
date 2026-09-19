# FLOW-F3/F4 hand-over — lane B (branch `dev-mateusz-flow-b`)

Scope: F3 (`flow` section on the R22 report, `deliveryOsFlowQueries`, provider seam) and F4 (publications, route F14, fake deploy adapter, FLOW-07 seam). Contract source: FLOW-F0 delta in `.ai/specs/2026-09-18-delivery-os-hackathon.md`. F10–F13 (comments, staff link) belong to lane A.

## Commits

| Task | SHA | Subject |
|---|---|---|
| T058 F3 | `0007f0d18` | add the flow section to the delivery report and document workflow seams |
| T059 F4 L20a | `3e2071fdf` | publication entity, F4 migration, pure publication rules |
| T060 F4 L20b | `31732ea0e` | `publications.record` with deploy consent correlation, flow gate, deployment evidence in one tx |
| T061 F4 L20c | `13213a102` | publications route, fake deploy adapter, publication chain test |
| T062 FLOW-07 | `63360dfe0` | publications integration spec, FLOW-08 regression rerun |
| T064 F4 fix | `e9001c592` | bind publication verification evidence to baseline and revision |

T063 (this hand-over + spec status/changelog, `d321f18fc`) is docs only.

## Contract

- `delivery.publication-result/v1` (`publicationResultV1Schema`), response `publicationRecordResponseSchema { publicationId, deploymentEvidenceId, duplicate }`.
- List (`GET /projects/:id/publications`): `publicationListResponseSchema { items, total }`, items = `publicationListItemSchema` (stored PublicationResult fields without `releaseDecisionId`, plus `publicationId`, `deploymentEvidenceId`, `recordedBy`, `createdAt`; `publishedAt` in UTC), newest first, `pageSize` ≤ `PUBLICATION_LIST_MAX_PAGE_SIZE` (100), archived projects readable.
- F15: `deliveryReportWithFlowSchema` (optional `flow`, pinned projects only; legacy body byte-identical).
- Errors on F14: `deploy_decision_missing`, `revision_mismatch`, `stage_not_approved` (pinned projects; v1 routes keep `baseline_not_approved`), `deployment_unverified`, `foreign_reference`, `unsupported_schema_version` (422), 413 over 1 MB.
- Since T064 the verification evidence is also checked against the publication: `baseline_mismatch` when its baseline differs, and `revision_mismatch` now also covers `verification.evidenceId` (details path `verification.evidenceId`). Evidence with a null `sourceRevision` is accepted on the baseline check alone; check order is `foreign_evidence`, baseline, revision.

## Migration

`packages/core/src/modules/delivery_os/migrations/Migration20260919152308_delivery_os_flow_f4.ts` (only `delivery_publications`, with `down`) + module snapshot. Applied to the local `omhack` DB with `yarn db:migrate` (consent `allow_local_migrations`).

## Runner and tests (local, capped, one at a time)

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2 --ci` → 96 suites / 1771 tests green at T062; repeated after T064 (`e9001c592`): 96 suites / 1774 tests green, 1 snapshot passed.
- `yarn workspace @open-mercato/core jest src/__tests__/module-decoupling` → 12/12.
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` → green.
- `npx playwright test --config .ai/qa/tests/playwright.config.ts --list TC-DELIVERY-FLOW-07` → 2 tests listed (not run).

## Generated-file diffs

All gitignored under `apps/mercato/.mercato/generated/` (api-routes, api-route-metadata, route shard, command-loaders, modules*, openapi). Nothing hand-edited. `yarn generate` needed after merge on a fresh checkout.

## Limitations

- No publication event: the derived `deployment` evidence re-uses `delivery_os.evidence.recorded`.
- An `unverified` publication is allowed and stored; it yields deployment evidence `unverified` and R21 refuses release (`deployment_unverified`).
- Fixture/fake-adapter publications never count as live FLOW-07; live proof needs a real target.
- `releaseDecisionId` has no column; the list does not return it.

## Blockers for the human

1. Run `yarn test:integration packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-07-publications.spec.ts` after merge, on a server running lane-B code with the F4 migration applied (the shared :3100 server ran lane A code, so it was not used).
2. Live R22 check: `curl` the report of a pinned project after merge (`flow` section) — not run here.
3. FLOW-07 live needs Michał's publication target and verification access.
4. This hand-over is final for lane B at `e9001c592` (plus this docs commit); no further F3/F4 code is planned.
5. Manual acceptance items in the master plan (Progress 5.1, 5.4) stay unticked; this hand-over is evidence only.

## Merge notes for lane A

- Append-only registry lines: `commands/index.ts` (+1 for publications), `commands/__tests__/scopeChange.test.ts` (id list, `publications` append-only subject). Keep both sides' lines.
- `commands/__tests__/attemptQueries.test.ts`: add `deliveryStaffKanbanAdapter` to the DI key list once lane A lands.
- Optionally feed `openThreadsByStage` into `buildDeliveryReportFlowSection`.
- Two migrations (lane A F2 + `…flow_f4`): regenerate `.snapshot-open-mercato.json` once after merging both; do not rename or reorder either file. `db:generate` emits unrelated `wms` drift — delete it.
- Gotcha for F2: an entity with `defaultRaw: 'gen_random_uuid()'` has no id before the flush; assign `randomUUID()` in `tx.create` (the route test kit hides this).

## Patches requested from the UI owner

i18n keys for the publications screen: `revision_mismatch`, `deploy_decision_missing`, `stage_not_approved` error messages, and the audit label `delivery_os.audit.publications.record` (fallback 'Record delivery publication'); also `delivery_os.audit.stages.*` from F1.

## Hours vs the F0 estimate

F3 ≈ 4 h and F4 ≈ 4 h estimated. Actual, from task timestamps: T058 finished 17:16, T059 17:27, T060 17:38, T061 17:48, T062 18:00 (2026-09-19) — roughly 10 minutes per task; earlier lane-B start time is not recorded, so F3 is not measured. Human wall-clock was not tracked.
