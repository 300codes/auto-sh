<!-- PLAN-REVIEW-REPORT -->
# Plan Review: TC-DELIVERY-FLOW-07-publications

- **Plan**: context/changes/asd-oss-b-t062-flow-07-seam-add-the-api-integration/plan.md
- **Mode**: Deep (inline grounding) · **Date**: 2026-09-19 · **Verdict**: SOUND · **Findings**: 0 critical, 1 warning, 2 observations

Grounding: route/command/fakes/OSS-001/migration paths ✓; `checkProjectFlowGateV1` used by tasks/decisions/attempts ✓ (stages must be approved before R10/R14/R20); core tsconfig includes `__integration__` (typecheck covers the spec) ✓; Playwright discovery via `discoverIntegrationSpecFiles` ✓.

| ID | Sev | Finding | Decision |
|----|-----|---------|----------|
| F1 | WARNING | Config timeout is 20 s per test; the pinned scenario makes ~30 calls. | FIXED — plan: `test.setTimeout(180_000)` per test (like `test.slow()` in OSS-001, with headroom). |
| F2 | OBS | Stage decision `Idempotency-Key`s must be unique per run so reruns on a dirty DB never replay across projects. | FIXED — keys carry `randomUUID()`. |
| F3 | OBS | Fake adapter `publishedAt` is a fixed epoch; GET orders by `createdAt`, so "newest first" is unaffected, and the replay must resend the identical body object. | Noted in plan. |
