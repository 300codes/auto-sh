# OSS-05 (L9d): release (final acceptance) decision and route R21 — Implementation Plan

## Overview

Final acceptance (UA-17) is the second, separate human decision at the end of the delivery flow. It names one
concrete deployment evidence row. The system decides whether an `approved` verdict is even possible: the deployment
must be verified, the publish consent (deploy decision) for the same baseline hash must be approved on the same
revision, and the report (R22) on that revision must be releasable. A reject is always possible with a reason.

## Current State Analysis

- `commands/decisions.ts` handles `requirements` / `design` / `deploy`; `release` is still in `LATER_DECISION_KINDS`
  and answers `422 unsupported_evidence_kind` (test `decisions.test.ts:266`).
- `data/validators.ts:501` freezes `releaseDecisionSchema { deploymentEvidenceId, verdict, reason? }` with
  `requireReasonWhenRejected` (`422 reason_required`).
- Error catalogue (`lib/contracts.ts:60-80`) already has `deployment_unverified`, `revision_mismatch`,
  `deploy_decision_missing`, `report_not_green`, `baseline_not_active`, `deployment_incomplete` (all 422).
- ACL feature `delivery_os.release.approve` exists (`acl.ts:40`).
- The deployment payload stores the verification as `payload.verification.status` (not a flat `verificationStatus`);
  the report derives "verified" through `lib/evidenceRules.ts#deriveDeploymentVerificationStatus`
  (verified + same `buildId` + `uploadStatus succeeded`).
- Report applicability (`lib/deliveryReport.ts:277 decisionApplies`): a `release` decision applies when its
  `sourceRevision` equals the report revision and `subjectId` names a deployment row on that revision.
- `gates.releasable` = publishable + every AC passed + latest applicable deploy decision approved + newest deployment
  on the revision verified.
- `recordDeployDecision` is the pattern: parse → lock header → actor → scoped project → `em.transactional` with
  `lockProjectForWrite(..., { force: true })` → checks → report gate → append row → bump `project.updatedAt`.

## Desired End State

- `POST /api/delivery_os/projects/:id/release-decisions` with the project lock header:
  - approved, verified deployment, approved deploy decision on the same revision, releasable report →
    `201 { decisionId, projectUpdatedAt }`; row `kind release`, `subjectType deployment_evidence`,
    `subjectId = deploymentEvidenceId`, `subjectHash = baseline.contentHash`, `subjectVersion = baseline.version`,
    `sourceRevision` copied from the evidence; `project.updatedAt` bumped.
  - unverified deployment → `422 deployment_unverified`; deploy consent only on another revision → `422 revision_mismatch`;
    no deploy consent or latest one rejected → `422 deploy_decision_missing`; report not releasable → `422 report_not_green`.
  - R22 lists the release decision with `appliesToRevision: true` on the deployment's revision, `false` on another.

### Key Discoveries:

- `routeSupport.executeDeliveryCommand` merges `pathInput` last, so the route forces `kind: 'release'` and `projectId`.
- `baselineTestKit.makeHarness` accepts `services` (added in T033) and `routeTestKit` resolves the real
  `deliveryOsReportQueries` over the in-memory store.
- `isSameRevision` is exported from `lib/contracts.ts:217`.

## What We're NOT Doing

- No migration, no new error code, event, ACL feature or DTO change; `releaseDecisionSchema` stays frozen.
- No UI / i18n / integration test files (other streams) — needed keys go into the hand-over.
- No edit of `api/openapi.ts`: every delivery_os route self-documents via its `openApi` export, which `yarn generate`
  picks up (decision recorded in T033); the task wording "register it in api/openapi.ts" is satisfied by that export.
- No automatic publication or release side effects; the decision is a record only.

## Implementation Approach

Add `recordReleaseDecision` beside `recordDeployDecision` and dispatch on `kind === 'release'`; remove `release` from
`LATER_DECISION_KINDS` (the list becomes empty, so remove the stub branch). Add the route by copying R20.

Decisions made while planning (autonomous):
- **Verified rule**: use `deriveDeploymentVerificationStatus` on the payload parsed with `deploymentEvidencePayloadSchema.safeParse` (a payload that does not parse counts as unverified) — the same rule the report uses, so
  the command and the report cannot disagree.
- **Evidence resolution**: scoped lookup `{ id, tenantId, organizationId, projectId }`; missing / other project / other
  scope → `404 not_found` (path `deploymentEvidenceId`). A row of another kind → `422 unsupported_evidence_kind`
  (detail `not_deployment_evidence`). A row not on `project.activeBaselineId` → `422 baseline_not_active` (both verdicts,
  consistent with R20). A row with no `sourceRevision` → `422 deployment_incomplete`.
- **Deploy consent lookup** (approved only): deploy decisions of the project with `subjectHash = baseline.contentHash`;
  latest (by `decidedAt`) on the deployment revision: approved → ok, rejected → `deploy_decision_missing`. None on this
  revision: if the latest one on any revision is approved → `revision_mismatch` (details name both revisions), else
  `deploy_decision_missing`.
- **Order for approved**: `deployment_unverified` → deploy consent → report gate (`buildReport(scope, projectId,
  { baselineId, revision: evidence.sourceRevision }).gates.releasable`) → `report_not_green` with
  `reportBlockersToDetails`. All inside the transaction after the project row lock (writers take the same lock).
- **Revision kind**: the evidence revision kind is checked against the profile (`invalid_revision`) like R20.

## Phase 1: Release decision command and route R21

### Changes Required:

#### 1. Command

**File**: `packages/core/src/modules/delivery_os/commands/decisions.ts`

**Intent**: Add the `release` path of `delivery_os.decisions.record` with the checks above; extend
`DecisionCommandResult.kind` with `'release'`; audit label `delivery_os.audit.decisions.release`, parent = project.

**Contract**: input `{ kind: 'release', projectId, deploymentEvidenceId, verdict, reason? }` =
`releaseDecisionSchema` + `{ projectId, kind }`. Appended row as in Desired End State.

#### 2. Route + schema

**File**: `packages/core/src/modules/delivery_os/api/projects/[id]/release-decisions/route.ts`, `api/schemas.ts`

**Intent**: POST route like R20 with `requireFeatures: ['delivery_os.release.approve']`, `pathInput { projectId, kind: 'release' }`,
`openApi` (error list), response `releaseDecisionCreateResponseSchema` (`{ decisionId, projectUpdatedAt }`).

#### 3. Tests

**Files**: `commands/__tests__/decisions.test.ts`, `api/__tests__/releaseDecision.route.test.ts`

**Intent**: command: happy path + report lists the release decision with `appliesToRevision` true/false; unverified
(no verification, failed, build mismatch) → `deployment_unverified`; revision B deploy consent A → `revision_mismatch`;
later reject wins → `deploy_decision_missing`; no consent → `deploy_decision_missing`; red report → `report_not_green`; a newer failed deployment on the same revision → `report_not_green` (blocker `deployment`);
reject without reason → `reason_required`, with reason on unverified → 201; non-deployment row → 422; inactive baseline →
`baseline_not_active`; foreign org / other project → 404; 409/428. Replace the old "release until R21" test.
Route: feature guard (deploy.approve without release.approve → refused), 201 path, 422 codes, body kind cannot switch.

#### 4. Docs

**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (changelog entry), `context/changes/delivery-os-oss-domain/handover/OSS-05-L9d-release-decision.md`.

### Success Criteria:

#### Automated Verification:

- Scoped suite passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Core typecheck passes: `yarn workspace @open-mercato/core typecheck`
- `yarn generate` picks up the new route

#### Manual Verification:

- A human confirms the release gate end-to-end in the live demo (deploy consent → verified deployment → release)

## Testing Strategy

Unit tests via the in-memory harnesses (`baselineTestKit`, `routeTestKit`); live smoke against :3100 via API when
the dev server is up (best effort).

## References

- Pattern: `commands/decisions.ts#recordDeployDecision`, `api/projects/[id]/deploy-decisions/route.ts`
- Previous change: `context/changes/asd-oss-t033-add-the-deploy-publish-consent-decis/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Release decision command and route R21

#### Automated

- [x] 1.1 Scoped suite passes: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- [x] 1.2 Core typecheck passes: `yarn workspace @open-mercato/core typecheck`
- [x] 1.3 `yarn generate` picks up the new route

#### Manual

- [ ] 1.4 A human confirms the release gate end-to-end in the live demo (deploy consent → verified deployment → release)
