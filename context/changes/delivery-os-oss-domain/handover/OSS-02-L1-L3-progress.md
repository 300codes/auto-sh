# OSS-02 progress note — layers L1–L3 done (T004–T008)

> Pure contracts, data layer and domain rules are in place. **Commands, routes, ACL, events, DI and setup (L4+) are
> not implemented yet**, so the frozen API paths still return 404. Nothing in the master plan was ticked; a human
> accepts Progress rows after seeing the evidence below.

- **Commit:** `<SHA — filled in by the orchestrator after commit>` (T008, on top of `f15db049c`)
- **Contract version:** `DELIVERY_CONTRACT_VERSION = 1` (unchanged by T008; no new error codes, 54 codes)
- **Profile versions:** `react-vite@1`, `open-mercato-module@1`, `wordpress-theme@1` (unchanged)

## What exists

| Layer | Task | Content |
|---|---|---|
| L1a | T004 | `lib/contracts.ts`, `lib/hash.ts` — schemas v1, error catalogue, canonical hash |
| L1b | T005 | `lib/targetProfiles.ts`, `lib/fixtures/**`, `lib/resultAcceptance.ts`, H4 hand-over |
| L2 | T006 | five entities, migration `Migration20260919003425_delivery_os`, `data/validators.ts`, module registration |
| L3a | T007 | `lib/dag.ts`, `lib/taskLifecycle.ts`, `lib/projectStatus.ts`, `lib/traceability.ts` |
| L3b | T008 | `lib/attempts.ts`, `lib/baseline.ts` |

## Evidence towards master-plan Progress 2.1 (rules level only)

Run on 2026-09-19, local runner (no compose `app` container):

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 11 suites, 372 tests passed.
- `yarn workspace @open-mercato/core typecheck` → exit 0, no output.
- `npx eslint` on the four new files → clean.

| Acceptance item of OSS-02 | Rule that decides it | Test |
|---|---|---|
| unknown schema rejected | `parseVersioned` | `contracts.test.ts`, `fixtures.test.ts` |
| cycle / foreign scope rejected | `validateTaskGraph` | `dag.test.ts` |
| one key reserves one attempt | `reserveAttempt` (created / existing / `idempotency_conflict`; replay wins over active, limit and unknown) | `attempts.test.ts` |
| one active attempt, limit 16 without trimming history | `reserveAttempt` | `attempts.test.ts` |
| unknown run never restarts by itself, blocks archive | `reconcileAttempt`, `isArchiveBlocked` | `attempts.test.ts` |
| `completed` never yields `verified` | `reconcileAttempt` → `await_manifest` | `attempts.test.ts` |
| ready needs an approved baseline (both decisions for this hash + version), a render, known ACs and required tests | `checkTaskReadiness` | `baseline.test.ts` |
| a draft edited after approval does not change the baseline | `buildBaselineContent` (deep clone) | `baseline.test.ts` |

Still open for 2.1 / 2.2: stale-update rejection (optimistic locking) and "GET does not mutate" need the L4 commands
and routes; the export test with real decisions comes with them.

## For the L4 commands (next OSS task)

- Parse `task.executionAttempts` with `parseAttemptRegister`, call the reducer under the task row lock, persist
  `result.register`. `reserveAttempt` takes `baseRevision` and derives `baseCommit`; `payload` is the validated
  request body (`{ mode, baseRevision }`), `newAttemptId` a fresh uuid, `now` an ISO string.
- Reserve order in the command: replay check (`outcome: 'existing'` → 200) happens inside the reducer before the
  active/limit checks; task-level checks (`task_not_ready`, `dependency_not_verified`) stay in the command and must run
  **after** an `existing` replay was ruled out.
- `reconcileAttempt` returns `taskEffect`; map it through `canTransition`: `release_task` → `ready` (or
  `changes_requested` after a correction round) with `statusReason: null`, `block_task` → `blocked` /
  `reconciliation_required`, `await_manifest` → run the UA-12 acceptance in the same transaction.
- OSS-04 result acceptance needs its **own** gate (not `checkAttemptOpen`): accept a manifest on active states, and on
  `reconciliation_required` / `cancel_requested` only when `reconciliation.resolution === 'completed'`.
- A cancelled attempt reconciled as `not_started`/`stopped` closes with `outcome: 'cancelled'` (the observation stays in
  `reconciliation.resolution`), so a late manifest answers `attempt_cancelled`.
- `checkTaskReadiness` does not compare the task's baseline with `project.activeBaselineId`; if the command should
  refuse tasks pinned to a superseded baseline, it adds that check itself.
- A `rejected` decision voids the approval of the same `contentHash` whatever `subjectVersion` it names; approvals count
  only for the exact hash + version.
- GET package and claim share `checkAttemptOpen`.
- `checkTaskReadiness` result is the `readiness` field of `TransitionContext`; pass the profile from
  `getTargetProfile(task.targetProfileId, task.targetProfileVersion)`.
- `buildBaselineContent(project.draftSpec)` also returns `openCommentIds`; the UI may warn before approval.

## For UI

- Readiness errors carry **all** reasons in `details[]`; detail codes: `requirements_decision_missing`,
  `design_decision_missing`, `requirements_rejected`, `design_rejected`, `requirements_decision_invalid`,
  `design_decision_invalid`, `missing_render`, `missing_required_tests`,
  `unknown_ac`, `missing_acceptance_criteria`, `target_profile_mismatch`, `baseline_mismatch`, `hash_mismatch`.

## Addendum — L4a registration (T009)

- `acl.ts` (8 features), `setup.ts` (admin `delivery_os.*`; employee `projects.view`, `projects.manage`,
  `results.import`), `events.ts`, `extension-points.ts`; `index.ts` re-exports `features`. The local tenant got the
  grants via `yarn mercato auth sync-role-acls`. Live `POST /api/auth/feature-check`: the employee is granted only the
  three features above, and admin holds all eight.
- **For the L4 commands:** emit via `emitDeliveryOsEvent(id, payload, { tenantId, organizationId })`. Payloads per the
  spec § Events include `tenantId`/`organizationId`. Pass scope in options too, or SSE drops the broadcast. Do not set
  `makeCrudRoute` `events` for delivery entities.
- **For UI:** render the spot with `extensionPoints.hosts.projectExecution.spotId` (import `extensionPoints` from
  `@open-mercato/core/modules/delivery_os/extension-points`) in `backend/delivery/projects/[id]/page.tsx`. Referencing
  `extensionPoints.hosts.projectExecution` there is what marks the host `bound` in module facts. Subscribe with
  `useAppEvent('delivery_os.task.updated' | 'delivery_os.evidence.recorded', …)`. Feature titles are English labels in
  `acl.ts` (same as customers), so no i18n keys are required.
- **For EXEC/enterprise:** subscribe to `delivery_os.evidence.recorded` (`duplicate`, `completionDelivery`). Gate with
  the feature IDs above, never role names.

## Addendum — L4b project commands (T010)

- Commands: `delivery_os.projects.create | update | delete` (`commands/projects.ts`), helpers in `commands/shared.ts`.
  Results are `{ projectId }`. Delete input is the CRUD shape `{ body?: { id }, query?: { id } }`.
- **For the routes (next OSS task):** map HTTP to these commands; require the lock header on PUT/DELETE and answer
  `428 optimistic_lock_required` there (commands stay header-optional so workers can call them). The stale-write body is
  the platform one (`code: optimistic_lock_conflict`, `currentUpdatedAt`, `expectedUpdatedAt`), so
  `surfaceRecordConflict` works unchanged.
- **For the attempts command (next OSS task):** lock order is project → tasks. Reserve locks the task row and must then
  load the project with `requireScopedProject` (archived → 404), otherwise it can race the archive guard.
- **For new command files:** reuse `resolveDeliveryScope`, `parseDeliveryInput`, `assertDeliveryCheck`,
  `requireScopedTask`, `lockScopedTask`; never read `tenantId`/`organizationId` from input.
- **For UI:** archive errors carry `details[]` with `path` `tasks.<taskId>[.attempts.<attemptId>]` and code
  `attempt_reserved | attempt_claimed | attempt_cancel_requested | task_executing | reconciliation_required |
  unreadable_attempt_register`. Audit labels need i18n keys `delivery_os.audit.projects.{create,update,delete}`
  (English fallbacks are in code).
- **Scope rule:** `resolveDeliveryScope` trusts `ctx.selectedOrganizationId` only when the caller also passes the
  platform `organizationScope` (makeCrudRoute does). Custom routes must resolve and pass it; workers act in
  `auth.orgId`. A selection nobody vouches for answers `403 forbidden` / `scope_not_allowed`.
- **Task delete (next OSS task):** must refuse a task with an active or unknown attempt — the project archive guard
  only looks at live tasks.
- Delivery errors are built with `deliveryHttpError` instead of the shared `notFound()` helpers on purpose: the frozen
  body needs `code` and `details[]`.
- Evidence: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 14 suites, 427 tests
  green; `tsc --noEmit` for `@open-mercato/core` clean. No migration, no workspace change; `yarn generate` output is
  gitignored.

## Addendum — L4c task commands (T011)

- Commands: `delivery_os.tasks.create | update | delete` (`commands/tasks.ts`). Result
  `{ taskId, projectId, status, updatedAt, propagatedTaskIds }`. Create input is `{ projectId, ...body }` — **the route
  must copy `projectId` from the path** (`/projects/:id/tasks`); only `source: 'manual'` is accepted here.
- New shared helper `lockTaskForWrite(tx, ctx, id, scope) → { project, tasks, task }`: project row lock → live project
  task locks → optimistic check on the task. Attempt/result commands that change several tasks should reuse it.
  `checkProjectArchivable(tasks, 'task')` is the single classifier for live/unknown attempts.
- Exported for reuse: `countCorrectionRounds(evidence)` (OSS-04 review flow), `checkTaskDeletable`, `checkKnownAcIds`.
- **For UI:** detail codes to render — `foreign_baseline`, `unknown_ac` (path `acIds.<id>`), `other_project`,
  `other_baseline`, `unknown_dependency`, `cycle`, `task_not_editable`, `not_user_settable`, `dependency_blocked`,
  `baseline_not_active`, `result_awaits_review`, `<kind>_decision_missing|rejected`, `missing_render`, `missing_required_tests`,
  `has_dependents` (path `tasks.<dependentId>.dependsOnTaskIds`), attempt codes as in the project archive.
  Blocking a task changes its descendants too: their `updatedAt` moves and each gets a `delivery_os.task.updated`
  event — refresh the list on that event. Audit labels need `delivery_os.audit.tasks.{create,update,delete}`.
- Scope fields (`acIds`, `dependsOnTaskIds`, `allowedPaths`) are editable only in `draft`/`blocked` before any attempt;
  `title`/`description` always. A dependency on a `cancelled` task is accepted (the task can then never be reserved).
- Status updates never reopen a task that already has an accepted result (`result_awaits_review`) — OSS-04 review
  commands own that path; archiving a `verified`/`awaiting_review` task is allowed (soft delete, evidence stays).
- Evidence: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 15 suites, 462 tests
  green; `tsc --noEmit` for `@open-mercato/core` clean. No migration, no workspace change.

## Addendum — L4d manual baseline and decisions (T012)

- Commands: `delivery_os.baselines.create` (`commands/baselines.ts`) and `delivery_os.decisions.record`
  (`commands/decisions.ts`). **Routes must merge the path id into the input**: R7 `{ projectId, ...body }`,
  R8 `{ baselineId, ...body }`. R7 answers `201` for `duplicate: false` and `200` for `duplicate: true`. R8 must check
  `delivery_os.baselines.approve` (`manage` is not enough) — the command does not check features.
- Both commands require the **project** `updatedAt` lock header themselves (`428 optimistic_lock_required`) and force the
  compare even with `OM_OPTIMISTIC_LOCK=off` (`lockProjectForWrite(..., { force: true })`).
- **For UI:** after every decision take `projectUpdatedAt` from the response as the next lock header. A concurrent
  decision answers the platform 409 → `surfaceRecordConflict`. `openCommentIds` lists the comments that were left out of
  the frozen content. Detail codes to render: `missing_requirements`, `missing_acceptance_criteria`, `missing_render`,
  `attachment_scope_mismatch` (path `screens.N.attachmentId` / `attachments.N.attachmentId`),
  `subject_hash_mismatch`, `subject_version_mismatch`, `stored_content_altered`, `decision_kind_not_supported`,
  `actor_required`, `reason_required`. Audit labels need `delivery_os.audit.baselines.create` and
  `delivery_os.audit.decisions.record`.
- A reject of the active baseline clears `activeBaselineId` (no event); ready tasks of that baseline then fail the
  ready gate. `delivery_os.baseline.approved` fires only when a baseline becomes active — safe as a workflow trigger.
- New shared helpers: `requireLockHeader`, `requireActorUserId`, `findScopedBaseline`, `requireScopedBaseline`,
  `DELIVERY_BASELINE_RESOURCE_KIND`, `DELIVERY_DECISION_RESOURCE_KIND`. Exported checks: `checkDraftFreezable`,
  `checkDecisionSubject`.
- Limitation: attachments are checked for existence in the same tenant/organization only; hash/size/type verification
  of the bytes is OSS-03. No route exists yet, so the commands were verified by unit tests, not over HTTP.
- Evidence: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 17 suites, 496 tests
  green; `tsc --noEmit` for `@open-mercato/core` clean. No migration, no workspace change.
- A lock header that is not a timestamp answers `400 validation_failed`/`optimistic_lock_invalid`. An older baseline is
  never promoted over a newer active one. **OSS-03:** every baseline writer must take `lockProjectForWrite` so version
  numbers cannot collide.

## Addendum — L4e attempt reservation and TaskPackage builder (T013)

- Command `delivery_os.attempts.reserve` (`commands/attempts.ts`). Input
  `{ taskId, idempotencyKey, mode, baseRevision, trustedExecution? }`; result
  `{ created, attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl }` (`AttemptReserveResult`).
  **Route R14 must build the input itself**: `taskId` from the path, `idempotencyKey` from the `Idempotency-Key`
  header, `mode` + `baseRevision` from `reserveAttemptBodySchema` (literal `manual_handoff`), never `trustedExecution`.
  Answer `201` for `created: true` and `200` for `created: false`, and drop `created` from the body. The route checks
  `delivery_os.attempts.manage`; the command does not check features.
- Check order for a new key: replay → `idempotency_conflict` → task lock header (`428` / `400` / platform `409`; only when
  a request exists, forced with `OM_OPTIMISTIC_LOCK=off`) → `reconciliation_required` / `attempt_active` /
  `attempt_limit_reached` → `task_not_ready` → `dependency_not_verified` → `unknown_target_profile` /
  `revision_kind_mismatch` → `foreign_reference` / `baseline_not_active` → `correction_limit_reached`.
- Lock order is project → task (same as `lockTaskForWrite`), so a reservation can never race a baseline decision or a
  dependency status change; reservations of one project serialise.
- **Safety conditions for `automatic`:** never register this command as workflow-safe
  (`registerWorkflowSafeCommands`) — a workflow context has no `request` either; and R14 must build the input from
  `reserveAttemptBodySchema` fields only and always pass `request`.
- The builder also refuses stored content that no longer hashes to `contentHash` (`hash_mismatch` /
  `stored_content_altered`).
- A replay needs no lock header, writes nothing, emits nothing and leaves no audit entry. Its `taskUpdatedAt` is the
  current task version, so it is always a usable lock token.
- On create the task moves to `executing`, `attemptNumber` = register length, one `delivery_os.task.updated`.
- **For EXEC (enterprise):** call the command in-process without `ctx.request`, with `mode: 'automatic'` and
  `trustedExecution: { source: 'delivery_agents', actorUserId }`; `ctx.auth` must still carry `tenantId` and `orgId`.
  No lock header is needed there, the row lock serialises. Every other combination answers `403 forbidden` /
  `trusted_execution_required`. `actorUserId` becomes the actor of the audit entry.
- **For UI:** new detail codes `task_blocked`, `task_not_ready`, `dependency_not_verified` (path
  `dependsOnTaskIds.<taskId>`, message names the dependency status or `missing`), `trusted_execution_required`,
  `unreadable_attempt_register`. Audit label key `delivery_os.audit.attempts.reserve` (English fallback in code).
- Builder `buildTaskPackageV1({ project, task, baseline, attempt, profile })` in `lib/taskPackage.ts` is pure; entities
  fit its input types structurally. **Route R15**: load task (scope → 404), project, `findProjectBaseline`,
  `parseAttemptRegister` + `findAttempt(register, attemptId)`, `getTargetProfile`, then return `taskPackage` or the
  failure's `status` + `body`. No write, no lock.
- `commands/tasks.ts` now exports `findProjectBaseline`, `loadCorrectionBudget`, `emitTaskSideEffects`,
  `emitTaskUpdated`.
- Limitations: a `changes_requested` task pinned to a superseded baseline cannot be re-reserved (422
  `baseline_not_active`) — cancel it or re-plan on the new baseline. `task.updatedAt` is set by the ORM `onUpdate` hook
  at flush; the mocked EM cannot prove it, so check `taskUpdatedAt` over HTTP in the routes task. No route exists yet.
- Evidence: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 19 suites, 548 tests
  green; `tsc --noEmit` for `@open-mercato/core` clean; eslint of the touched files clean. No migration, no workspace
  or dependency change. Rows: 2.1 (one key reserves one attempt, stale update rejected, foreign scope 404) and 4.1
  (OSS side, reservation).

## Addendum — L4f minimal result acceptance (T014)

- `commands/evidence.ts` registers `delivery_os.results.accept`: input `{ taskId, attemptId, manifest, source }`, result
  `{ evidenceId, duplicate, taskStatus, taskUpdatedAt }`. DTO v1 unchanged; profile versions unchanged.
- Pure core: `lib/resultAcceptance.ts#evaluateResultAcceptance({ manifestRaw, task, attempt, taskPackage, existingResult })`
  → `accept` | `duplicate` | failure. Order: schema → attempt exists → **idempotency** → result gate → package failure →
  revision kind vs profile → correlation → OSS-04 seams. New pure helpers in `lib/attempts.ts`:
  `checkAttemptAcceptsResult`, `recordAttemptResult`. `buildTaskPackageV1` has an optional `{ attemptGate: 'none' }`.
- The idempotency hash is `hashCanonical` of the parsed manifest (unknown keys such as `tenantId` are stripped first)
  and is stored as `DeliveryEvidence.payloadHash`. The attempt keeps only `resultEvidenceId` — the attempt DTO is frozen.
- Accept: one `result_manifest` row, attempt `result_received`, `completionDelivery = 'pending'` only with `workflowRef`,
  task → `awaiting_review` (also from `blocked`/`reconciliation_required` after a `completed` reconciliation, never
  `verified`). Duplicate: no write, no audit entry, `evidence.recorded { duplicate: true, completionDelivery }` re-emitted.
- **OSS-04 seams (not implemented):** `checkChangedPathsAllowed` (changedPaths within `allowedPaths`),
  `checkArtifactAttachments` (attachment scope + sha256), `checkResultSizeLimits`; all listed in
  `RESULT_ACCEPTANCE_PENDING_CHECKS` and currently pass. Also left for OSS-04: closing the attempt
  (`closedAt`, `outcome = 'result_accepted'`), `mark_delivery`, `listPendingDeliveries`, cancel/reconcile commands.
- **Route R16:** build the input as `{ taskId from the path, attemptId + manifest from resultsImportSchema, source: 'manual' }`,
  always pass `request`, check `delivery_os.results.import` (the command checks no feature), answer 201 for
  `duplicate: false` and 200 for `duplicate: true`. No lock header.
- **For EXEC:** call in-process without `ctx.request` and with `source: 'adapter'`; `ctx.auth` carries `tenantId`/`orgId`.
  `source: 'adapter'` with a request answers `403 forbidden` / `trusted_execution_required`. Subscribe to
  `delivery_os.evidence.recorded` and retry the delivery whenever `completionDelivery === 'pending'` (also on
  `duplicate: true`). OSS never signals a workflow. Never register the command as workflow-safe.
- **For UI:** codes to render: `result_conflict`, `attempt_cancelled`, `attempt_closed`, `reconciliation_required`,
  `attempt_not_found`, `correlation_mismatch`, `baseline_mismatch`, `base_revision_mismatch`, `revision_kind_mismatch`,
  `unsupported_schema_version`, `invalid_transition`. Audit label key `delivery_os.audit.results.accept`.
- A manifest of attempt B posted against attempt A that already has a result answers `409 result_conflict`
  (idempotency runs before correlation); without a stored result it answers `422 correlation_mismatch`.
- A `result_received` attempt is not closed here (`closedAt`, `outcome`) and is not "active", so after
  `changes_requested` a new attempt can be reserved next to it; results stay separate per attempt. If a post-commit
  side effect throws, a retry answers `duplicate` and re-emits only `evidence.recorded` (same as the sibling commands).
- Limitations: descendants of a `blocked` task are not unblocked when it moves to `awaiting_review`; the unique-index
  race is simulated on a mocked EM (real two-connection race → QA TC-DELIVERY-006); `taskUpdatedAt` comes from the ORM
  `onUpdate` hook at flush — check it over HTTP in the routes task. No route exists yet.
- Evidence: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 21 suites, 603 tests
  green; `yarn workspace @open-mercato/core typecheck` clean; eslint of the touched files clean; grep shows only
  `tx.create` + find for `DeliveryEvidence`. No migration, no workspace or dependency change. Rows: 2.1 (unknown schema
  rejected, foreign scope 404, tenant in manifest ignored); groundwork for 4.1 and 4.7 (duplicate does not duplicate
  evidence and re-emits the pending signal).

## Addendum — L5a API routes R1–R13 (T015)

Real HTTP for projects, baselines, decisions and tasks. Contract version unchanged (`DELIVERY_CONTRACT_VERSION = 1`);
no error code, path, schema version, event, feature or migration changed.

- Files: `api/{openapi,schemas,serializers,routeSupport}.ts`, `api/projects/route.ts` (R1–R4, `makeCrudRoute` +
  command actions), `api/projects/[id]/route.ts` (R5), `api/projects/[id]/baselines/route.ts` (R6/R7),
  `api/baselines/[id]/decisions/route.ts` (R8), `api/projects/[id]/tasks/route.ts` (R9/R10), `api/tasks/[id]/route.ts`
  (R11), `api/tasks/route.ts` (R12/R13, exports PUT and DELETE only). Every file exports `metadata` and `openApi`.
- **Read DTOs (camelCase, zod in `api/schemas.ts`):** list item `{ id, name, inputMode, brief, targetProfileId,
  targetProfileVersion, repositoryRef, activeBaselineId, createdAt, updatedAt, archivedAt }`; `ProjectDetail` = list
  item + `{ draftSpec, limits, status, progress { proven, total, unit: 'ac', percent }, taskCounts, attention }`;
  `BaselineDto { id, projectId, version, contentHash, source, parentBaselineId, content, attachmentIds, createdBy,
  createdAt, isActive, decisions[{ id, kind, verdict, subjectHash, subjectVersion, reason, actorUserId, decidedAt }] }`
  (no baseline detail route exists, so R6 carries what the approval screen needs); `TaskDto { …task fields, status,
  statusReason, attemptNumber, executionAttempts[], attemptRegisterReadable, proposalTaskKey, createdAt, updatedAt,
  archivedAt }`. R6 and R9 answer `{ items, total }` without pagination (R6 newest version first, R9 oldest first,
  archived tasks hidden).
- **For UI:** R1 accepts `page, pageSize ≤ 100, search, includeArchived, sortField (name|createdAt|updatedAt), sortDir`;
  `pageSize=101` answers the factory's `400 { error: 'Invalid input', details }` (the only non-frozen 400). Send
  `x-om-ext-optimistic-lock-expected-updated-at` with the PROJECT `updatedAt` on R3/R4/R7/R8 and the TASK `updatedAt`
  on R12/R13; after R8 use `projectUpdatedAt` from the response for the next decision. A write against an id that does
  not exist in the caller's scope answers `404 not_found` without the header and the platform `409` with it (the
  record "vanished" for that client) — identical for missing and foreign ids, so nothing leaks. Archived projects and
  tasks stay readable on R5/R6/R9/R11. `source: requirements_proposal | plan_proposal` answers `403` without
  `delivery_os.results.import`, otherwise `400 validation_failed` / `unsupported_source` until OSS-03 (the frozen
  catalogue has no 422 code for it). The platform guard's own 403 body is `{ error: 'Forbidden', requiredFeatures }`;
  the in-handler per-source 403 uses the frozen body with `details[].message` = the missing feature id.
- Bodies that are NOT frozen-shaped (platform-owned): `401 { error }`, the declarative `403 { error, requiredFeatures }`,
  `422 { error, code: 'organization_selection_invalid' }` (stale organization cookie), mutation-guard / interceptor
  rejections, the list-query 400 and `5xx { error }`. List export (`format=csv`) is disabled on R1.
- **For QA (TC-DELIVERY-001…004):** the routes are live. The ORM `onUpdate` hook was confirmed over HTTP: every PUT,
  decision and task transition returns a newer `updatedAt`, and reusing the older one answers the platform 409.
- **Operational gotcha:** a dev server started before the `delivery_os` entities existed answers
  `500 Metadata for entity DeliveryProject not found` on the first write; restart `yarn dev` once after pulling.
- Limitations: R5 computes status from all project baselines/tasks on every call (bounded by project size);
  R7/R10 POST declare `delivery_os.projects.view` in `metadata` and enforce the per-source feature in the handler
  (fail closed when `rbacService` is unavailable); hash/size verification of attachment bytes is still OSS-03.
- Evidence: see the T015 task notes (jest 25 suites / 653 tests, core typecheck, eslint, live curl transcript). Rows:
  2.2 (CRUD, scope 404, 403 per feature, stale 409, pageSize) and 2.3 (manual baseline → real decisions → task ready
  over HTTP without enterprise); co-acceptance 2.4 stays open.

## Addendum — L5b routes R14–R16 and `deliveryOsAttemptQueries` (T016)

- Routes (all with `metadata`, `openApi`, frozen error bodies, mutation guard on writes):
  - R14 `POST /api/delivery_os/tasks/:id/attempts` — `delivery_os.attempts.manage`; header `Idempotency-Key`
    (checked first → `400 idempotency_key_required`), body `{ mode: 'manual_handoff', baseRevision }`; `201` new key,
    `200` same key + payload (before the lock, header may be stale or missing); a new key needs the **task**
    `updatedAt` lock header (`428` / platform `409`). Body-sent `trustedExecution`/`taskId` are ignored.
  - R15 `GET /api/delivery_os/tasks/:id/package?attemptId=` — `delivery_os.attempts.manage`; `200 TaskPackage v1`,
    no writes; `404 attempt_not_found`, `409 attempt_cancelled | attempt_closed | reconciliation_required`,
    `400 validation_failed` for a missing/malformed `attemptId`. After a result is accepted the package answers
    `409 attempt_closed` — export it before importing.
  - R16 `POST /api/delivery_os/tasks/:id/results` — `delivery_os.results.import`; body `{ attemptId, manifest }`;
    `201 { evidenceId, duplicate: false, taskStatus, taskUpdatedAt }`, identical replay `200 … duplicate: true`;
    `413 payload_too_large`; no lock header.
- **For EXEC:** `container.resolve('deliveryOsAttemptQueries')` (type `DeliveryOsAttemptQueries` from
  `commands/attemptQueries.ts`): `getAttempt(scope, taskId, attemptId)` → attempt or `null`;
  `buildTaskPackage(scope, taskId, attemptId)` → TaskPackage v1 or throws `CrudHttpError` with the frozen body
  (`isCrudHttpError`); `listPendingDeliveries(scope, { limit })` (1–100, default 50; pages through attempted tasks,
  oldest first). `getAttempt` also reads archived tasks; `buildTaskPackage` answers 404 for them. Scope `{ tenantId, organizationId }` is mandatory — a missing one throws an `[internal]` Error.
  Read-only: forked EM, no flush, no transaction. Empty in OSS-only because only the trusted executor sets `workflowRef`.
- **For UI:** the 428 on R14 reuses the shared message "The project version header is required" although the expected
  version is the task's — render by `code`, not by text. New request header name: `Idempotency-Key`.
- **For QA (TC-DELIVERY-005/006):** routes are live; build a valid manifest with
  `buildResultManifest(taskPackage)` from `lib/fixtures/builders.ts`. Two-connection races stay with QA.
- Live evidence (2026-09-19, :3100, admin@acme.com, real attachment upload → draftSpec → baseline → both decisions →
  task ready): reserve `201` then `200` with the same `attemptId`; two package GETs left the row counts of all five
  tables, `delivery_tasks.updated_at` and the register length unchanged; result import `201 duplicate:false` then
  `200 duplicate:true` with one `delivery_evidence` row; a different manifest → `409 result_conflict`;
  `taskUpdatedAt` in the response equals `delivery_tasks.updated_at` (ORM hook confirmed). Records removed afterwards.
- Evidence: jest 29 suites / 681 tests; core typecheck; eslint clean. Rows: 2.1 (one key reserves one attempt, GET
  does not mutate, stale update rejected), 2.2 (scope 404, 403 per feature), 2.3 (manual flow without enterprise),
  evidence toward 4.1 (duplicate does not double evidence). Still OSS-04: claim, cancel, reconcile, mark_delivery,
  closing the attempt, the pass-through result checks.


## Addendum — L6 in-process manual flow (T017)

- New suite `packages/core/src/modules/delivery_os/api/__tests__/manualFlow.route.test.ts` drives the OSS-only path
  through the real route handlers and registered commands, with no seeded approved baseline: R2 create project → R3
  draft with screen attachments → R7 manual baseline → R8 requirements + design decisions bound to `contentHash` and
  `version` → R10 manual task → R12 ready → R14 reserve (`201`, then `200` same attempt) → R15 package (zero EM writes)
  → R16 result from `buildResultManifest(taskPackage)` (`201`, then `200 duplicate:true`, one evidence row) → R5 detail
  (`in_progress`, progress `0 / <baseline AC count>`). Every call sends the version the previous response returned
  (project `updatedAt` read from R5 before R7/R8).
- Negative legs: with only the requirements decision, ready answers `422 baseline_not_approved` with details
  `[baseline_not_active, design_decision_missing]`; with no decision, `[baseline_not_active,
  requirements_decision_missing, design_decision_missing]`. Reserve then answers `409 task_not_ready`, so no attempt is
  appended (task stays `draft`, `attemptNumber 0`, empty register, no `em.persist`, no `baseline.approved` event) and
  therefore there is nothing to export; a package GET for any attempt id answers `404 attempt_not_found`. After both
  decisions a draft task still cannot be reserved (`409 task_not_ready`). The reserve-side `422 baseline_not_active`
  defence for a ready task on a non-active baseline stays covered by `commands/__tests__/attempts.test.ts`.
- Test-kit fix: `api/__tests__/routeTestKit.ts` `em.create` now applies the entity class defaults (e.g.
  `attemptNumber = 0`, `executionAttempts = []`) like MikroORM does; before, rows created by commands lacked them.
- The OSS/enterprise boundary is guarded by `__tests__/module-registration.test.ts`, which scans every delivery_os file.
- Evidence: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 30 suites / 685 tests
  green; core typecheck exit 0; eslint clean. Rows: 2.1 (one key reserves one attempt, GET does not mutate), 2.3
  (manual flow without enterprise, real decisions); co-acceptance 2.4 stays open for humans.
