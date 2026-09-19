# FLOW running hand-over (internal layers)

Stand-alone notes per stage live in `FLOW-F0-contracts.md`, `FLOW-F1-L13a-commands.md`, `FLOW-F1-L13b-stages.md`; this file collects the layers that change no cross-stream contract.

## T046 — FLOW-F1 L13c gate call sites (2026-09-19)

- Exists now: `commands/flowGate.ts` — `checkProjectFlowGateV1(em, project, scope)` (v1 `422 baseline_not_approved` + per-stage `details[]`), `loadFlowGateStates` (for the future publications command / DI read service), shared row loaders reused by `stages.ts`. Call sites: `tasks.ts#checkReadyGate` (reached by task update and attempt reconcile), `attempts.ts` reserve (both modes, before the register write), `decisions.ts` deploy `approved`.
- Gate key: `flowTemplateId` non-null only (`grep -n flowTemplateId packages/core/src/modules/delivery_os/commands/*.ts`); unpinned projects issue no stage query. Unreadable snapshot fails closed. Required stages are the four `FLOW_APPROVAL_STAGE_ORDER` stages, the same list F6 `flowStatus.ts#gateFrom` uses (the template schema requires exactly one stage of each kind).
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 83 suites / 1627 tests green (local runner); new `flowGate.test.ts` (8) and `flowRegression.test.ts` (7).
- Route-level evidence for UA-48 (R10/R12/R14/R20 answering the gated body) is L14's route tests + L15 `TC-DELIVERY-FLOW-02`; no route or registry changed here, dev server untouched.
