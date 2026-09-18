# OSS-01 hand-over — new APIs and planned tests (T003)

- **Specs:** OSS [`.ai/specs/2026-09-18-delivery-os-hackathon.md`](../../../../.ai/specs/2026-09-18-delivery-os-hackathon.md) · enterprise boundary [`.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md`](../../../../.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md)
- **Contract version:** `DELIVERY_CONTRACT_VERSION = 1` (names and paths frozen; executable zod schemas land in `delivery_os/lib/contracts.ts` with OSS-02 L1)
- **Consumers:** UI (screens, error i18n keys), EXEC (internal commands, DI query, spot), QA (TC-DELIVERY specs)
- **Master-plan link:** this delivers the Phase 1 *Contract* item "two specs referencing the plan, with model/API, integration coverage and Migration & BC". No Progress row covers the specs alone; they are a prerequisite for Progress 2.1–2.3. Acceptance is recorded by a human.

## New APIs (base `/api/delivery_os`)

Paths were checked against the router and `makeCrudRoute`. Project and task update/delete use the platform collection-level PUT (`id` in the body) and DELETE (`?id=`). See the OSS spec, *Route resolution*.

| # | Method | Path | Feature (`delivery_os.*`) | Lock header | Lands in |
|---|---|---|---|---|---|
| R1 | GET | `/projects` | projects.view | — | OSS-02 |
| R2 | POST | `/projects` | projects.manage | — | OSS-02 |
| R3 | PUT | `/projects` (`id` in body) | projects.manage | project | OSS-02 |
| R4 | DELETE | `/projects?id=` | projects.manage | project | OSS-02 |
| R5 | GET | `/projects/:id` | projects.view | — | OSS-02 |
| R6 | GET | `/projects/:id/baselines` | projects.view | — | OSS-02 |
| R7 | POST | `/projects/:id/baselines` (`manual` / `requirements_proposal`) | projects.manage / results.import | project, required | OSS-02 (manual), OSS-03 (proposal) |
| R8 | POST | `/baselines/:id/decisions` | baselines.approve | project, required | OSS-02, OSS-03 |
| R9 | GET | `/projects/:id/tasks` | projects.view | — | OSS-02 |
| R10 | POST | `/projects/:id/tasks` (`manual` / `plan_proposal`) | projects.manage / results.import | proposal: project, required | OSS-02 (manual), OSS-03 (proposal) |
| R11 | GET | `/tasks/:id` | projects.view | — | OSS-02 |
| R12 | PUT | `/tasks` (`id` in body) | projects.manage | task | OSS-02 |
| R13 | DELETE | `/tasks?id=` | projects.manage | task | OSS-02 |
| R14 | POST | `/tasks/:id/attempts` (`Idempotency-Key`) | attempts.manage | task, required for a new key | OSS-02 |
| R15 | GET | `/tasks/:id/package?attemptId=` | attempts.manage | — | OSS-02 |
| R16 | POST | `/tasks/:id/results` | results.import | — (idempotent) | OSS-02 (basic), OSS-04 (full) |
| R17 | POST | `/tasks/:id/attempts/:attemptId/cancel` | attempts.manage | task, required | OSS-04 |
| R18 | POST | `/tasks/:id/attempts/:attemptId/reconcile` | attempts.reconcile | task, required | OSS-04 |
| R19 | POST | `/projects/:id/evidence` | results.import | — | OSS-04, OSS-05 |
| R20 | POST | `/projects/:id/deploy-decisions` | deploy.approve | project, required | OSS-05 |
| R21 | POST | `/projects/:id/release-decisions` | release.approve | project, required | OSS-05 |
| R22 | GET | `/projects/:id/report?baselineId=&revision=` | projects.view | — | OSS-05 |

Errors: `{ error, code, details[] }` (the lock 409 keeps the platform body). The code catalogue is in the OSS spec. Internal commands with no route (enterprise only): `delivery_os.attempts.reserve` (`automatic`), `delivery_os.attempts.claim`, `delivery_os.attempts.link_workflow`, `delivery_os.attempts.mark_delivery`, `delivery_os.results.accept`.

## Planned tests per layer

Paths are under `packages/core/src/modules/delivery_os/`. Run jest with `yarn workspace @open-mercato/core jest <path> --maxWorkers=2`.

| Layer | Owner | Files | Lands in |
|---|---|---|---|
| Contracts / fixtures | OSS | `lib/__tests__/contracts.test.ts`, `lib/__tests__/hash.test.ts`, `data/__tests__/validators.test.ts`; fixtures `lib/fixtures/*.v1.json` (positive and negative) | OSS-02 L1 |
| Domain rules (pure) | OSS | `lib/__tests__/{dag,taskLifecycle,allowedPaths,attempts,resultAcceptance,baseline,designReview,proposals,traceability,projectStatus,deliveryReport}.test.ts` | OSS-02 … OSS-05 |
| Commands | OSS | `commands/__tests__/{projects,tasks,baselines,decisions,attempts,results,evidence,manualFlow}.test.ts` | OSS-02 … OSS-05 |
| Routes | OSS | `api/__tests__/{projects.route,package.route}.test.ts` (feature guards, 404 for foreign scope, GET without writes) | OSS-02 |
| Integration (Playwright) | QA | `__integration__/TC-DELIVERY-001…012.spec.ts` (API R1–R22, OSS-only manual flow, two key UI paths) | QA-02 … QA-05 |
| Enterprise integration | QA/EXEC | `delivery_agents/__integration__/TC-DELIVERY-EXEC-001…005.spec.ts` | EXEC-04 / QA |

## Limitations and assumptions

- Documentation only. No module code, migrations or `yarn generate` in this task.
- Assumption: the proposal contracts (`RequirementsProposal v1`, `PlanProposal v1`, `DesignManifest v1`) are frozen by OSS per the master plan, before UI-03 confirms them. Changes after the hand-over are additive only.
- Deviation from the master plan's literal paths: `PUT/DELETE /projects/:id` and `/tasks/:id` became the platform collection-level PUT/DELETE. `:id` routes keep GET detail only.
- Error codes deliberately renamed vs the breakdown (the spec is authoritative): `attempt_limit` → `attempt_limit_reached`, `task_blocked` → `task_not_ready`, `active_attempt` → `attempt_active`. Package export uses `delivery_os.attempts.manage`.
- `verified` is reachable only through review evidence (`POST /projects/:id/evidence`, `kind: review`, `verdict: approved`) with proof for every AC on the result revision. R12 cannot set it.
- Status split: 400 for shape (`validation_failed`), 422 for domain rules, 409 for state conflicts, 428 when a required lock header is missing.
- The enterprise execution sections are pending for EXEC. The TC-DELIVERY ids are proposals for QA.
