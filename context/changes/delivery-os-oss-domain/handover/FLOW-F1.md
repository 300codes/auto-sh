# FLOW-F1 hand-over — projects, stage artifacts and dependent approvals

Status: **F1 complete** (domain, HTTP layer, integration specs, FLOW-08 regression rerun). Head at the rerun: `d675c890b` on `dev-mateusz`; this T052 docs commit is added by the orchestrator.
Contract: Flow delta v1 (`DELIVERY_FLOW_CONTRACT_VERSION = 1`, v1 `DELIVERY_CONTRACT_VERSION = 1` unchanged), spec `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1.

## Commits

| Task | Layer | SHA |
|---|---|---|
| T041 | L10 entities, additive migration, encryption map | `42759be83` |
| T042 | L11a pure intake + stage-artifact rules | `5b2cc2efc` |
| T043 | L11b pure stage-decision + flow-status rules | `d593fff81` |
| T044 | L12 intake + flow-pin commands, features, events, template provider | `ec0502d7a` |
| T045 | L13b stage artifact + decision commands | `04e13ab01` |
| T046 | L13c gate on v1 ready / reserve / deploy | `51e68f24c` |
| T047 | L14a intake, proposals, flow status, pin routes | `b995312c3` |
| T048 | L14b stage artifact + decision routes | `b3d3581de` |
| T051 | L15a TC-DELIVERY-FLOW-01 / -02 / -09 | `e71dc11c4` |
| T052 | L15b regression rerun + this hand-over | (orchestrator) |

## Routes (all `/api/delivery_os`, OpenAPI exported, mutation guards on writes)

| Op | Route | Feature | Notes |
|---|---|---|---|
| F1/F2 | `GET/PUT /projects/:id/intake` | projects.view / projects.manage | intake lock header |
| F3 | `POST /projects/:id/intake/proposals` | results.import | ScopingProposal v1, replay 200 |
| F4 | `POST /projects/:id/flow/pin` | flow.manage | write-once, project lock |
| F6 | `GET /projects/:id/flow` | projects.view | FlowStatus v1 (also DI `deliveryOsFlowQueries`) |
| F7 | `POST /projects/:id/stages/:stageId/artifacts` | view + `manual/intake → projects.manage`, `agent/figma → results.import` | 201 / 200 duplicate |
| F8 | `POST /projects/:id/stages/:stageId/decisions` | stages.approve + template `approverFeatures` | `Idempotency-Key` required, 201 / 200 duplicate |
| F9 | `GET …/artifacts`, `GET …/decisions` | projects.view | `{ items, total }`, `pageSize ≤ 100` |

Unpinned → `422 flow_not_pinned`; non-approval stage → `422 stage_unknown`. v1 routes R10/R12/R14/R20 refuse pinned projects until all four stages are approved and current (`422 baseline_not_approved` + per-stage details).

## Migration

`migrations/Migration20260919111236_delivery_os_flow_f1.ts` + updated `.snapshot-open-mercato.json` (additive: intake, stage artifacts, stage decisions, project pin columns). **Applied locally** on :5442 (consent given). Not applied anywhere else.

## Verification (T052 rerun, local runner, capped, one command at a time)

| Command | Result |
|---|---|
| `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` (incl. `finalRegression`, `flowRegression`, `manualFlow`) | 88 suites / 1689 tests passed |
| `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` | 1 successful, exit 0 |
| OSS-only boot: `OM_ENABLE_ENTERPRISE_MODULES=false` + `_SSO/_SECURITY/_AGENTS=false yarn generate` | exit 0; `enabled-module-ids.generated.ts`: `delivery_os` 1, `record_locks`/`sso`/`security`/`agent_orchestrator` 0; no enterprise import in `delivery_os` non-test sources (0 matches); only generated mention of `@open-mercato/enterprise` is the flag/comment text in `app-modules-overrides.compiled.mjs` |
| `BASE_URL=http://localhost:3100 npx playwright test --config .ai/qa/tests/playwright.config.ts …/TC-DELIVERY-OSS-001.spec.ts --retries=0` | 4/4 passed (2.5 min, ~130 s is spec discovery) |
| FLOW-01/02/09 specs (T051, not rerun here) | 2/2, 2/2, 2/2 passed |

Earlier live-curl evidence (T048): pin 201; F7 201 then 200 duplicate; F8 without `Idempotency-Key` 400, with key 201, replay 200; `pageSize=101` 400. Route-level evidence for the gate: `TC-DELIVERY-FLOW-02` and `stageArtifacts/stageDecisions.route.test.ts`. Layer notes: `FLOW-F1-L13a/L13b/L14a-*.md`, `FLOW-progress.md`.

FLOW-08 (v1 regression, OSS-only, isolation): green on the evidence above. Live Figma/WordPress FLOW-03/06/07 are out of F1 and remain human-run.

## Limitations

- Comment threads (F11–F13): `loadStageCommentThreads` / `recordThreadDeferrals` are still stubs, so `openThreads` is 0 and `open_comments` never blocks until F2.
- The local tenant has data encryption off: `client_approver_name` and intake brief are plaintext at rest here; encrypted-at-rest is unverifiable locally (read paths use the decryption helpers).
- Whole-repo spec discovery makes each Playwright run ≈ 130 s regardless of the spec.
- No master-plan Progress row is ticked; manual acceptance stays with humans.

## Patch requests for other owners

- **UI (Adam):** i18n keys for the 14 flow error codes (`deliveryFlowErrorCodes`), audit keys `delivery_os.audit.stages.*`, labels for `blockers[].kind` and `nextAction.kind`; English fallbacks exist server-side.
- **Marcin:** implement `deliveryFlowTemplateProvider` (Studio-published templates; OSS ships built-in `delivery-default@1`) and call command `delivery_os.flow.link_instance` (F5) to store the workflow instance ref.
- **Adam (Figma):** send F7 artifacts with the `figma` source payload per `stageArtifactV1Schema` (file key, node id, snapshot ref, `figmaVersion` or null); F1 fixtures in `lib/fixtures/flow/`.

## Estimate

F0 estimate for F1 was ≈ 10 h; actual ≈ 11 h (T041–T048 + specs and rerun, incl. test-kit and integration-spec work). Fresh estimate: F2 (staff link, comment import, triage, thread list, encryption, FLOW-03/04) ≈ 8 h; F3 (report `flow` section, DI seams) ≈ 4 h; F4 (publications, final gate) ≈ 4 h. Blockers unchanged from F0 (Figma comment access, Marcin's provider, publication target).
