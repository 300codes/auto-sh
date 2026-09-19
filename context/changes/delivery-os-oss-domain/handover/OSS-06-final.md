# OSS-06 — final hand-over and whole-stream evidence index (T039)

Nothing in this file ticks a master-plan Progress row. Rows are accepted by a human after seeing the evidence below;
the master plan under `context/changes/autonomous-software-delivery/` was not edited.

## 1. Final commit and versions

- **Commit the evidence was collected on:** `af7680f7db61aab6782e33b57bae1972ccb6e0a1` (`af7680f7d`, `test(delivery): OSS-06 review the
  migration on an ephemeral database and audit append-only history`), branch `dev-mateusz`. The commit that adds this file
  is made by the orchestrator right after; use `git log -1 -- context/changes/delivery-os-oss-domain/handover/OSS-06-final.md`
  for its SHA. It changes no code, so the code state equals `af7680f7d`.
- **Gate provenance:** the full gate in section 3 ran on `35e77c4dd` plus the OSS-06 fix (committed as `0382f9ea2`). Later commits
  (`ababb9433` FLOW-F0 contracts/fixtures, `af7680f7d` append-only audit) are additive tests/docs/schemas; the delivery_os suite
  was re-run on `af7680f7d` (section 3, last row).
- **DTO v1** (frozen; `lib/contracts.ts`): TaskPackage, ResultManifest, baseline/proposal, sourceRevision (git/snapshot),
  widget context, error body with the pinned 54-code catalogue (`lib/__tests__/contracts.test.ts`). Only additive
  clarifications were made after the H4 freeze (listed in `OSS-02-L1-L3-progress.md`). FLOW-F0 adds separate versioned flow documents
  (`lib/flowTemplates.ts`, `lib/flowRules.ts`, fixtures under `lib/fixtures/flow/`) and does not touch v1.
- **Target profiles** (`lib/targetProfiles.ts`): `react-vite@1`, `open-mercato-module@1`, `wordpress-theme@1`.
- **Routes:** frozen v1 map R1–R22 (`OSS-01-api-and-tests.md`); no route removed or renamed.

## 2. Per-task commits

| Task | Commits (oldest first within task) |
|---|---|
| OSS-01 | `6d4bff6a0` readiness, `b807326a1` React Vite base + sample AC, `9341d9a6d` specs and enterprise boundary |
| OSS-02 | `b3c4a4510` contracts + hash, `47f9047c7` profiles + fixtures, `9915b3853` entities/migration/validators, `f15db049c` DAG/lifecycle, `4922ec306` attempt reducers, `0b10a5087` ACL/events/extension point, `b23615b73` project commands, `1b22604cf` task commands, `2a5b4178f` baseline + decisions, `f843b35c6` reserve + package, `aa5ad676a` result acceptance, `e70ed7457` routes R1–R13, `ca88c3484` routes R14–R16, `418828d55` manual flow test, `a9c295d72` gate + H9 |
| OSS-03 | `b9972c5f3` allowedPaths/proposal rules, `6a2447c2a` design + attachments, `61becd795` requirements import, `a42d1f2ed` plan import, `2d184b1f1` scope-change/immutability tests |
| OSS-04 | `47ca5acbf` claim/link/mark_delivery, `09b5de988` result acceptance rules, `3d93b6af1` cancel, `3a23d593b` reconcile, `c24ac8ba8` evidence, `f735d5a15` review evidence, `124828233` fake-executor proof (H21) |
| OSS-05 | `81eb40a01` report rules, `b7ec5d4c8` report route, `26d7e4dab` deploy decision, `f25d29fee` release decision, `3b2a03d59` publication chain + H26 |
| OSS-06 | `35e77c4dd` final regression suite, `0382f9ea2` gate fix + OSS-only, `af7680f7d` migration review + append-only audit, this file (T039) |
| FLOW-F0 | `ababb9433` contract delta and fixtures (`FLOW-F0-contracts.md`) |

The T001–T038 per-task plans are in `context/changes/asd-oss-t0NN-*/`.

## 3. Full gate results (from `OSS-06-gate.md`)

Runner: **local** (macOS, Node 24.15, yarn 4; no compose `app` container, so not Docker mode). One heavy command at a time, turbo
`--concurrency=2` (tests `1`), jest `maxWorkers: 2`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `yarn generate` | 0 | PASS (OpenAPI bundle `ERR_IMPORT_ATTRIBUTE_MISSING` noise is pre-existing on Node 24) |
| 2 | `yarn turbo run build --concurrency=2 --filter=./packages/*` | 0 | PASS 38/38 |
| 3 | `yarn i18n:check-sync` | 0 | PASS |
| 4 | `yarn i18n:check-usage` | 1 | **FAIL** — 17 missing `delivery_os.audit.*` keys (patch P2) |
| 5 | `yarn turbo run typecheck --concurrency=2` | 0 | PASS 38/38 |
| 6/6b/6c | turbo lint (core has no lint script → no task ran) / repo lint / `eslint` on `delivery_os` | 0 | PASS, 0 findings in delivery_os |
| 7 | `yarn turbo run test --concurrency=1 --filter='!open-mercato-docs' --continue` | 1 | **FAIL** — 42/45 tasks passed; the failures are in the table below |
| 7b | core jest: delivery_os + explicit-sort + module-decoupling + optimistic-lock-editable-entities (after fix F1) | 0 | PASS 56 suites / 1357 tests |
| 8b | `yarn build:app` | 0 | PASS (Next.js 16.3.3) |
| 9–13 | OSS-only: generate + core build with all enterprise flags false, registry check, import grep, decoupling test | 0 | PASS — no enterprise module in the registry, 0 enterprise imports in delivery_os |
| — | Re-run on `af7680f7d`: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` | 0 | **PASS 56 suites / 1286 tests** (delivery_os only; step 7b's 1357 also counted three non-delivery core suites) |

**The gate is NOT fully green.** Failures at step 7 and their owners:

| Suite | Owner | Cause |
|---|---|---|
| `core/explicit-sort-comparators` | OSS | Fixed in F1 (`compareCodeUnits`, hashes unchanged); green in 7b |
| `core/auth/acl-feature-catalog.i18n` | auth i18n | 8 `delivery_os` ACL features lack titles → P1 |
| `core/warranty_claims/quantity` (2 tests) | not delivery_os | machine locale formats `2.5` as `2,5` |
| `cli/module-facts.bc-guard` | UI stream | `delivery_os.projectExecution` host points to a page that does not exist on this branch → P3 |
| `create-mercato-app/template-modules-parity` | template owner | `delivery_os` missing from template `modules.ts` → P4 |
| `create-mercato-app/release-upgrade-skill-contract` | release/changelog | changelog upgrade window date, unrelated |

Not run: `open-mercato-docs` (Docusaurus site build, RAM rule), Playwright `yarn test:integration` (QA-owned).
Migration review on a throw-away DB and the append-only audit: `OSS-06-migration-and-history.md`.

## 4. Test evidence per master-plan Progress row

All commands are run from the repo root and are prefixed `yarn workspace @open-mercato/core jest` with `--maxWorkers=2`; paths are
under `packages/core/src/modules/delivery_os/` (given as `src/modules/delivery_os/...` in the command).

| Row | Evidence (test file) | Command tail |
|---|---|---|
| 2.1 DTOs, cycles, project status; unknown manifest version rejected | `lib/__tests__/contracts.test.ts`, `dag.test.ts`, `projectStatus.test.ts`, `taskLifecycle.test.ts`, `resultAcceptance.test.ts` (`unsupported_schema_version`) | `src/modules/delivery_os/lib` |
| 2.2 tenant/org isolation, ACL, `updatedAt` conflicts | `api/__tests__/projects.route.test.ts`, `tasks.route.test.ts`, `decisions.route.test.ts`, `finalRegression.route.test.ts` (2 tenants × 2 orgs, stale approval) | `src/modules/delivery_os/api` |
| 2.3 build + smoke OSS-only | gate steps 9–13 above; `__tests__/module-registration.test.ts`, `finalRegression.route.test.ts` (manual_handoff with enterprise off) | `src/modules/delivery_os/__tests__` |
| 3.1 same baseline schema; no ready without AC/render/decisions | `commands/__tests__/baselines.test.ts`, `tasks.test.ts`, `scopeChange.test.ts` | `src/modules/delivery_os/commands` |
| 3.2 approved version immutable; stale results for new scope rejected | `commands/__tests__/scopeChange.test.ts`, `executorFlow.test.ts` (QA scenario b) | same |
| 3.3 foreign references, excess files, bad hashes; re-import idempotent | `commands/__tests__/attachments.test.ts`, `baselines.test.ts`, `lib/__tests__/designReview.test.ts`, `api/__tests__/baselines.route.test.ts` | `src/modules/delivery_os` |
| 3.6 proposal manifest validation, idempotent re-import | `lib/__tests__/proposals.test.ts`, `allowedPaths.test.ts`, `commands/__tests__/planImport.test.ts`, `baselines.test.ts` | same |
| 4.1 executor once; duplicate result no duplicate evidence | `commands/__tests__/executorFlow.test.ts` (main flow, scenario a), `attempts.test.ts`, `results.test.ts`, `api/__tests__/attempts.route.test.ts`, `results.route.test.ts` | same |
| 4.2 wrong baseline/commit, foreign tenant, cancelled, unknown after restart block acceptance | `executorFlow.test.ts` (scenarios b, c), `results.test.ts`, `cancel.route.test.ts`, `reconcile.route.test.ts`, `finalRegression.route.test.ts` | same |
| 4.7 recovery, no CLI restart; concurrent replay no duplicate effect | `commands/__tests__/reconcile.test.ts`, `executorFlow.test.ts`, `results.test.ts` (unique-violation race), `finalRegression.route.test.ts` (duplicate callback, restart) | same |
| 5.1 AC not passed without test on right commit/baseline; missing scan/preview blocks | `commands/__tests__/publicationFlow.test.ts`, `lib/__tests__/deliveryReport.test.ts`, `api/__tests__/report.route.test.ts`, `deployDecision.route.test.ts`, `releaseDecision.route.test.ts` | same |
| 6.1 gate and runner recorded | `OSS-06-gate.md` + section 3 (**not green**, see failures) | — |
| 6.2 OSS-only, cross-tenant, stale approval, duplicate callback, restart, manual_handoff | `api/__tests__/finalRegression.route.test.ts` (five `6.2` describes) + gate steps 9–13 | `src/modules/delivery_os/api/__tests__/finalRegression.route.test.ts` |
| 6.3 no hidden unknown/failure; history intact | `commands/__tests__/appendOnly.test.ts`; `lib/__tests__/deliveryReport.test.ts` (FAIL/skipped/not_run never PASS); migration review in `OSS-06-migration-and-history.md` | `src/modules/delivery_os/commands/__tests__/appendOnly.test.ts` |

Only what unit/route tests with an in-memory store and the live smokes in the H9/H14/H21/H26 hand-overs prove is claimed. Real-DB
concurrency is QA's (TC-DELIVERY-006).

## 5. Manual rows deliberately left unticked

2.4, 3.4, 3.5, 4.5, 4.6, 5.4, 6.4, 6.5 — human/operator acceptance (or joint items with EXEC/UI/QA). The OSS-side ingredients exist
(export + manual flow, both baseline inputs, review→`changes_requested`→new attempt, `completionDelivery`/`stopConfirmation`
fields, R22 rows with evidence links, R20/R21) but no agent ticks them. Rows 2.2–2.3, 3.x, 4.x and 5.1 are also only "evidence
present": the acceptance mark stays with the human.

## 6. Limitations

- **Deployment evidence is fixture-level.** The publication chain (`publicationFlow.test.ts`, H26 smoke) uses recorded
  `deployment` evidence rows; there is no real preview target and no live probe by OSS (EXEC/QA record real ones).
- **No preview target** was available to OSS; row 5.2/5.3 are not OSS rows.
- **Playwright coverage is with QA** (`TC-DELIVERY-*`); OSS delivered jest route tests only.
- **Workflow side is with EXEC:** OSS exposes `link_workflow`, `mark_delivery`, `listPendingDeliveries` and no workflow engine import.
  There is no `listOpenAttempts` query (request it from OSS if needed).
- Route tests use an in-memory store: SQL-level rewrites are covered by the static scan and the migration review, not by runtime.
- FLOW addendum: only F0 (contracts, schemas, fixtures, `checkFlowGate`) is done. **F1–F4 are not implemented**; fresh estimate in
  `FLOW-F0-contracts.md` (F1 ≈10 h, F2 ≈8 h, F3 ≈4 h, F4 ≈4 h). The v1 routes do not yet call `checkFlowGate`.

## 7. Consolidated patch requests for other owners

- **P1 auth i18n** — `auth.acl.features.delivery_os.{projects.view,projects.manage,baselines.approve,results.import,attempts.manage,attempts.reconcile,deploy.approve,release.approve}` in `packages/core/src/modules/auth/i18n/{en,pl,es,de,ko}.json`; en values equal the `acl.ts` titles (exact texts in `OSS-06-gate.md`).
- **P2 UI i18n (`delivery_os/i18n/**`)** — 17 `delivery_os.audit.*` labels (`projects.{create,update,delete}`, `tasks.{create,update,delete,import_plan}`, `baselines.{create,import_requirements}`, `decisions.{record,deploy,release}`, `attempts.{reserve,cancel,reconcile}`, `results.accept`, `evidence.record`; also `attempts.{claim,link_workflow,mark_delivery}` per H21) in all five locales.
- **UI error codes** — `delivery_os.errors.<code>` for the 54 frozen codes (list in `OSS-02-H9.md`) plus detail codes (`OSS-04-H21.md`), and the R20/R21 keys and blocker/status labels in `OSS-05-H26.md`; unknown codes fall back to `error`.
- **P3 UI** — page `backend/delivery/projects/[id]/page.tsx` must bind `extensionPoints.hosts.projectExecution`; then re-run `yarn workspace @open-mercato/cli jest src/lib/generators/__tests__/module-facts.bc-guard.test.ts --maxWorkers=2`.
- **P4 template sync** — do not run `template:sync:fix` blindly; either exclude the `delivery_os` line in `scripts/template-sync.ts` or accept the drift (decision belongs to the maintainers; the template parity test currently fails).
- **Optimistic-lock registration** — add `delivery_os: ['DeliveryProject', 'DeliveryTask']` to `moduleEntities` in `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts` (verified 114/114 on a temporary copy; baselines/decisions/evidence are append-only).
- **EXEC bridge call order** — `reserve` (stable idempotency key, `trustedExecution`) → `startWorkflow` → `link_workflow` → `claim` with a worker ref stable across restarts (run the CLI only if `changed === true`) → executor reads `buildTaskPackage` → `results.accept` → on `evidence.recorded` with `completionDelivery:'pending'` signal then `mark_delivery`; on start `listPendingDeliveries`; never re-run the CLI for an unknown attempt, reconcile `unknown` instead (full text in `OSS-04-H21.md`). EXEC records preview as `deployment` evidence and never calls R20/R21.
- **QA TC-DELIVERY candidates** — 003/004 (baseline and import smoke, `OSS-03-H14.md`), 006 (parallel replay on a real DB), 007 (cancel, foreign baseline, unknown after restart), 009 (publication chain and revision-change voiding, `OSS-05-H26.md`); for FLOW, the F0 negative fixtures list the F1/F2 integration cases (`FLOW-F0-contracts.md`).

## 8. A1 — why the module lives in `packages/core`

The track rule says "do not modify Open Mercato core — build an overlay". The approved master plan (not re-decidable by this
stream) places the module at `packages/core/src/modules/delivery_os/`. Mitigation: the change is strictly additive — a new
self-contained module folder, and the only edit to an existing file is one registration entry in `apps/mercato/src/modules.ts`.
No core behaviour, entity, route or contract of an existing module was changed (F1's `compareCodeUnits` is inside delivery_os).
The enterprise agent layer is a separate package. Please be ready to explain this to the judges.

## 9. Demo talking points — "the agent proposes, the system decides"

- **Agent (trusted execution, no human session) may:** reserve an attempt with a stable idempotency key, claim it, link the workflow,
  read the TaskPackage, submit a result manifest, mark completion delivery, record evidence (tests, screenshots, scans, deployment),
  and post an agent review such as `changes_requested`. Proposals (requirements, plan) are only imported, validated and never
  self-approved.
- **System decides deterministically, without a human:** schema/version checks, cycle and foreign-scope rejection, allowedPaths,
  AC→test mapping, hash binding to baseline and revision, duplicate result = same evidence, unknown state after restart blocks
  automatic re-run, report status computed from evidence (FAIL/skipped/not_run never PASS), `verified` only through review evidence
  with proof on the right revision.
- **Human only (feature + signed-in user):** approving requirements/design (`baselines.approve`), publication consent R20
  (`deploy.approve`), release acceptance R21 (`release.approve`), manual-check review, and reconciling an unknown attempt with
  external evidence. A changed revision voids earlier consent (`revision_mismatch`). Agents never call R20/R21.
- Failure paths to show: replay with the same key (200, no second attempt), the same key with another body (`idempotency_conflict`),
  a result for an old baseline after scope change, a foreign tenant answering 404, an unverified deployment blocking release
  (`deployment_unverified`).
- Honest framing: manual flow works without enterprise; the publication proof uses recorded evidence, live preview belongs to EXEC/QA.
