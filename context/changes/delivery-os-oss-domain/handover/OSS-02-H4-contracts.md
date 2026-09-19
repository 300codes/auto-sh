# OSS-02 H4 hand-over — contracts v1, target profiles and fixtures (T004 + T005)

> **Fixtures unblock UI/EXEC/QA; the domain is NOT yet implemented.** No entity, migration, command, route,
> DI service or module registration exists yet. The API paths below are frozen but still return 404 until OSS-02 H9.

- **Commit:** `<SHA — filled in by the orchestrator after commit>` (T005, on top of `b3c4a4510`, which holds the T004 contracts)
- **Contract version:** `DELIVERY_CONTRACT_VERSION = 1`
- **Profile versions:** `react-vite@1` (git), `open-mercato-module@1` (git), `wordpress-theme@1` (snapshot)
- **Spec (authoritative):** [`.ai/specs/2026-09-18-delivery-os-hackathon.md`](../../../../.ai/specs/2026-09-18-delivery-os-hackathon.md). See *Contracts v1*, *API Contracts* and *Error body and code catalogue*.
- **Tests:** `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` → 4 suites, 168 tests passed. `yarn turbo run typecheck --concurrency=2 --filter=@open-mercato/core` → clean.
- **Master-plan Progress with evidence:** 2.1 (contract part only; not ticked, a human accepts).

## Where things live and how to import them

| What | Import | File |
|---|---|---|
| zod schemas, inferred types, `parseVersioned`, error catalogue, `buildPackageUrl` | `@open-mercato/core/modules/delivery_os/lib/contracts` | `packages/core/src/modules/delivery_os/lib/contracts.ts` |
| Canonical JSON + sha256 (`hashCanonical`, `sha256Hex`) | `@open-mercato/core/modules/delivery_os/lib/hash` | `lib/hash.ts` |
| Target profiles and helpers | `@open-mercato/core/modules/delivery_os/lib/targetProfiles` | `lib/targetProfiles.ts` |
| Fixtures, loaders (`loadTaskPackageFixture`, `loadResultManifestFixture`, …), `positiveDeliveryFixtures`, `loadNegativeDeliveryFixtures()`, `buildResultManifest` | `@open-mercato/core/modules/delivery_os/lib/fixtures/index` (**with `/index`** — the package export map has no folder-index fallback) | `lib/fixtures/index.ts`. Its JSON imports work under jest, Next and other bundlers; **not** from `dist` under plain Node ESM (Node needs an import attribute that the core esbuild target strips) |
| Builder only (no JSON; safe in any runtime, e.g. an EXEC fake-executor worker) | `@open-mercato/core/modules/delivery_os/lib/fixtures/builders` | `lib/fixtures/builders.ts` |
| Raw JSON for non-TS consumers (Playwright bodies, curl) | `packages/core/src/modules/delivery_os/lib/fixtures/*.v1.json`, `negative/*.v1.json` | — |
| Correlation check (UA-12 step 3), DAG cycle check | `…/lib/resultAcceptance`, `…/lib/dag` | pure functions, reused by later commands |

Schema versions: `delivery.task-package/v1`, `delivery.result-manifest/v1`, `delivery.baseline-content/v1`,
`delivery.requirements-proposal/v1`, `delivery.plan-proposal/v1`, `delivery.design-manifest/v1`,
`delivery.report/v1` (reserved; the schema lands in OSS-05) and `delivery_os.project.execution.v1` (widget context).
Parse an incoming document with `parseVersioned(deliveryDocumentSchemas, body)`. It returns
`{ ok: true, schemaVersion, data }` or `{ ok: false, status, body }` and never throws.

## Reserve (R14) and package (R15)

- Request: `POST /api/delivery_os/tasks/:id/attempts` with headers `Idempotency-Key` and
  `x-om-ext-optimistic-lock-expected-updated-at` (the task `updatedAt`). The body is
  `{ mode: 'manual_handoff', baseRevision: SourceRevision }` (`reserveAttemptRequestSchema`).
  `mode: 'automatic'` → `400 validation_failed`.
- Response `201` (a replay with the same key and payload → `200`, same body; checked before the lock):
  `{ attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl }` (`reserveAttemptResponseSchema`).
  The value is `packageUrl = /api/delivery_os/tasks/<taskId>/package?attemptId=<attemptId>` (`buildPackageUrl`).
  Fixture: `reserve-response.v1.json`.
- `GET packageUrl` → `200 TaskPackage v1` and writes nothing. Fixtures: `task-package.v1.json` (React, git) and
  `task-package.snapshot.v1.json` (WP, snapshot, no `baseCommit`).

## Scope rules (apply to every route)

- `tenantId` and `organizationId` come from the session only. Any tenant or organization value in a body or
  manifest is stripped and ignored.
- A record in another tenant or organization, or an archived record on write, → `404 not_found`. The response
  never reveals that the record exists.
- A result manifest must correlate with the reserved attempt. `projectId`, `taskId`, `attemptId` and
  `targetProfileVersion` → `correlation_mismatch`. `baselineId` / `baselineHash` → `baseline_mismatch`.
  `baseRevision` / `baseCommit` → `base_revision_mismatch`. Each is a 422.
- The profile decides the revision kind. React and OM take only git; WP takes only snapshot. The wrong kind →
  `422 revision_kind_mismatch`. A snapshot never carries `baseCommit`/`resultCommit`, and no commit SHA is invented for WP.
- `allowedPaths` must be repository-relative (no `..`, not absolute) and inside the profile roots, else
  `422 path_not_allowed`. The React roots are `src/**`, `public/**`, `tests/**` and `index.html`.
- `reference_material` evidence is permitted only by `wordpress-theme@1` and never counts as AC evidence. Only
  `result_manifest`, `test` and `review` count.

## Error responses

The body is always `{ error, code, details: [{ path?, code, message? }] }` (`deliveryErrorBodySchema`). Map `code`
to the i18n key `delivery_os.errors.<code>` (UI-owned; 53 codes in `deliveryErrorCodes`, with the status as the value).
The top-level `code` is `validation_failed` (400) when any issue is a plain shape issue. Otherwise it is the first
domain rule code, with its catalogue status. The one exception is the optimistic-lock 409, which keeps the
platform body `{ error, code: 'optimistic_lock_conflict', currentUpdatedAt, expectedUpdatedAt }`: no `details`, and
it does **not** parse with `deliveryErrorBodySchema`. A missing required lock header → `428 optimistic_lock_required`.
Fixture `error-body.v1.json` is the exact body a foreign-task result produces (`422 correlation_mismatch`).

## Fixture catalogue

The positive fixtures form one coherent scenario (project `1111…`, task `2222…`, attempt `3333…`, baseline `4444…`).
The package `baselineHash` equals `hashCanonical(baseline-content)`, and the git manifest correlates with the
React package. WP uses project `7777…`, task `8888…` and attempt `9999…`.

| Fixture | Schema |
|---|---|
| `task-package`, `task-package.snapshot` | `taskPackageV1Schema` |
| `result-manifest`, `result-manifest.snapshot` | `resultManifestV1Schema` |
| `baseline-content` (AC-003 is manual via `manualChecks`) | `baselineContentV1Schema` |
| `requirements-proposal`, `plan-proposal`, `design-manifest` | their v1 schemas |
| `execution-widget-context` (data only; use `buildExecutionWidgetContextFixture()` for callbacks) | `executionWidgetContextV1Schema` |
| `reserve-response` | `reserveAttemptResponseSchema` |
| `error-body` | `deliveryErrorBodySchema` |

Negative fixtures (`negative/*.v1.json`) are wrappers `{ description, expected: { stage, code, status }, documentType,
correlatesWith?, targetProfile?, document }`. `expected` is the result of the **labelled stage in isolation**
(that is what the jest matrix proves). Through a real route, earlier stages run first (UA-12 order: scope → schema →
idempotency → correlation → paths → checks), so the "Via route" column says where each code is observable. The
fixtures carry fixed UUIDs: QA replaces `projectId`/`taskId`/`attemptId`/`baselineId`/`baselineHash` with the ids of
records created in test setup, or builds a fresh manifest with `buildResultManifest(await GET package)` and applies
the same single change.

| Name | Stage | Expected | Via route |
|---|---|---|---|
| `task-package.unknown-schema-version` | schema | 422 `unsupported_schema_version` | package parser in EXEC; for the API, bump `schemaVersion` of any POSTed manifest (R7, R10, R16) |
| `result-manifest.foreign-task` | correlation | 422 `correlation_mismatch` | R16 of the reserved task |
| `result-manifest.foreign-attempt` | correlation | 422 `correlation_mismatch` | R16 with body `attemptId` = the reserved attempt (a body `attemptId` that is unknown → 404 `attempt_not_found`) |
| `result-manifest.snapshot-for-react` | profile | 422 `revision_kind_mismatch` | R14 on a React task with `baseRevision` = the fixture's snapshot revision → 422 `revision_kind_mismatch`; via R16 correlation runs first → 422 `base_revision_mismatch` |
| `result-manifest.missing-check-fields` (no `testDefinitionHash`/`rawReportHash`) | schema | 400 `validation_failed` | R16 |
| `result-manifest.status-skipped` | schema | 400 `validation_failed` (runners must report `not_run`) | R16 |
| `reserve.duplicate-key` (`first`/`second` bodies under one key) | idempotency | 409 `idempotency_conflict` | R14 twice with the same `Idempotency-Key` |
| `reserve.automatic-mode` | schema | 400 `validation_failed` | R14 |
| `plan-proposal.cycle` (A→B→A) | dag | 422 `cycle` | R10 `source: plan_proposal` |
| `plan-proposal.self-cycle` | schema | 422 `cycle` | R10 |
| `plan-proposal.path-traversal`, `plan-proposal.absolute-path` | schema | 422 `path_not_allowed` | R10 |
| `plan-proposal.outside-profile-roots` | profile | 422 `path_not_allowed` | R10 on a `react-vite@1` project |

## Fake executor and QA scenarios (UA-26)

`buildResultManifest(taskPackage, overrides?)` builds a manifest that correlates with any `TaskPackage v1`
(git or snapshot). It is deterministic: the result revision is derived from `attemptId`, and it uses no clock and
no randomness. It emits one check per required test id (with grouped `acIds`) plus one check for every other entry of
`taskPackage.validationProfile.checks` (for the React fixture: build, lint, scan; for WP: lint). `usage` is `{ source: 'runner', values: 'unknown' }`, and `changedPaths`/`artifacts`
default to `[]`. The overrides are:
- `checkStatus: 'failed' | 'not_run'`, which sets every check;
- `resultRevision`, which also flows into the checks and `resultCommit`, and `baseRevision`, which also sets `baseCommit`;
- any manifest field, shallow-merged last (for example `attemptId` for a foreign-attempt case).

Scenario recipes against the real API (once H9 lands):
- **Replay:** POST the same built manifest twice. The second call → `200 { duplicate: true }`, adds no evidence, and re-emits `delivery_os.evidence.recorded`.
- **Foreign baseline:** build from a package, override `baselineId`/`baselineHash` → `422 baseline_mismatch`.
- **Unknown after restart:** reserve, then reconcile with `resolution: 'unknown'` → the task is `blocked` with `reconciliation_required`, and a new reserve → `409 reconciliation_required`.

## Assumptions and rules for consumers

- **A5 — proposal contracts are frozen by OSS.** `RequirementsProposal v1`, `PlanProposal v1` and
  `DesignManifest v1` follow the master plan, because the UI-03 proposal contract was not available. **UI-03 to confirm.**
  A mismatch becomes an additive v1 field or a v2, never a silent change.
- **R3 — v1 is additive-only from this commit.** Existing fields, codes, schema-version strings and paths do not
  change. A breaking need becomes `…/v2`, with a note to all streams. A profile change becomes a new profile
  version (for example `react-vite@2`).
- Profile command strings (`npm run test:report`, `npm audit --audit-level=high`, `composer run lint`, …) are OSS's
  reading of the demo repos. **EXEC to confirm** before H10. Changing one means publishing a new profile version.
- Transport objects strip unknown keys; only `SourceRevision` variants are strict. zod 4 skips cross-field
  rules when the base shape fails, so build a negative case from a valid document with exactly one change.

## Needed from other owners (patch requests, not applied)

- **UI:** add `delivery_os.errors.<code>` keys for all 53 codes in `deliveryErrorCodes`.
- **QA:** reuse `negative/*.v1.json` in the TC-DELIVERY specs. Each wrapper carries its expected status and code.

## Limitations

- No route, command or persistence yet, so correlation, idempotency and DAG are demonstrated only as pure
  functions and fixtures.
- Profile-root containment is prefix-based. Glob matching of `changedPaths` against task `allowedPaths` lands in
  `lib/allowedPaths.ts`.
- `DeliveryReport v1` has only its `schemaVersion` reserved (OSS-05).
