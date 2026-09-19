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
