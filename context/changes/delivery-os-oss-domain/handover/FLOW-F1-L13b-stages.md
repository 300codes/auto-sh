# FLOW-F1 L13b — stage artifact and stage decision commands (T045)

**Plan:** `context/changes/asd-oss-t045-flow-f1-l13b-add-stage-artifact-and/` · **Spec:** `.ai/specs/2026-09-18-delivery-os-hackathon.md`
§ Flow delta v1 rows F7–F8, Currency (D6), Template pinning (D7) (changelog entry 2026-09-19 T045). **Commit:** recorded by the orchestrator.

## What landed

| Piece | Where |
|---|---|
| `delivery_os.stages.create_artifact` (F7), `delivery_os.stages.decide` (F8) | `commands/stages.ts`, registered in `commands/index.ts` |
| L17 seams: `loadStageCommentThreads` (answers `[]`), `recordThreadDeferrals` (no-op), `collectArtifactAcReferences` (v2 hook) | `commands/stages.ts` (exported) |
| Additive `checkProjectArchivable(tasks, 'stage')` messages | `commands/projects.ts` |
| Events `delivery_os.stage.artifact_created`, `delivery_os.stage.decided` emitted after commit | `commands/stages.ts` |
| Tests | `commands/__tests__/stages.test.ts` (25 cases), `scopeChange.test.ts` id set |

## Contract facts for Adam (UI / Figma) and Marcin (workflow / agent)

- **F7 input** (command): `{ projectId, stageId, artifact: StageArtifactV1, trustedExecution? }`. Path `stageId`/`projectId` must equal the body (`422 foreign_reference`). `dependsOn` must name upstream stages only (`422 foreign_dependency`, parse-time) and bind each required upstream's **current** artifact (`409 stage_artifact_stale`), which must be `approved` (`422 stage_not_approved`) and current itself (`422 stage_dependency_stale`). Scope `content.platform` must equal the frozen profile (`422 target_profile_frozen`). Design `content.screens` and `attachments` are verified against stored files like v1 baselines (`422 attachment_*`).
- **F7 result**: `StageArtifactCreateResponse` — `{ artifactId, projectId, stageId, version, contentHash, duplicate, downstreamNowStale[], projectUpdatedAt }`. Route maps `duplicate` to 200/201. Identical content (hash over `schemaVersion, stageId, content, dependsOn, attachments`) replays **before** the lock header is required — a replay never needs the header. A real write needs the project lock header (`428 optimistic_lock_required`, `409 optimistic_lock_conflict`) and bumps the project version; the UI must refresh the project `updatedAt` after every artifact or decision.
- **F7 guard**: an executing task or an unknown attempt on the project refuses a new version (`409 attempt_active` with `details[].code = task_executing | attempt_<state>`, or `409 reconciliation_required`). Cancel/reconcile first (R17/R18). A new upstream version returns `downstreamNowStale` (e.g. Scope v2 → `['ux', 'key_visual']`) and every dependant reads `stale` in F6 — no row is touched.
- **Agent path (Marcin)**: the scoping agent submits the Scope artifact in-process with an issued `trustedExecution` (`issueTrustedExecution(actorUserId)`); no lock header is needed without a request; the same option over HTTP is `403 forbidden` (`trusted_execution_required`).
- **F8 input**: `{ projectId, stageId, idempotencyKey, decision: StageDecisionRequest }` (route reads `Idempotency-Key`; missing → `400 idempotency_key_required` before parsing). Same key + same body → `200 duplicate: true` (no row, no lock header); same key + other body or stage → `409 idempotency_conflict`; a new key always appends (approve → reject → approve = three rows, latest wins). `subjectHash`/`subjectVersion` must match the stage's current artifact (`409 subject_hash_mismatch`; superseded artifact `409 stage_artifact_stale`).
- **F8 approval**: needs the upstream chain approved and current (`422 stage_not_approved` / `stage_dependency_stale`), a `clientApproval` when the pinned stage has `requiresClientApproval` (`key_visual`, `design_system_ui` in `delivery-default@1`; `422 client_approval_required`), and the caller's grants must cover the stage's `approverFeatures` from the snapshot (`403 forbidden`, detail path `stages.<id>.approverFeatures`; wildcard grants count, `projects.manage` alone does not). Rejection needs `reason` (`422 reason_required`). Result `StageDecisionResponse` carries the new `currency`.
- **F8 threads**: until L17 lands the thread loader answers no threads, so `blocking_comments_open` and `deferredThreadKeys` are not exercised end-to-end yet; the rule is implemented and unit-tested in `lib/stageDecisions.ts`.
- **Audit**: both commands log ids/stage/version/verdict only; approver name and evidence live in the encrypted columns.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/stages.test.ts --maxWorkers=2` → 25 tests green.
- `yarn workspace @open-mercato/core jest src/modules/delivery_os src/__tests__/module-decoupling.test.ts --maxWorkers=2` → 67 suites, 1489 tests green (`appendOnly` static scan and `scopeChange` id set included).
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green; eslint on the touched files clean.

## Limitations / next

- No routes yet (L14): F7/F8 have no HTTP surface, so no live smoke and no `TC-DELIVERY-FLOW-02/09` spec yet; both ship with the routes.
- Gate call sites in `tasks.ts` / `attempts.ts` / `decisions.ts` (C21) are the next task; until then a pinned project is not yet refused on the v1 dispatch routes.
- `unknown_ac` is unreachable with v1 content (see spec changelog); v2 proposal: additive `acIds` on design screens.
- i18n keys `delivery_os.audit.stages.create_artifact` / `.decide` are used with English fallbacks; the UI owner adds them to `i18n/*.json` (patch request, same as P2 of OSS-06).
- Manual acceptance rows of the master plan remain human-only.
