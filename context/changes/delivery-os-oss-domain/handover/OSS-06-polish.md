# OSS-06 polish — gate patch requests and reviewer findings (T049)

Scope: close the OSS-06 gate patch requests that OSS may touch (P1, P4, authorised), verify and fix the reviewer
findings of OSS-01…06 that can be fixed without breaking the frozen v1 contract, and triage every remaining note.
No wire format, error code, frozen enum, route, migration or document hash changed. Nothing here ticks a master-plan
Progress row; the evidence is listed for a human.

## 1. What changed (files)

| Area | Files | Change |
|---|---|---|
| A1 auth ACL i18n (authorised) | `packages/core/src/modules/auth/i18n/{en,pl,es,de,ko}.json` | 11 `auth.acl.features.delivery_os.*` titles (8 v1 + `flow.manage`, `stages.approve`, `comments.import`); en = `acl.ts` titles, pl translated, es/de/ko English fallback like the neighbouring keys |
| A2 template parity (authorised) | `packages/create-app/template/src/modules.ts` | one line `{ id: 'delivery_os', from: '@open-mercato/core' }` (only diff of `yarn template:sync:fix`) |
| B2 replay fingerprint | `lib/attempts.ts` | replay only when payload hash **and** `mode`, `baselineId`, `baselineHash`, `baseRevision` match; else the frozen `409 idempotency_conflict`; stored `payloadHash` untouched, old attempts still replay |
| B4 stable paging | `commands/attemptQueries.ts` | `listPendingDeliveries` keyset on `id` (no offset), DI signature unchanged |
| B5 archive event | `commands/tasks.ts` | `tasks.delete` emits `delivery_os.task.updated` after the CRUD side effect |
| B6 catalogued issues | `data/validators.ts` | three `recordEvidenceSchema` cross-field rules use `addDeliveryIssue(…, 'validation_failed', …)` (detail code `validation_failed` instead of zod `custom`; top-level code and status unchanged) |
| B7 null vs undefined | `commands/tasks.ts` | `countCorrectionRounds` uses `manualCheckId == null` |
| B8 gate + naming | `lib/taskLifecycle.ts`, callers in `commands/{tasks,evidence,reconcile,attempts}.ts` | `correction_limit_reached` allows only `cancelled` (dead `blocked` exemption removed, matches the spec row); `TransitionContext.statusReason` → `currentStatusReason` (lib-internal type) |
| B9 canonical audit diff | `commands/projects.ts` | `changedProjectKeys` compares `canonicalize()` output (fallback `JSON.stringify` if a value is not canonical JSON) |
| B10 fixtures ESM | `lib/fixtures/index.ts`, `lib/fixtures/flow/index.ts` | JSON imports carry `with { type: 'json' }` (jest, typecheck and Next accept it). The core esbuild target `node18` still strips the attribute → **P5** below |
| Review race (T029) | `commands/evidence.ts` | `recordReviewInTransaction` takes the project task locks before loading the task evidence and the replay lookup |
| R19 reason (T029) | `api/projects/[id]/evidence/route.ts`, `api/schemas.ts` | response gains optional `taskStatusReason` (additive, present with `taskStatus`) |
| Plan import (T022) | `commands/planImport.ts` | draft `acTestMap` merge keeps entries of AC added after the parent baseline; a leftover unique violation answers `409 idempotency_conflict` / `concurrent_import` instead of a raw 500 |
| Report order (T032) | `commands/reportQueries.ts` | foreign/unknown baseline → 404 before the revision-kind 422 |
| Deprecation (T019) | `lib/targetProfiles.ts` | `isPathWithinProfileRoots` marked `@deprecated` (runtime uses `allowedPaths.ts`) |
| Test hardening (T036) | `api/__tests__/finalRegression.route.test.ts` | project archive asserts `409 reconciliation_required`, not just the status |
| Spec | `.ai/specs/2026-09-18-delivery-os-hackathon.md` | 428 ownership and R7/R10 feature check, `getAttempt` throw, keyset note, `change` kind reserved, R19 `taskStatusReason`, new “Known limitations after the OSS-06 polish”, changelog |
| Smoke script | `handover/smoke/live-h9-manual-flow.ts` | the H9 live smoke committed (password from `OM_SMOKE_PASSWORD`), re-run today 27/27 |

Tests added or adjusted: `lib/__tests__/attempts.test.ts` (4 conflict cases + identical replay), `lib/__tests__/taskLifecycle.test.ts`
(escalated task: only `cancelled`; terminal-ancestor invariant; retitled propagation test), `commands/__tests__/tasks.test.ts`
(archive emits `task.updated`; `manualCheckId: null` counts like absent), `data/__tests__/validators.test.ts` (catalogued detail
codes), `commands/__tests__/attemptQueries.test.ts` (keyset options; mid-scan `updatedAt` change neither skips nor duplicates),
`api/__tests__/report.route.test.ts` (404 before 422), `commands/__tests__/projects.test.ts` (key order is not a change),
`commands/__tests__/planImport.test.ts` (kept draft mapping; leftover unique → 409), `commands/__tests__/evidence.test.ts`
(lock before read; replay after lock writes nothing), `api/__tests__/evidence.route.test.ts` (`taskStatusReason` key; body
`trustedExecution` ignored, stored `source: 'manual'`), `commands/__tests__/baselineTestKit.ts` (`$gt` on strings).

Existing v1 expectations changed (justified): `taskLifecycle.test.ts` line 193 pinned the dead `blocked` exemption that the spec
contradicts; `evidence.route.test.ts` key list gains the additive `taskStatusReason`; `planImport.test.ts` lost the branch that
asserted a raw `23505` escaping as 500. No fixture file changed.

## 2. Commands and results (runner: local, macOS, Node 24.15, yarn 4; one heavy command at a time)

| Command | Result |
|---|---|
| `yarn workspace @open-mercato/core jest src/modules/delivery_os src/modules/auth/__tests__/acl-feature-catalog.i18n.test.ts src/__tests__/module-decoupling.test.ts --maxWorkers=2` | **PASS 67 suites / 1465 tests** |
| `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` | PASS |
| `yarn i18n:check-sync` | PASS (61 modules in sync) |
| `npx eslint packages/core/src/modules/delivery_os --ext .ts,.tsx` | 0 findings |
| `node --import tsx --test src/lib/template-modules-parity.test.ts` (create-app; the package uses `node:test`, not jest) | PASS 2/2 |
| `yarn workspace @open-mercato/core build` | PASS; `dist/.../fixtures/index.js` still fails under plain Node ESM (`ERR_IMPORT_ATTRIBUTE_MISSING`) because esbuild target `node18` strips the attribute; with `target: 'node22'` in `packages/core/build.mjs` the same import loads (18 exports) — tested and reverted, see P5 |
| `yarn run -T tsx handover/smoke/live-h9-manual-flow.ts` against http://localhost:3100 (admin@acme.com) | **27/27** (R1–R5, R6/R7 428 and 201, decisions, R12, R14 replay/conflict, R15 GET writes nothing, R16 duplicate/conflict, cross-scope 404 ×10, cleanup) |

## 3. Reviewer-note triage (117 notes, non-FLOW tasks)

Legend: **earlier** = already fixed before T049 · **now** = fixed in T049 · **ok** = acceptable as is · **limit** = documented limitation (spec “Known limitations after the OSS-06 polish” or this file) · **spec** = spec wording corrected · **FP** = false positive.

| # | Note (short) | Verdict | Reason / where |
|---|---|---|---|
| T001-1 | readiness: foreign containers wording | ok | historical readiness note; some foreign `svc-*` containers auto-restarted and stopped again before the first gate artefact — recorded here, no behaviour |
| T001-2 | readiness: exact test command | ok | recorded: reruns use `yarn turbo run test --concurrency=2 -- --maxWorkers=2` |
| T002-1 | `rawReportHash` not reproducible | limit | integrity hash of one run's artifact; the bridge must not compare it across reruns |
| T002-2 | demo repo `test:report` duplicates reporter path | ok | outside this repo (`../delivery-demo-react`), cosmetic |
| T003-1 | `change` decision kind dropped | spec + limit | reserved, deliberately unshipped; a scope change is a new baseline; additive if ever needed |
| T003-2 | R7/R10 feature from body `source` | spec | sentence added to API Contracts intro |
| T003-3 | `428` not a platform code | spec | ownership and R3/R4/R12/R13 behaviour stated |
| T003-4 | enterprise execute route must build a request-less ctx | ok | enterprise spec is Marcin's; restated in §4 |
| T003-5 | “keeps GET detail only” / “H4” wording | earlier | the sentence is gone; H4 is the hand-over gate name |
| T004-1 | multi-task cycle test | earlier | `proposals.test.ts:229`, `planImport.test.ts` (A→B→A → `422 cycle`) |
| T004-2 | integer-like keys in canonical JSON | limit | `{"2","10","a","b"}` order verified today; fixing changes hashes → v2 |
| T004-3 | code-name mapping for UI/QA | earlier | `OSS-02-H9.md` |
| T004-4 | `exceedsDepth` shared references | ok | only parsed JSON reaches it in practice |
| T005-1 | fixtures JSON under plain Node ESM | now + P5 | source attribute added; build target patch verified, needs build owner |
| T005-2 | double `base_revision_mismatch` detail | limit | two details = wire change → v2 |
| T005-3 | `react-vite@1` roots exclude config files | limit | v2 profile |
| T006-1 | `override name` in migration | ok | generator output, harmless |
| T006-2 | entity columns vs task wording | earlier | hand-overs list the deviations |
| T006-3 | three plain `ctx.addIssue` | now | B6 |
| T007-1 | `blocked` exemption in limit gate | now | B8 |
| T007-2 | `statusReason` ambiguity | now | `currentStatusReason` |
| T007-3 | propagation ignores running descendants | FP | unreachable: reserve rejects `dependency_not_verified`, `dependsOnTaskIds` editable only before any attempt, `verified` terminal; invariant test added |
| T007-4 | progress shape naming | earlier | hand-over names `{ proven, total, unit, percent }` |
| T007-5 | traceability drops project-level evidence | limit | spec limitations |
| T007-6 | first cycle only | limit | spec limitations |
| T008-1 | reconcile `completed` acceptance | earlier | OSS-04 reconcile `completed` runs the manifest validation |
| T008-2 | fingerprint = payload only | now | B2 |
| T008-3 | distinct outcome for unhashable payload | ok | routes map by the frozen code |
| T009-1 | spot literals vs constants | earlier | test pins literal to constant; hand-over says import the constant |
| T009-2 | ACL titles i18n | now | A1 |
| T009-3 | event id tuple / scope in emit options | ok | commands pass `{ tenantId, organizationId }` as emit options |
| T010-1 | platform lock body has no `details[]` | ok | documented; spec says platform body |
| T010-2 | unused `lockScopedProject/Task` | earlier | used by reserve and later commands |
| T010-3 | `changedProjectKeys` JSON.stringify | now | B9 |
| T010-4 | redundant `em.persist` | ok | customers convention |
| T011-1 | new dependent of a blocked task stays `draft` | limit | ready gate refuses; status change would be visible → v2 |
| T011-2 | `manualCheckId: null` | now | B7 |
| T011-3 | delete emits no `task.updated` | now | B5 |
| T011-4 | correction budget loaded eagerly | ok | harmless query |
| T012-1 | `project.updatedAt = decidedAt` dead | FP | the assignment dirties the row so `onUpdate` bumps the version; returned value is read after commit |
| T012-2 | baselines loaded with content for max(version) | ok | demo scale; v2 select `version` only |
| T012-3 | top code `missing_acceptance_criteria` for missing requirements | limit | detail `missing_requirements` carries it |
| T012-4 | unreadable draft 400; API keys 403 | ok | documented in H9 |
| T013-1 | `trustedExecution` in input schema | limit | guard `!ctx.request` on every entry point; R14/R16/R18 route tests + new R19 test |
| T013-2 | package exports every screen | ok | v2 filtering |
| T013-3 | line 94 readability | ok | cosmetic |
| T013-4 | `toResult` `new Date()` fallback | ok | `updatedAt` is set by `onCreate`; branch unreachable |
| T014-1 | register parsed before idempotency compare | limit | fail closed intended |
| T014-2 | same fallback in `evidence.ts` | ok | as T013-4 |
| T014-3 | result hash lives on evidence | earlier | spec changelog + hand-over |
| T014-4 | race path returns winner's `completionDelivery` | earlier | H21 note |
| T015-1 | 400 `unsupported_source` not 422 | earlier | hand-over says 400 |
| T015-2 | malformed id 400 on CRUD vs 404 custom | ok | documented; both frozen |
| T015-3 | mixed import styles | ok | cosmetic churn |
| T015-4 | R6/R9 no paging | ok | demo scale; v2 |
| T016-1 | offset paging on `updatedAt` | now | B4 |
| T016-2 | `getAttempt` throws | spec | DI section |
| T016-3 | `invalid_json` detail | ok | matches `readRouteBody` |
| T016-4 | 403 asserted on metadata only | ok | platform enforces; QA TC-005/006 live 403 |
| T017-1 | `expectStatus` shape | ok | test style |
| T018-1 | H9 wording on generated registry | ok | clarified here: the compiled `modules.ts` copy carries env-gated entries only |
| T018-2 | `.env` is the effective enterprise switch | ok | recorded here |
| T018-3 | `/tmp` evidence | now | smoke script committed under `handover/smoke/` |
| T019-1 | bare directory in `allowedPaths` | limit | UI form hint: use `dir/**` |
| T019-2 | `isPathWithinProfileRoots` unused | now | `@deprecated` |
| T019-3 | `uncoveredAcIds` | ok | v2 |
| T019-4 | `seen` for invalid entries | ok | cosmetic |
| T020-1 | attachment snapshot changes hash once | earlier | hand-over |
| T020-2 | token nulls / depth only at freeze | limit | UI should validate on save; v2 relax |
| T020-3 | one attachment per screen | limit | UI-03 informed |
| T020-4 | bytes read under lock | limit | documented |
| T021-1 | `identical` branch never fires | ok | defensive |
| T021-2 | `importedManifests` additive | earlier | spec + hand-over |
| T021-3 | audit i18n key | P2 | UI stream |
| T021-4 | pre-read before transaction | ok | harmless |
| T022-1 | draft `acTestMap` dropped | now | merge |
| T022-2 | leftover unique → raw 500 | now | 409 `idempotency_conflict` |
| T022-3 | typecheck evidence | earlier | gate |
| T023-1..3 | scopeChange test gaps | ok | test-quality notes, not contract |
| T024-1 | issued `trustedExecution` required | earlier | H21 |
| T024-2 | delivery retry bumps `updatedAt` | limit | v2 internal update path |
| T024-3 | audit i18n | P2 | UI stream |
| T025-1 | result artifact MIME list | limit | EXEC informed (H21) |
| T025-2 | `mapRunnerStatus` for adapters | limit | EXEC calls it |
| T025-3 | `test_not_mapped_to_ac` strictness | limit | H21 |
| T026-1 | 428 message says “project” | ok | message text not frozen; cosmetic |
| T026-2 | verbose audit snapshot | ok | consistent with reserve |
| T026-3 | audit i18n | P2 | UI stream |
| T027-1 | R18 `completed` without `results.import` | limit | v2 feature split |
| T027-2 | 403 on metadata only | ok | QA |
| T027-3 | `source: 'manual'` for trusted reconcile | limit | v2 |
| T028-1 | extra attachments scope-only | limit | documented |
| T028-2 | 403 on metadata only | ok | QA |
| T028-3 | `assertKindRules` narrowing | ok | cosmetic |
| T029-1 | review reads evidence before locks | now | lock first |
| T029-2 | R19 drops `taskStatusReason` | now | additive field |
| T029-3 | `failed` sticky per revision | earlier | spec T029 changelog |
| T030-1 | `/tmp` smoke scripts | now | committed (H9 script; the H21 one is gone, recipe in `OSS-04-H21.md`) |
| T031-1 | `manual_pending` passes publish | ok | recorded decision (preview is what the human reviews) |
| T031-2 | default revision from `result_manifest` rows | limit | UI/R22 pass the integration revision explicitly |
| T031-3 | formatting | ok | cosmetic |
| T032-1 | kind check before baseline lookup | now | 404 first |
| T032-2 | unbounded `revision` string | ok | `.max()` tried and reverted: it turned the frozen `422 invalid_revision` for an oversized ref into 400; the parser already rejects |
| T033-1 | `deployDecisionCreateResponseSchema` alias | FP | schemas differ (`activeBaselineId` only on baseline decisions) |
| T033-2 | export / double `em` resolve | ok | cosmetic |
| T033-3 | audit i18n | P2 | UI stream |
| T034-1 | long `releaseError` signature | ok | cosmetic |
| T035-1 | `taskVersion` async | ok | test style |
| T035-2 | ordered blocker arrays | ok | rule order is deterministic |
| T036-1 | archive 409 without code | now | `reconciliation_required` asserted |
| T036-2 | seven-level relative path | ok | test only |
| T036-3 | helper duplication | ok | test only |
| T038-1 | static scan coverage | ok | limitation stated in the audit note |
| T038-2 | tamper demonstration | ok | limitation stated |
| T039-1 | change.md status | ok | process |

## 4. Remaining patch requests for other owners

- **P2 UI i18n (Adam, `delivery_os/i18n/**`)** — add in all five locales: `delivery_os.audit.projects.{create,update,delete}`,
  `delivery_os.audit.tasks.{create,update,delete,import_plan}`, `delivery_os.audit.baselines.{create,import_requirements}`,
  `delivery_os.audit.decisions.{record,deploy,release}`, `delivery_os.audit.attempts.{reserve,cancel,reconcile,claim,link_workflow,mark_delivery}`,
  `delivery_os.audit.results.accept`, `delivery_os.audit.evidence.record` (English fallbacks are the second argument of each
  `translate(...)` call in `commands/*.ts`, e.g. `'Archive delivery task'`), plus `delivery_os.errors.<code>` for the 54 frozen codes
  (`OSS-02-H9.md`) and the FLOW codes (`FLOW-F0-contracts.md`); then `yarn i18n:check-usage` turns green.
- **P3 UI page (Adam)** — `packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/page.tsx` must bind the host
  `extensionPoints.hosts.projectExecution` (spot `delivery_os.project.execution`, import `DELIVERY_EXECUTION_SPOT_ID` from
  `lib/contracts.ts`; context contract `delivery_os.project.execution.v1`); then
  `yarn workspace @open-mercato/cli jest src/lib/generators/__tests__/module-facts.bc-guard.test.ts --maxWorkers=2`.
- **P5 core build (EXEC / maintainers)** — `packages/core/build.mjs`: pass `target: 'node22'` (or `supported: { 'import-attributes': true }`)
  to `buildPackage` so the `with { type: 'json' }` attributes survive into `dist`; verified locally: `import('dist/modules/delivery_os/lib/fixtures/index.js')`
  loads under plain Node ESM (18 exports). Until then EXEC's worker must use `lib/fixtures/builders` or a bundler.
- **Enterprise execute route (Marcin)** — `POST /api/delivery_agents/tasks/:id/execute` must call `delivery_os.attempts.reserve`
  with a fresh command context (scope + actor, no `request`) and an issued `trustedExecution`; over HTTP the option is ignored.
- **Optimistic-lock registration (maintainers)** — `delivery_os: ['DeliveryProject', 'DeliveryTask']` in
  `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts`.

## 5. Not done

- Full-repo gate not re-run (memory rule); the scoped set above is the evidence. `warranty_claims/quantity` (locale) and
  `create-mercato-app/release-upgrade-skill-contract` (changelog date) failures of the OSS-06 gate are unrelated to OSS.
- Dev server on :3100 was not restarted; the live smoke exercised the frozen v1 routes, which this task did not change.
