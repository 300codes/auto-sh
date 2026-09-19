<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F2 L18a routes

- **Plan**: `context/changes/asd-oss-t056-flow-f2-l18a-add-staff-link-comment/plan.md` — **Scope**: all phases — **Date**: 2026-09-19
- **Verdict**: APPROVED — **Findings**: 0 critical, 0 warnings, 2 observations (self-review, sequential, memory rule)
- Evidence: `jest src/modules/delivery_os --maxWorkers=2` → 98/98 suites, 1828 tests; `turbo typecheck --filter=@open-mercato/core` green; the 4 paths present in `openapi.generated.json`; live smoke recorded in FLOW-progress (T056).

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (manual 1.3 left for a human; agent smoke evidence exists) |

| ID | Sev | Finding | Decision |
|---|---|---|---|
| F1 | OBSERVATION | `comment-threads/route.ts` loadReplies loads every reply of the page's threads and truncates to 500 per thread in memory; bounded by pageSize ≤ 100 but not by a SQL limit. | ACCEPTED — the frozen item schema caps at 500; a global SQL limit would starve later threads; realistic volumes are small |
| F2 | OBSERVATION | OpenAPI docs are explicit `OpenApiRouteDoc` objects instead of `createDeliveryOsCrudOpenApi` named in the task. | ACCEPTED — custom (non-CRUD) routes in the module use explicit docs; the 409 entries carry the required `z.union(flow error, lock conflict)` |
