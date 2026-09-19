# Research — T053 (one screen)

- Contract (frozen F0): `lib/contracts.ts` L1619–1740 — `staffLinkSchema` (`syncCursors[fileKey] = {cursor, lastSyncAt, lastError}`),
  `commentThreadSchema`, `commentImportBatchV1Schema`, `commentImportResultSchema` (outcome enum created/updated/unchanged/skipped),
  `commentThreadTriageRequestSchema`. Spec tables: `.ai/specs/2026-09-18-delivery-os-hackathon.md` L461–463 (columns/uniques), L500–503 (F10–F13),
  L521–541 (import rules D8–D10). Breakdown A14: batch key/hash live in `sync_cursors[fileKey]`, no seventh table.
- Existing thread view used by F8: `lib/stageDecisions.ts#CommentThreadRecord` (threadKey, stageId, artifactId, sourceStatus, triageStatus, deferral)
  — the stored thread type must be a superset so L17 can feed `blockingThreadsFor` from rows.
- Version binding source: stage artifact `content.figmaRefs[] = {fileKey, nodeId, name, figmaVersion, url}` (`figmaRefSchema` L1333); ux fixture carries
  `FIGFILE0001` / `1234567890`, matching the comment-import fixture (`versionConfirmed: true` in the result fixture).
- Entity/migration pattern: `data/entities.ts` (F1 entities, `@Unique`/`@Index` named `delivery_<table>_<what>_uq|idx`, jsonb defaults), migration test
  `data/__tests__/flowMigration.test.ts` (regex over `addSql` statements), encryption test `data/__tests__/encryption.test.ts` (sorted entity ids).
- Migration procedure (T006/T038): `yarn db:generate` emits unrelated module noise (wms) — delete it, keep only delivery_os file + snapshot; review on a
  throw-away DB `open_mercato_ossreview` via `DATABASE_URL=…/open_mercato_ossreview yarn db:migrate`, then apply on the shared local DB (consent given).
- Hash helper: `lib/hash.ts#hashCanonical`. Fixtures/loaders: `lib/fixtures/flow/index.ts` (`loadCommentImportFixture`, `loadCommentImportResultFixture`,
  `loadStaffLinkFixture`, `loadNegativeFlowFixtures` — the three comment-import negatives are schema-stage `duplicate_stable_id`).
- No `modules/staff` import exists in delivery_os today (must stay so).
