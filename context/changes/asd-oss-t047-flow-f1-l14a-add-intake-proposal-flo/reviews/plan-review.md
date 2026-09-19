<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F1 L14a routes

- **Plan**: context/changes/asd-oss-t047-flow-f1-l14a-add-intake-proposal-flo/plan.md
- **Mode**: Deep (in-process, autonomous) · **Date**: 2026-09-19 · **Verdict**: SOUND after fixes
- **Findings**: 0 critical, 2 warnings, 1 observation

Grounding: 6/6 paths ✓ (deploy-decisions route, routeSupport, serializers, di.ts, commands/intake.ts, lib/flowStatus.ts), symbols ✓ (`defaultIntake`, `buildFlowStatus`, `countBlockingThreadsByStage`, `loadStageCommentThreads`, `parseFlowVersioned`, `readCappedRouteBody`).

| ID | Sev | Finding | Decision |
|---|---|---|---|
| F1 | WARNING | Test list did not name the concrete failure paths (403 per feature incl. `flow.manage` missing from EMPLOYEE_FEATURES, 404 foreign tenant/org on every method, 428, stale intake 409 vs. concurrent project PUT, proposals stripped, replay bodies, legacy status, write-once pin) | FIXED — enumerated under Testing Strategy |
| F2 | WARNING | `commands/flowQueries.ts` importing `commands/stages.ts` from `di.ts` pulls command registration into DI load — verified harmless (`reportQueries` already imports `evidence`/`tasks`; single module instance, `registerCommand` is idempotent per import) | DISMISSED — no change |
| F3 | OBSERVATION | F6 must never write: use a forked EM and no lock options; test asserts no persist/flush/transactional calls | FIXED — added to Testing Strategy |
