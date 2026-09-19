# FLOW-F1 hand-over — projects, stage artifacts and dependent approvals (draft)

Status: F1 domain + HTTP layer implemented (T044–T048), base commit `b995312c3`; the T048 commit is added by the orchestrator.
Contract: Flow delta v1 (`DELIVERY_FLOW_CONTRACT_VERSION = 1`), spec `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1.

## Routes (all `/api/delivery_os`, OpenAPI exported, mutation guards on writes)

| Op | Route | Feature | Notes |
|---|---|---|---|
| F1/F2 | `GET/PUT /projects/:id/intake` | projects.view / projects.manage | intake lock header |
| F3 | `POST /projects/:id/intake/proposals` | results.import | ScopingProposal v1, replay 200 |
| F4 | `POST /projects/:id/flow/pin` | flow.manage | write-once, project lock |
| F6 | `GET /projects/:id/flow` | projects.view | FlowStatus v1 (also DI `deliveryOsFlowQueries`) |
| F7 | `POST /projects/:id/stages/:stageId/artifacts` | view + `manual/intake → projects.manage`, `agent/figma → results.import` | 201 / 200 duplicate, project lock after replay |
| F8 | `POST /projects/:id/stages/:stageId/decisions` | stages.approve + template `approverFeatures` | `Idempotency-Key` required, 201 / 200 duplicate, project lock after replay |
| F9 | `GET …/artifacts`, `GET …/decisions` | projects.view | `{ items, total }` newest first, `page`, `pageSize ≤ 100` |

Path `stageId` is checked before the body: unpinned → `422 flow_not_pinned`, not an approval stage of the pinned template → `422 stage_unknown`.
v1 routes R10/R12/R14/R20 refuse pinned projects until all four stages are approved and current (`422 baseline_not_approved` + per-stage details).

## Data / migration

`Migration20260919111236_delivery_os_flow_f1.ts` (additive: intake, stage artifacts, stage decisions, project pin columns). Applied locally on :5442 (consent given).

## Verification (local runner, capped)

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 88 suites / 1689 tests green (incl. `manualFlow`, `finalRegression`, new `stageArtifacts.route.test.ts` 17, `stageDecisions.route.test.ts` 11).
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` → green.
- Live curl on :3100: pin 201; F7 scope 201 then 200 duplicate; F8 without `Idempotency-Key` 400; F8 with key 201, replay 200; F9 lists with decrypted client approval; `pageSize=101` 400.

## Remaining F1 items / next

- Integration specs `TC-DELIVERY-FLOW-01/02/09` against the real DB (L15).
- Comment threads (F11–F13) replace the `loadStageCommentThreads` / `recordThreadDeferrals` seams (L17).
- UI: i18n keys `delivery_os.audit.stages.*` (patch request to the UI owner, English fallbacks in place).
- The local tenant has data encryption off, so `client_approver_name` is plaintext at rest here; the read path uses the decryption helpers either way.
