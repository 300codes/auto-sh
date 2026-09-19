<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F2 L18a routes

- **Plan**: `context/changes/asd-oss-t056-flow-f2-l18a-add-staff-link-comment/plan.md`
- **Mode**: Deep (self-review, autonomous) — **Date**: 2026-09-19 — **Verdict**: REVISE → SOUND after fixes
- **Grounding**: 6/6 paths ✓ (routeSupport, serializers, schemas, routeTestKit, scopeChange, artifacts route), symbols ✓
  (`parseFlowVersioned`, `commentThreadListQuerySchema`, `readIdempotencyKeyHeader`, `toStaffLink`, `tryResolveKanbanAdapter`)

| Dimension | Verdict |
|---|---|
| End-State Alignment | WARNING (1) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (2) |
| Plan Completeness | WARNING (1) |

| ID | Sev | Dimension | Finding | Decision |
|---|---|---|---|---|
| F1 | ⚠️ WARNING | Blind Spots | Plan says an absent DI key makes `routeTestKit`'s container throw; it returns `undefined` (`services[name]`). Both `tryResolveStaffAccess` and `tryResolveKanbanAdapter` treat `undefined` as "absent", so the fakes must be nullable slots, not throwing resolves. | FIXED (plan wording) |
| F2 | ⚠️ WARNING | Plan Completeness | Thread-list contract never states that the `status` query filter maps to the `source_status` column (`sourceStatus`) — the implementer would filter on a non-existent `status` field and silently return everything. | FIXED |
| F3 | ⚠️ WARNING | Blind Spots | The live smoke needs prerequisites the plan omits: a seeded staff time project reachable by the caller, a project pinned to the default template, and a staff task status column (no column ⇒ every thread fails). Without them the "PUT 200 / import 201" criteria are unreachable and would look like a code defect. | FIXED (prerequisites added) |
| F4 | 🔍 OBSERVATION | End-State Alignment | Acceptance says "generated OpenAPI JSON" without the path; name `apps/mercato/.mercato/generated/openapi.generated.json` so 1.2 is mechanical. | FIXED |
