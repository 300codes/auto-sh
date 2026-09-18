# OSS-01 (T003): OSS and enterprise-boundary specs — Plan Brief

> Full plan: `context/changes/asd-oss-t003-oss-01-write-the-oss-and-enterprise/plan.md`

## What & Why

Write the two small specs master-plan Phase 1 requires (OSS `delivery_os` and enterprise `delivery_agents` boundary) and an OSS hand-over note with the API and test lists. The OSS spec freezes real API paths and error codes so UI, EXEC and QA can build in parallel from the H4 hand-over without contract churn.

## Starting Point

No spec and no module exist yet. The master plan and the BREAKDOWN already decide entities, contracts, operations, ACL split and coverage; the platform router and `makeCrudRoute` define how paths can look.

## Desired End State

Both specs exist in `.ai/specs/` and `.ai/specs/enterprise/`, follow `.ai/specs/AGENTS.md`, reference the master plan, and contain Model/API, Integration Coverage and Migration & BC. The hand-over note lists every new API and planned test file per layer.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Project/task update & delete | Collection-level PUT (id in body) / DELETE (`?id=`) via `makeCrudRoute` | That is what `factory.ts` and `deleteCrud` support; platform reuse scores on criterion #1 |
| Action routes | Master-plan nested `[id]` paths | Router matches dynamic segments with specificity sort; no sibling static segments |
| Task creation/list | `/projects/:id/tasks` GET/POST; `/tasks` exports PUT/DELETE only | Creation needs project scope and the proposal discriminator |
| Lock header | Per endpoint (Lock column); reserve checks idempotency key first; results/evidence carry none; missing required → 428 | Platform treats a missing header as "skip check"; replays must stay idempotent (plan-review F1) |
| Error model | `{error, code, details[]}`; 400 shape / 422 rule / 409 state / 404 scope / 403 feature | Deterministic codes for UI and QA; platform lock 409 body kept as-is |
| Test naming | QA `TC-DELIVERY-NNN`, `TC-DELIVERY-EXEC-NNN`; OSS jest under `delivery_os/**/__tests__` | `.ai/qa/AGENTS.md` convention; ownership per RULES |
| Enterprise spec | Boundary only; execution sections "Pending — to be completed by EXEC" | Nobody from EXEC available; OSS must not decide their internals |

## Scope

**In scope:** two spec files, one hand-over note, a row in the OSS change folder index.

**Out of scope:** code, migrations, generation, AGENTS.md, master plan, QA test files, enterprise internals.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. OSS spec | Model, route map, API table UA-01…20, error catalogue, coverage, BC | Path freeze wrong for router → mitigated by cited code |
| 2. Enterprise spec + hand-over | Boundary contract, API/test list | EXEC disagrees → sections left pending for them |

**Prerequisites:** none. **Estimated effort:** one session.

## Open Risks & Assumptions

- UI-03 proposal contract and EXEC-04 bridge are not available; OSS freezes the v1 shapes per the master plan and lists them as assumptions.
- DTO executable source (`lib/contracts.ts`) lands in OSS-02 L1; the spec is authoritative for names and paths until then.

## Success Criteria (Summary)

- Other streams can code against paths, features and error codes without asking OSS.
- Every API path and key UI path has a named test owner.
