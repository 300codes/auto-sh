# OSS-05 (L9c): deploy (publish consent) decision and route R20 — Implementation Plan

## Overview

The human "publish consent" (UA-16) is the first of the two separate human decisions at the end of the
delivery flow. The system — not the agent — decides whether consent can even be given: an `approved` deploy
decision is accepted only when the same report the UI shows (R22) says the active baseline is publishable
on the chosen revision. A reject is always possible with a reason.

## Current State Analysis

- `commands/decisions.ts` registers `delivery_os.decisions.record` for `requirements` / `design` only;
  `deploy` / `release` are refused with `422 unsupported_evidence_kind` (`LATER_DECISION_KINDS`).
- `data/validators.ts:491` already freezes `deployDecisionSchema { baselineId, sourceRevision (required), verdict, reason? }`
  with `requireReasonWhenRejected` (→ `422 reason_required`).
- `commands/reportQueries.ts` exposes DI `deliveryOsReportQueries.buildReport(scope, projectId, { baselineId, revision })`;
  it validates profile (`unknown_target_profile`), revision kind (`invalid_revision` / `revision_kind_mismatch`) and
  stored hash (`hash_mismatch`). It forks the root EM (reads committed data).
- `lib/deliveryReport.ts:277` `decisionApplies`: a `deploy` decision applies when `subjectType baseline`,
  `subjectHash = baseline.contentHash` and `sourceRevision` equals the report revision. `gates.publishable`
  blockers: `revision | ac | scan` with `{ kind, id, status }`.
- `DeliveryDecision` entity already has `source_revision jsonb` — **no migration needed**.
- Error catalogue already contains `report_not_green`, `baseline_not_active`, `invalid_revision`, `reason_required` (422).
- ACL feature `delivery_os.deploy.approve` exists (`acl.ts`).
- Route pattern: `api/baselines/[id]/decisions/route.ts` (`executeDeliveryCommand` → mutation guards → command bus;
  `pathInput` overrides body keys).

## Desired End State

- `POST /api/delivery_os/projects/:id/deploy-decisions` with the project lock header:
  - approved on a green report → `201 { decisionId, projectUpdatedAt }`; the row is `kind deploy`, `subjectType baseline`,
    `subjectId baselineId`, `subjectHash contentHash`, `subjectVersion`, `sourceRevision` stored; `project.updatedAt` bumped.
  - approved on a non-green report → `422 report_not_green`, details list every publish blocker.
  - GET report on the same revision lists the decision with `appliesToRevision: true`; on another revision `false`.
- Verified by `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` and a live smoke on :3100.

### Key Discoveries:

- `routeSupport.ts executeDeliveryCommand` merges `{ ...body, ...guardPayload, ...pathInput }` — so the route can force
  `kind: 'deploy'` and `projectId` from the path; a body `kind` can never switch the route to another decision kind.
- `baselineTestKit.makeHarness` resolves only `em`, `dataEngine`, `deliveryOsAttachmentInspector` — tests need an
  additive `services` option to inject `deliveryOsReportQueries`.
- `routeTestKit` already resolves the real `deliveryOsReportQueries` over the in-memory store (evidence included).

## What We're NOT Doing

- Release decision (R21, next task) — `release` stays refused with `unsupported_evidence_kind`.
- No migration, no new error code, no new ACL feature, no new event, no UI/i18n files (UI stream).
- No change to the frozen `deployDecisionSchema` (sourceRevision stays required).
- No change to `api/openapi.ts`: routes self-document via their `openApi` export (the file is only a helper factory; no
  other route registers there).

## Implementation Approach

Branch inside the existing command on `kind === 'deploy'` (decision already made: one atomic, project-lock-bound
decision path). The deploy branch:

1. Parse `deployDecisionSchema` + `projectId` (path) → 400 / 422 `reason_required`.
2. `requireLockHeader` (428), `requireActorUserId` (403).
3. Read-EM: `requireScopedProject` (404 for foreign scope / archived project).
4. Transaction: `lockProjectForWrite(..., { force: true })` (409 stale); profile check (`422 unknown_target_profile`),
   revision kind check (`422 invalid_revision` / `revision_kind_mismatch`); `baselineId !== project.activeBaselineId`
   → `422 baseline_not_active`; load baseline (scoped, same project).
   If `approved`: `deliveryOsReportQueries.buildReport(scope, projectId, { baselineId, revision })`; `!gates.publishable.ok`
   → `422 report_not_green` with one detail per blocker.
   Create the decision row (decidedAt via `nextDecidedAt` over the project's deploy decisions), set `project.updatedAt = decidedAt`.
5. CRUD side effects as for other decisions; result `{ decisionId, projectId, baselineId, kind: 'deploy', verdict,
   activeBaselineId: project.activeBaselineId, activeBaselineChanged: false, projectUpdatedAt }`.

## Critical Implementation Details

- **Blocker → frozen detail mapping**: the error body detail schema is `{ path?, code, message? }`, so each blocker
  `{ kind, id, status }` maps to `{ path: '<kind>:<id>', code: '<status>', message: '<kind> <id> is <status>' }`
  (e.g. `ac:AC-002` / `missing`, `scan:dependency-audit` / `missing`). Documented in the hand-over for UI-05.
- **Report read timing**: the report is built after the project row lock is taken (so a concurrent decision writer on
  the same project is serialised) and before the insert; the report query uses its own fork and reads committed rows.
  Keep "no query after persist". This is safe because every evidence/result writer takes the project row lock
  first (`commands/evidence.ts:509`, `commands/attempts.ts:148`): while R20 holds it nothing new can commit, and
  everything committed before is visible to the fork. Never move the report read before `lockProjectForWrite`.
- **Audit label**: for kind deploy `buildLog` uses `delivery_os.audit.decisions.deploy` (fallback "Record deploy decision")
  with the project as parent resource; the key is listed in the hand-over for the UI i18n owner.
- `LATER_DECISION_KINDS` becomes `['release']`; the existing test for deploy/release refusal is updated to release only.

## Phase 1: Deploy decision command, route R20 and tests

### Changes Required:

#### 1. Command

**File**: `packages/core/src/modules/delivery_os/commands/decisions.ts`

**Intent**: accept kind `deploy` with the gate and bindings above; keep requirements/design untouched.

**Contract**: `DecisionCommandResult.kind` widens to `'requirements' | 'design' | 'deploy'`; command input for deploy =
`deployDecisionSchema` + `projectId` (uuid) + `kind: 'deploy'`. Exported helper `reportBlockersToDetails(blocking)`.

#### 2. Route

**File**: `packages/core/src/modules/delivery_os/api/projects/[id]/deploy-decisions/route.ts` (new)

**Intent**: `POST`, `metadata { requireAuth, requireFeatures: ['delivery_os.deploy.approve'] }`, `executeDeliveryCommand`
with `pathInput { projectId, kind: 'deploy' }`, resourceKind project, `201 { decisionId, projectUpdatedAt }`, error body via
`deliveryErrorResponse`; `openApi` with `deployDecisionSchema` request and a new `deployDecisionCreateResponseSchema`
(`api/schemas.ts`) + errors 400/404/409/422/428.

#### 3. Test kit

**File**: `commands/__tests__/baselineTestKit.ts` — additive `services` option on `makeHarness`.

#### 4. Tests

- `commands/__tests__/decisions.test.ts`: green report → 201-equivalent result, row bindings, `project.updatedAt` bumped,
  next report `appliesToRevision` true on that revision / false on another; failed AC, `not_run` (skipped) AC, missing scan,
  a revision without results → `422 report_not_green` naming the blocker; `sourceRevision: null` → `400 validation_failed`;
  reject without reason → 422; reject on a red report → accepted; not active baseline → 422 `baseline_not_active`;
  snapshot revision on git profile → 422 `invalid_revision`; stale lock → 409; missing header → 428; foreign org → 404;
  release still refused.
- `api/__tests__/deployDecision.route.test.ts`: via routeTestKit — manage-only actor → 403, 401 without session,
  red report → 422 listing blockers, green → 201 then GET R22 shows `appliesToRevision` true/false; body `kind` cannot
  override the route; foreign tenant/org → 404; 428 without header.

#### 5. Docs

- `.ai/specs/2026-09-18-delivery-os-hackathon.md` changelog entry (L9c).
- `context/changes/delivery-os-oss-domain/handover/OSS-05-L9c-deploy-decision.md`.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- Scoped tsc / eslint on touched files pass
- `yarn generate` registers `/api/delivery_os/projects/[id]/deploy-decisions`; core build succeeds
- Live smoke on :3100: approved on a red report → 422 `report_not_green`; green → 201; GET report shows `appliesToRevision` true / false

#### Manual Verification:

- UI-05 / QA-05 give publish consent on a real demo project and see it in the report (human)

## Testing Strategy

Unit tests run the real `createDeliveryOsReportQueries` over the in-memory store (not a stub), so the gate and the
report can never disagree in tests either. Evidence rows for green tests: one `test` row with both AC tests passed,
one passed `dependency-audit` scan, one approved human `review` for the manual check on the chosen revision.

## References

- `lib/deliveryReport.ts:277-343` (applicability, gates), `commands/reportQueries.ts`, `api/baselines/[id]/decisions/route.ts`
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` rows R20 / UA-16

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Deploy decision command, route R20 and tests

#### Automated

- [x] 1.1 `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- [x] 1.2 Scoped tsc / eslint on touched files pass
- [x] 1.3 `yarn generate` registers `/api/delivery_os/projects/[id]/deploy-decisions`; core build succeeds
- [x] 1.4 Live smoke on :3100: approved on a red report → 422 `report_not_green`; green → 201; GET report shows `appliesToRevision` true / false

#### Manual

- [ ] 1.5 UI-05 / QA-05 give publish consent on a real demo project and see it in the report (human)
