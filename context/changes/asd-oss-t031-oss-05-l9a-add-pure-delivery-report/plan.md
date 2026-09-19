# OSS-05 L9a — pure delivery report rules: Implementation Plan

## Overview

Add `lib/deliveryReport.ts`, a pure function that turns baseline content, tasks, evidence rows, decisions, the
target profile and a selected revision into `DeliveryReport v1`: requirement → AC → task → revision → tests →
deployment rows, per-AC status, scan and deployment status, the publish and release gates with blocking lists,
decision applicability and an explicit progress denominator. The schema is added to `lib/contracts.ts`
(additive, `delivery.report/v1` already reserved) with a fixture. Nothing here touches the ORM, routes or commands.

## Current State Analysis

- `lib/acProof.ts` (`proveAcceptanceCriteria`) already computes `passed | failed | not_run | missing` per AC from
  `result_manifest` / `test` checks and human `review` verdicts, filtered by `baselineId` and exact `sourceRevision`.
  It has no `manual_pending`, no scan, deployment, decision or gate logic and no `rawReportHash` on test proofs.
- `lib/traceability.ts` (`buildTraceability`) builds the requirement → AC → task → evidence skeleton with a row
  limit (`MAX_TRACEABILITY_ROWS = 1000`, `clampTraceabilityLimit`) and `unknown_ac` issues. It is not revision-aware.
- `lib/projectStatus.ts` has `buildProgress(proven, total)` (`unit: 'ac'`, `percent: null` when total is 0).
- `lib/evidenceRules.ts` has `deriveDeploymentVerificationStatus`; `commands/evidence.ts:494` stores
  `payload.verificationStatus` on deployment rows and `rawReportHash` on `test`/`scan` rows only.
- `lib/targetProfiles.ts`: `profile.checks[]` with `kind: 'scan'` and `required`; `react-vite@1` has the required
  scan `dependency-audit`.
- `DELIVERY_SCHEMA_VERSIONS.report = 'delivery.report/v1'` is reserved but has no schema; `deliveryDocumentSchemas`
  drives `parseVersioned`, which rejects unknown `schemaVersion` values.
- `deliveryErrorCodes` already has `report_not_green`, `deployment_unverified`, `revision_mismatch`,
  `deploy_decision_missing`, `invalid_revision` (contract frozen, unchanged here).
- Decisions (`data/entities.ts:278`): `kind` requirements/design/deploy/release, `subjectType`
  baseline/deployment_evidence, `subjectId`, `subjectHash`, `sourceRevision | null`, `verdict`, `decidedAt`.
  `commands/decisions.ts:121` still refuses deploy/release (`unsupported_evidence_kind`) — R20/R21 are later L9 tasks.
- Master plan: F3 (AC→test map frozen, complete required results on the final revision), Phase 4 (task-commit
  results never inherit PASS to the integration commit; the report selects by final revision, baseline, profile),
  Phase 5 (deployment evidence, release gate = same commit; missing security check or preview verification blocks
  final acceptance), "Wskazówki": `not_run`, `missing`, `unverified` are three distinct states; usage unknown ≠ 0.
- Recorded decisions (T029): runner `skipped` is `not_run`; `not_run`/`missing`/`failed` never count as passed; a
  fix is a new revision; an agent never decides a manual check; nothing publishes automatically.

## Desired End State

- `lib/deliveryReport.ts` exports `buildDeliveryReport(input): DeliveryReportV1`, `selectDefaultRevision(evidence)`
  and the input types. It is pure (no ORM, no DI, no I/O).
- `lib/contracts.ts` exports `deliveryReportV1Schema` / `DeliveryReportV1` (+ the small enum schemas) and registers
  it in `deliveryDocumentSchemas`.
- `lib/fixtures/delivery-report.v1.json` parses with the schema; `loadDeliveryReportFixture()` and a
  `positiveDeliveryFixtures` entry exist.
- `lib/__tests__/deliveryReport.test.ts` proves the acceptance list in wrong-vs-right pairs and is green with
  `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2`.

### Key Discoveries:

- `proveAcceptanceCriteria` returns `missing` both for "no test on the revision" and for "manual verdict absent";
  the report needs the AC's `manualCheck`/`tests` detail to tell `manual_pending` apart (`lib/acProof.ts:104-111`).
- `checkStatusSchema` has no `skipped`; a check with `status: 'skipped'` fails `reportedCheckSchema.safeParse` and is
  silently dropped by acProof (`lib/acProof.ts:66-71`). The report must normalise `skipped`/`todo` → `not_run`
  before proving so the AC shows `not_run`, not `missing`.
- Per-check `rawReportHash` lives in `payload.checks[].rawReportHash` (`resultCheckSchema`), the row-level
  `rawReportHash` is null for `result_manifest` rows (`commands/evidence.ts:214`).
- `deploymentEvidencePayloadSchema` has `verification: null | { status, observedBuildId, … }`; stored rows also carry
  `verificationStatus`. Deriving from the raw facts with `deriveDeploymentVerificationStatus` works for both.

## What We're NOT Doing

- No report route (R22), no deploy/release decision commands (R20/R21), no OpenAPI, no UI, no i18n.
- No migration, entity, event, ACL, DI, error-code or validator change. No change to `acProof.ts` or
  `traceability.ts` beyond reuse.
- No aggregation of usage across manifests (no invented totals), no cost-in-USD.
- No edits to the master plan Progress or other streams' files.

## Implementation Approach

One pure module. The skeleton (requirement → AC → task, unknown-AC issues, limit/truncation) comes from
`buildTraceability` called with the baseline, tasks and **no evidence**; each skeleton link is expanded into one
row per required test (plus one for a manual check, or a single row when the AC maps to nothing). Per-AC status
comes from `proveAcceptanceCriteria` on the evidence of the selected revision, refined to `manual_pending`.
Scans, deployment, decisions and gates are computed alongside. All ids and hashes in the output come from stored
rows, so the UI can drill from any row to the evidence and the raw report hash.

### Decisions (answered from the plan, the criteria and the code)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Does `manual_pending` block **publish**? | No. `publishable` needs every AC to be `passed` or `manual_pending` (all required tests passed on the revision, no `failed`/`not_run`/`missing`), plus every required scan `present`. `releasable` additionally needs every AC `passed`. | The preview is what the human reviews (plan 5.4); blocking publish on the manual check would stall the flow with no safety gain. Least human involvement in the loop (criterion 4) with the "system decides" gate intact (criterion 1). |
| 2 | Scan status mapping | `present` = a `passed` result; `failed` = any `failed` result on the revision (failed dominates); `missing` = no result or only `not_run`. The row keeps `reportedStatus: passed/failed/not_run/null` and the `evidenceId`. | Task enum is fixed to three states; `not_run` stays visible through `reportedStatus` so the DTO never folds it. |
| 3 | Where scan results come from | `scan` evidence rows (`payload.checkId`) **and** checks in `result_manifest`/`test` rows whose `checkId` is a required scan; both must be on the baseline and revision. | The runner reports `dependency-audit` inside the manifest for react-vite@1; a separate scan row is the manual path. |
| 4 | Default revision | `selectDefaultRevision`: the newest `result_manifest` row of the baseline with a non-null `sourceRevision` (by `createdAt`, later input position wins a tie). None → `revision: null`, `revisionSource: 'none'`, every AC `missing`, both gates blocked by `{ kind: 'revision', id: 'revision', status: 'missing' }`. | Matches the task text and the spec (R22 "default latest integration revision"). The integration commit is always the last accepted result. |
| 5 | Row shape | `{ requirementId, acId, taskId, taskStatus, acStatus, testId, testStatus, manualCheckId, evidenceId, rawReportHash, deploymentEvidenceId }` built from the traceability skeleton and the AC proof; `rawReportHash` = the matching check's hash, else the row's hash, else null. | Literal requirement → AC → task → revision → test → deployment chain; every row links to evidence and hash. |
| 6 | Decision applicability | `deploy`: `subjectHash === baselineHash` and `isSameRevision(decision.sourceRevision, revision)`. `release`: its `sourceRevision` matches and its `subjectId` names a deployment row of this baseline on this revision. `requirements`/`design`: `subjectHash === baselineHash`. Releasable requires the **latest** deploy decision for the (hash, revision) pair to be `approved`. | "Zmiana rewizji unieważnia zastosowanie dawnych decyzji"; a later reject must win over an earlier approve. |
| 7 | Usage | `usage[]`: one entry per `result_manifest` row on the revision `{ evidenceId, source, values }`, values copied through (`'unknown'` literal stays). | Never renders unknown as 0; no invented totals. |
| 8 | `skipped` | Before proving, check statuses `skipped`/`todo` are normalised to `not_run` (pure, report-side). Import already refuses them, so this only protects the report from foreign rows. | Acceptance: "failed / skipped / not_run each block". |
| 9 | Schema registration | `deliveryReportV1Schema` is added to `deliveryDocumentSchemas`. | Additive; `parseVersioned` then rejects an unknown report `schemaVersion` with the frozen 422 body. |
| 10 | Deployment | Rows of kind `deployment` on the baseline **and** revision; the newest wins. `verified` only when `deriveDeploymentVerificationStatus` says so; `unverified` otherwise (with `verificationStatus` detail); `missing` when no row. Snapshot revisions compare with `isSameRevision`. | The verified row is posted later as a new row (L8e hand-over); latest truth wins. |

## Phase 1: Contract, fixture and report rules

### Overview

Add the schema, the pure builder and the fixture; register the fixture in the loaders.

### Changes Required:

#### 1. DeliveryReport v1 schema

**File**: `packages/core/src/modules/delivery_os/lib/contracts.ts`

**Intent**: Freeze the report DTO additively so UI-05 can build on it.

**Contract**: `deliveryReportV1Schema = z.object({ schemaVersion: literal('delivery.report/v1'), projectId, baselineId,
baselineHash, targetProfile: { id, version }, revision: sourceRevisionSchema.nullable(), revisionSource:
enum('selected' | 'latest_result' | 'none'), acceptanceCriteria: [{ acId, requirementId, description, status:
reportAcStatusSchema, taskIds[], tests: [{ testId, status: passed|failed|not_run|missing, evidenceId|null,
rawReportHash|null }], manualCheck: { manualCheckId, status: approved|changes_requested|missing, evidenceId|null } | null }],
rows: [deliveryReportRowSchema], totalRows, truncated, limit, issues: [{ code: 'unknown_ac', taskId, acId }],
scans: [{ checkId, status: present|missing|failed, reportedStatus: checkStatus|null, evidenceId|null, rawReportHash|null }],
deployment: { status: verified|unverified|missing, evidenceId|null, verificationStatus: verified|unverified|failed|null,
url|null, environment|null, buildId|null }, gates: { publishable: gate, releasable: gate } where gate =
{ ok: boolean, blocking: [{ kind: ac|scan|deployment|deploy_decision|revision, id, status }] },
decisions: [{ id, kind, verdict, subjectType, subjectId, subjectHash, sourceRevision|null, decidedAt, reason|null,
appliesToRevision }], progress: { proven, total, unit: 'ac', percent|null }, usage: [{ evidenceId, source, values }] })`.
Register under `deliveryDocumentSchemas[DELIVERY_SCHEMA_VERSIONS.report]`. The schema must stay a top-level `z.object`
(the schema-map test reads `schema.shape`; plan review F3).

#### 2. Pure report rules

**File**: `packages/core/src/modules/delivery_os/lib/deliveryReport.ts`

**Intent**: Compute the report from stored rows only, per baseline, selected revision and profile.

**Contract**: `buildDeliveryReport(input: DeliveryReportInput): DeliveryReportV1` with
`DeliveryReportInput = { projectId, baseline: { id, projectId, contentHash, content: Pick<BaselineContentV1,
'requirements'|'acceptanceCriteria'|'acTestMap'|'manualChecks'> }, tasks: TraceabilityTask[], evidence:
DeliveryReportEvidence[] ({ id, projectId, baselineId, taskId, kind, sourceRevision, payload, rawReportHash, createdAt }),
decisions: DeliveryReportDecision[], profile: TargetProfile, revision: SourceRevision | null, limit }`;
`selectDefaultRevision(evidence, baselineId): SourceRevision | null`. Rules per the decisions table. The traceability
skeleton is built with `MAX_TRACEABILITY_ROWS` (never the caller's limit); the caller's limit and `truncated` apply to the
expanded rows and `totalRows` counts expanded rows (plan review F1). Revision kind vs profile is validated by the route
(`invalid_revision`), not here (plan review F2). AC status:
`failed` if acProof failed; `not_run` if acProof not_run; `missing` if any required test is missing; `manual_pending`
if the only gap is an absent human verdict; else `passed`. Rows are limited with `clampTraceabilityLimit`; `totalRows`
counts all, `truncated = totalRows > limit`.

#### 3. Fixture and loaders

**Files**: `packages/core/src/modules/delivery_os/lib/fixtures/delivery-report.v1.json`,
`packages/core/src/modules/delivery_os/lib/fixtures/index.ts`

**Intent**: A realistic green-for-publish, not-yet-releasable report for UI/QA, parsed by the schema in the fixture test.

**Contract**: `loadDeliveryReportFixture(): DeliveryReportV1`; entry `{ name: 'delivery-report', schema:
deliveryReportV1Schema, document }` in `positiveDeliveryFixtures`.

### Success Criteria:

#### Automated Verification:

- Fixture and contract suites green: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/fixtures.test.ts src/modules/delivery_os/lib/__tests__/contracts.test.ts --maxWorkers=2`

---

## Phase 2: Tests in wrong-vs-right pairs

### Overview

`lib/__tests__/deliveryReport.test.ts` derived from F3 / Phase 5, each rule as a failing case next to its passing twin.

### Changes Required:

#### 1. Report tests

**File**: `packages/core/src/modules/delivery_os/lib/__tests__/deliveryReport.test.ts`

**Intent**: Prove every acceptance bullet of T031 plus the default-revision rule and the row/hash drill-down.

**Contract**: Pairs — no test on the revision → `missing`, not publishable / same test on the revision → `passed`,
publishable; `failed`, `skipped`, `not_run` each block publish / `passed` does not; missing required scan blocks /
present scan passes; unverified deployment blocks release but not publish / verified releases; approved deploy
decision for A → `appliesToRevision: false` on B and B not releasable / applies on A and A releasable; manual AC
`manual_pending` until a human review, agent review ignored / human approval → `passed`; task-commit evidence not
inherited by the integration revision; default revision = newest result manifest; usage `'unknown'` preserved;
rows carry `evidenceId` + `rawReportHash`; `truncated` with a small limit; fixture parses; unknown `schemaVersion`
rejected via `parseVersioned`; later rejected deploy decision voids an earlier approval.

### Success Criteria:

#### Automated Verification:

- Lib suite green: `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2`
- Scoped delivery_os suite green: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Scoped typecheck clean: `tsc -p /tmp/t031/tsconfig.json` (extends the core tsconfig, includes the new files)

#### Manual Verification:

- QA-05 / UI-05 confirm the DTO against the report route once R22 lands (joint, Progress 5.4)

---

## Testing Strategy

### Unit Tests:

Pure-function tests with hand-built rows using the baseline-content and result-manifest fixtures, in the style of
`acProof.test.ts`. Every negative case has a positive twin so the rule, not a coincidence, is what passes.

## References

- Master plan Phase 4/5, F3 (`context/changes/autonomous-software-delivery/reviews/plan-review.md:52`)
- `lib/acProof.ts`, `lib/traceability.ts`, `lib/projectStatus.ts:60`, `lib/evidenceRules.ts:96`
- Hand-over `context/changes/delivery-os-oss-domain/handover/OSS-04-H21.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract, fixture and report rules

#### Automated

- [x] 1.1 Fixture and contract suites green

### Phase 2: Tests in wrong-vs-right pairs

#### Automated

- [x] 2.1 Lib suite green
- [x] 2.2 Scoped delivery_os suite green
- [x] 2.3 Scoped typecheck clean

#### Manual

- [ ] 2.4 QA-05 / UI-05 confirm the DTO against the report route once R22 lands
