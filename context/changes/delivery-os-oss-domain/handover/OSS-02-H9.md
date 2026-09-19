# OSS-02 H9 hand-over — OSS-only domain, manual flow and capped gate (T018)

> The OSS-only path is proven end to end: project → manual baseline with a real screen attachment → requirements +
> design decisions → task ready → reserve → package export → result import, without any enterprise module. **Nothing in
> the master plan was ticked**; a human accepts Progress rows after reading the evidence below. Manual row 2.4 is open
> for the operator.

- **Commit:** gate and smoke ran on `418828d5588b28dd6b9c0b430f8bc0392479ea39` (`418828d55`, branch `dev-mateusz`). T018
  changes no code; the hand-over commit itself is added by the orchestrator.
- **Contract version:** `DELIVERY_CONTRACT_VERSION = 1` (`lib/contracts.ts:4`), 54 error codes, schema versions
  `delivery.baseline-content/v1`, `delivery.design-manifest/v1`, `delivery.requirements-proposal/v1`,
  `delivery.plan-proposal/v1`, `delivery.task-package/v1`, `delivery.result-manifest/v1`, `delivery.report/v1`; widget
  context `delivery_os.project.execution.v1`. Unchanged since the H4 hand-over (additive only).
- **Profile versions:** `react-vite@1`, `open-mercato-module@1`, `wordpress-theme@1` (unchanged).
- **Runner:** local mode (no compose `app` container); docker stack `omhack` (postgres :5442); dev server :3100 started
  with `apps/mercato/.env` → `OM_ENABLE_ENTERPRISE_MODULES=false` (also `_SSO`, `_SECURITY`, `_AGENTS` false).
- **Migration:** none new (`Migration20260919003425_delivery_os` from T006). No workspace or dependency change.

## What works (OSS-only)

| Surface | Content | Evidence |
|---|---|---|
| Routes R1–R16 | projects CRUD (R1–R4), detail (R5), baselines list/create (R6/R7), decisions (R8), tasks list/create/detail/update/archive (R9–R13), reserve (R14), package export (R15), result import (R16); all with `metadata`, `openApi`, frozen error body | 10 route files in the generated registry; live smoke; route jest suites |
| Commands | `delivery_os.projects.{create,update,delete}`, `tasks.{create,update,delete}`, `baselines.create`, `decisions.record`, `attempts.reserve`, `results.accept` | `command-loaders.generated.ts` |
| DI | `deliveryOsAttemptQueries` (`getAttempt`, `buildTaskPackage`, `listPendingDeliveries`), read-only | `di.generated.ts` → `delivery_os/di.register` |
| Events | `delivery_os.project.created`, `.baseline.approved`, `.task.updated`, `.evidence.recorded` | `events.generated.ts` → `delivery_os/events` |
| ACL | 8 features `delivery_os.{projects.view,projects.manage,baselines.approve,results.import,attempts.manage,attempts.reconcile,deploy.approve,release.approve}`; setup grants admin `delivery_os.*`, employee view/manage/import | `modules.generated.ts` imports `acl`, `setup` |
| Spot | `delivery_os.project.execution` (context `delivery_os.project.execution.v1`) in `extension-points.ts` | not part of `yarn generate` output — it is read by the module-facts generator; boundary pinned by `__tests__/module-registration.test.ts` |
| Entities | five tables `delivery_{projects,baselines,decisions,tasks,evidence}` | `entities.generated.ts` |

## Gate — exact commands and results (2026-09-19, sequential, foreground, one at a time)

Exit codes were captured with `echo "exit=$?"` after each command in the shell; outputs are in `/tmp/t018/<step>.log`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `OM_ENABLE_ENTERPRISE_MODULES=false yarn generate` | 0 | 1 turbo task; "All generators completed" in 9.3 s. Known harmless noise: `[OpenAPI] Bundle approach failed … ERR_IMPORT_ATTRIBUTE_MISSING` (Node 24, pre-existing) → static fallback. Turbo's strict env mode may not forward the shell variable; the effective value is `apps/mercato/.env:135` = `false`, and OSS-only is proven by the generated module list below. |
| 2 | `yarn turbo run build --filter=@open-mercato/core --concurrency=2` | 0 | `[build:core] built successfully`, 237 generated entry points, 10.0 s |
| 3 | `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` | 0 | `tsc --noEmit`, no diagnostics (incremental via `tsconfig.tsbuildinfo`; `__tests__` excluded by the core tsconfig — jest covers them) |
| 4 | `npx eslint packages/core/src/modules/delivery_os` | 0 | no findings (78 `.ts` files; only the generic Next "Pages directory cannot be found" notice) |
| 5 | `yarn workspace @open-mercato/core jest src/modules/delivery_os src/__tests__/module-decoupling.test.ts --maxWorkers=2` | 0 | **31 suites / 697 tests passed**, 0 failed, 1.97 s |
| 6 | `yarn i18n:check-sync` | 0 | "All translation files are in sync" (5 locales, 61 modules) |
| 7 | `yarn i18n:check-usage` (advisory) | 1 | 10 missing keys — **all ten are `delivery_os.audit.*` labels** (list in the patch requests); 7889 unused keys repo-wide (advisory, pre-existing) |
| 8 | `yarn template:sync` (check mode, advisory) | 1 | drift: `[DIFF] modules.ts` only (expected since T006; package-dependency sync passed) |
| 9 | `yarn workspace @open-mercato/core jest src/__tests__/optimistic-lock-editable-entities.test.ts --maxWorkers=2` | 0 | 110/110 — delivery_os is not listed yet (patch request below) |

**Generated registry check** (read only, `apps/mercato/.mercato/generated/`): `enabled-module-ids.generated.ts` lists
`delivery_os` and **none** of `record_locks`, `system_status_overlays`, `sso`, `security`, `agent_orchestrator`; no
generated file imports `@open-mercato/enterprise`. `api-route-shard.016.delivery_os.generated.ts` carries the ten route
files (`projects`, `projects/[id]`, `projects/[id]/baselines`, `projects/[id]/tasks`, `baselines/[id]/decisions`,
`tasks`, `tasks/[id]`, `tasks/[id]/attempts`, `tasks/[id]/package`, `tasks/[id]/results`); `command-loaders.generated.ts`
the ten command ids above; `events.generated.ts`, `di.generated.ts`, `entities.generated.ts` and `modules.generated.ts`
(`acl`, `events`, `setup`, `index`) the module surfaces.

No gate step found a defect, so no OSS file was changed.

## Live OSS-only smoke (:3100, admin@acme.com, 27/27 checks)

Script `/tmp/t018/live.ts` (not in the repo; run with `yarn run -T tsx /tmp/t018/live.ts`), full log
`/tmp/t018/live.log`. Condensed transcript (ids replaced by `:id`):

```
POST /api/auth/login -> 200 token ok
POST /api/delivery_os/projects -> 201 {"id":…,"updatedAt":"…03:40:15.675Z"}
POST /api/attachments (multipart image/png) -> 200 {"ok":true,"item":{"id":…,"fileName":"t018-screen.png",…}}
PUT /api/delivery_os/projects [lock] -> 200 {"ok":true,"updatedAt":"…15.804Z"}              # draftSpec with the real attachment id + sha256
PUT /api/delivery_os/projects [lock=old] -> 409 {"code":"optimistic_lock_conflict","currentUpdatedAt":"…15.804Z","expectedUpdatedAt":"…15.675Z"}
PUT /api/delivery_os/projects (no header) -> 200                                            # R3 lock is "platform" (header-optional) per the spec route map
POST /api/delivery_os/projects/:id/baselines (no header) -> 428 {"code":"optimistic_lock_required"}
POST /api/delivery_os/projects/:id/baselines [lock] -> 201 {"baselineId":…,"version":1,"contentHash":"25851c37…","duplicate":false}
POST /api/delivery_os/baselines/:id/decisions [lock] -> 201 {"activeBaselineId":null,…}      # requirements
POST /api/delivery_os/baselines/:id/decisions [lock] -> 201 {"activeBaselineId":":id",…}     # design → baseline becomes active
POST /api/delivery_os/projects/:id/tasks -> 201 ; PUT /api/delivery_os/tasks [lock] {status:ready} -> 200 {"status":"ready"}
POST /api/delivery_os/tasks/:id/attempts [lock] (no key) -> 400 {"code":"idempotency_key_required"}
POST /api/delivery_os/tasks/:id/attempts [lock][key] {mode:"automatic"} -> 400 {"code":"validation_failed","details":[{"path":"mode",…}]}
POST /api/delivery_os/tasks/:id/attempts [lock][key] -> 201 {"attemptId":"14505c5a…",…}
POST /api/delivery_os/tasks/:id/attempts [key] -> 200 {"attemptId":"14505c5a…",…}           # same attempt; register length 1
GET  /api/delivery_os/tasks/:id/package?attemptId=:id -> 200 {"schemaVersion":"delivery.task-package/v1",…}  (twice, identical)
GET  /api/delivery_os/tasks/:id/package?attemptId=<random> -> 404 {"code":"attempt_not_found"}
before: delivery_projects=1 delivery_baselines=1 delivery_decisions=2 delivery_tasks=1 delivery_evidence=0 task.updated_at=…03:40:16.401+00 attempts=1
after:  delivery_projects=1 delivery_baselines=1 delivery_decisions=2 delivery_tasks=1 delivery_evidence=0 task.updated_at=…03:40:16.401+00 attempts=1
POST /api/delivery_os/tasks/:id/results -> 201 {"evidenceId":"94b42e18…","duplicate":false,"taskStatus":"awaiting_review",…}
POST /api/delivery_os/tasks/:id/results -> 200 {"evidenceId":"94b42e18…","duplicate":true,…}   # evidence rows for task: 1
POST /api/delivery_os/tasks/:id/results (other manifest) -> 409 {"code":"result_conflict"}
--- cross-scope probe: project + task rows copied in SQL under a random foreign tenant/organization
GET /projects/:foreign, PUT /projects {id: foreign}, GET /projects/:foreign/baselines, GET /projects/:foreign/tasks,
GET /tasks/:foreign, GET /tasks/:foreign/package, POST /tasks/:foreign/attempts [lock][key], POST /tasks/:foreign/results,
GET /projects/<random uuid>, GET /tasks/<random uuid>  -> all 404 {"code":"not_found"}
GET /projects?search=T018 -> 200, own project listed, foreign project absent; foreign rows' updated_at / register unchanged
--- cleanup: evidence 1, tasks 1, decisions 2, baselines 1, projects 1 (+ foreign rows) deleted; DELETE /api/attachments?id= -> 200
SUMMARY 27/27 checks passed; no smoke records left
```

Values above are from the kept run (`/tmp/t018/live.log`, 2026-09-19 03:40 UTC). A grep of the last 400 lines of the
dev-server log `/tmp/omhack-dev.log` for `error|exception|delivery_os` after the run returned nothing. Audit-log rows
written by the commands during the smoke stay in `action_logs` (append-only by design).

## NOT RUN

- **Enterprise half of Progress 2.3** ("with enterprise the extension appears without an OSS contract change") — EXEC owns
  the enterprise widget/bridge; no delivery enterprise module exists on this branch. OSS side: the spot is declared,
  and `__tests__/module-registration.test.ts` + `module-decoupling.test.ts` (both green above) prove OSS never imports
  enterprise.
- Full-repo gate (`yarn build:app`, full `yarn test`, `yarn lint`) — deferred to OSS-06 (16 GB RAM rule, recorded decision).
- Playwright `TC-DELIVERY-*` — QA stream.
- Two-connection races (concurrent reserve with the same key, concurrent result import) — simulated on a mocked EM
  only; real races belong to QA TC-DELIVERY-006.
- Browser walk-through of the UI (2.4) — UI pages are not on this branch; manual row for the operator.

## Limitations

- R17–R22 (cancel, reconcile, generic evidence, deploy/release decisions, report) are not implemented — OSS-04/OSS-05.
  Also pending: claim, `link_workflow`, `mark_delivery` (command-bus only), attempt closing, `listPendingDeliveries` is
  empty in OSS-only (only the trusted executor sets `workflowRef`).
- Attachment checks are scope-only: a draft screen's attachment must exist in the same tenant/organization; hash, size
  and mime verification of the bytes is OSS-03 (`attachment_hash_mismatch` is reserved in the catalogue).
- Result acceptance seams `checkChangedPathsAllowed`, `checkArtifactAttachments`, `checkResultSizeLimits` currently
  pass (OSS-04).
- The R3/R4/R12/R13 lock is the platform one: a missing header is accepted (same as every `makeCrudRoute` entity), a
  stale one answers 409. UI must always send it (`CrudForm` does so automatically from `initialValues.updatedAt`). R7,
  R8 and R14 (new key) require it (`428`).
- The 428 message on R14 says "The project version header is required" although the task version is expected — render
  by `code`.
- R5 recomputes status from all baselines/tasks on every call (bounded by project size).
- Proposal sources (`requirements_proposal`, `plan_proposal`) answer `400 validation_failed`/`unsupported_source` until OSS-03.

## Master-plan Progress rows with evidence (not ticked)

| Row | Evidence |
|---|---|
| 2.1 DTO, cycles, project status tests; unknown manifest version rejected | jest 31 suites / 697 tests (`contracts`, `fixtures`, `dag`, `projectStatus`, `taskLifecycle`, `resultAcceptance` suites); `unsupported_schema_version` pinned in `contracts.test.ts` / `results.route.test.ts` |
| 2.2 API tenant/org isolation, ACL, updatedAt conflicts | route suites (`projects`, `tasks`, `decisions`, `attempts`, `results` — 403 per feature, scope 404, stale 409); live: foreign-scope rows and random ids → 404 on ten routes, list hides the foreign row, stale R3 → 409, R7 without header → 428 |
| 2.3 OSS-only build and smoke without enterprise | gate rows 1–5 above with enterprise off, generated module list without enterprise ids, live 27/27 smoke, `manualFlow.route.test.ts` in-process flow with real decisions. Enterprise half: NOT RUN (EXEC) |
| 2.4 (manual) operator flow in UI | open for the human; the API path the UI will use is proven by the smoke above |

## Patch requests for other owners

1. **UI (`delivery_os/i18n/**`) — missing audit label keys** reported by `yarn i18n:check-usage` (English fallbacks are
   in code; add to `en.json` and mirror to `pl`, `es`, `de`, `ko` so `i18n:check-sync` stays green):
   `delivery_os.audit.projects.create`, `delivery_os.audit.projects.update`, `delivery_os.audit.projects.delete`,
   `delivery_os.audit.tasks.create`, `delivery_os.audit.tasks.update`, `delivery_os.audit.tasks.delete`,
   `delivery_os.audit.baselines.create`, `delivery_os.audit.decisions.record`, `delivery_os.audit.attempts.reserve`,
   `delivery_os.audit.results.accept`.
2. **UI — error messages rendered by `code`.** Suggested keys `delivery_os.errors.<code>` for the 54 frozen codes:
   `validation_failed`, `idempotency_key_required`, `forbidden`, `not_found`, `attempt_not_found`,
   `optimistic_lock_conflict`, `idempotency_conflict`, `attempt_active`, `attempt_limit_reached`, `attempt_not_active`,
   `attempt_not_reconcilable`, `attempt_cancelled`, `attempt_closed`, `reconciliation_required`,
   `dependency_not_verified`, `task_not_ready`, `invalid_transition`, `result_conflict`, `subject_hash_mismatch`,
   `correction_limit_reached`, `payload_too_large`, `unsupported_schema_version`, `unknown_target_profile`,
   `foreign_reference`, `unknown_ac`, `unknown_test_id`, `cycle`, `foreign_dependency`, `path_not_allowed`,
   `duplicate_stable_id`, `invalid_comment_anchor`, `missing_acceptance_criteria`, `missing_render`,
   `temporary_url_only`, `missing_required_tests`, `attachment_scope_mismatch`, `attachment_hash_mismatch`,
   `hash_mismatch`, `baseline_not_approved`, `baseline_not_active`, `correlation_mismatch`, `baseline_mismatch`,
   `base_revision_mismatch`, `revision_kind_mismatch`, `manifest_required`, `reason_required`, `report_not_green`,
   `deployment_unverified`, `deployment_incomplete`, `revision_mismatch`, `deploy_decision_missing`, `invalid_revision`,
   `unsupported_evidence_kind`, `optimistic_lock_required`. Detail codes to render are listed in the
   `OSS-02-L1-L3-progress.md` addenda (T009–T016). The platform bodies (401, declarative 403, 5xx) are not frozen.
3. **ACL titles** — English titles live in `acl.ts` like every core module (customers); no i18n key is required by the
   platform. If UI wants localized role-editor labels, suggested keys `delivery_os.features.<feature-suffix>` (8 keys:
   `projects.view`, `projects.manage`, `baselines.approve`, `results.import`, `attempts.manage`, `attempts.reconcile`,
   `deploy.approve`, `release.approve`); OSS would then switch `acl.ts` titles on request.
4. **Template sync (owner: EXEC / repo maintainers)** — `yarn template:sync` reports `[DIFF] modules.ts` because
   `apps/mercato/src/modules.ts:107` registers `delivery_os`. Decide per the master plan (do not activate the hackathon
   module in the create-app template): either add `delivery_os` to the template-sync exclusion for this line in
   `scripts/template-sync.ts`, or accept the drift on this branch. Never run `template:sync:fix` blindly — it would copy
   the registration into `packages/create-app/template`.
5. **Optimistic-lock coverage guard (owner: core maintainers)** — add to `moduleEntities` in
   `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts`:
   ```ts
     delivery_os: ['DeliveryProject', 'DeliveryTask'],
   ```
   Verified on a temporary copy: 114/114 tests pass (4 new: `updated_at` + reader resolution for both). Baselines,
   decisions and evidence are append-only and correctly excluded.

## For the next OSS tasks

- OSS-03 starts from this state: add the proposal sources to R7/R10, attachment byte verification behind the injectable
  reader, and append the new codes additively with the pinned catalogue test.
- Re-run the smoke after OSS-03/04 by extending `/tmp/t018/live.ts` (copy it into the next task folder under `/tmp`).
