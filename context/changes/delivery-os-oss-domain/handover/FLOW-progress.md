# FLOW running hand-over (internal layers)

Stand-alone notes per stage live in `FLOW-F0-contracts.md`, `FLOW-F1-L13a-commands.md`, `FLOW-F1-L13b-stages.md`; this file collects the layers that change no cross-stream contract.

## T046 — FLOW-F1 L13c gate call sites (2026-09-19)

- Exists now: `commands/flowGate.ts` — `checkProjectFlowGateV1(em, project, scope)` (v1 `422 baseline_not_approved` + per-stage `details[]`), `loadFlowGateStates` (for the future publications command / DI read service), shared row loaders reused by `stages.ts`. Call sites: `tasks.ts#checkReadyGate` (reached by task update and attempt reconcile), `attempts.ts` reserve (both modes, before the register write), `decisions.ts` deploy `approved`.
- Gate key: `flowTemplateId` non-null only (`grep -n flowTemplateId packages/core/src/modules/delivery_os/commands/*.ts`); unpinned projects issue no stage query. Unreadable snapshot fails closed. Required stages are the four `FLOW_APPROVAL_STAGE_ORDER` stages, the same list F6 `flowStatus.ts#gateFrom` uses (the template schema requires exactly one stage of each kind).
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 83 suites / 1627 tests green (local runner); new `flowGate.test.ts` (8) and `flowRegression.test.ts` (7).
- Route-level evidence for UA-48 (R10/R12/R14/R20 answering the gated body) is L14's route tests + L15 `TC-DELIVERY-FLOW-02`; no route or registry changed here, dev server untouched.

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
