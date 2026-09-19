---
date: 2026-09-19T09:23:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 3a23d593b
branch: dev-mateusz
repository: open-mercato
topic: "How to build delivery_os.evidence.record (R19) on the existing delivery_os module"
tags: [research, codebase, delivery_os, evidence]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: delivery_os.evidence.record (R19)

## Research Question

Which helpers does R19 reuse, how does it stay append-only and idempotent by canonical payload hash per
(project, kind, task, attempt), and where must `reference_material` be ignored?

## Summary

Everything R19 needs except the command and the route already exists. The request schema
(`data/validators.ts#parseRecordEvidenceBody`, `recordEvidenceSchema`) is frozen and tested; the check-mapping helper
(`lib/resultChecks.ts#checkReportedChecks`, takes `pathPrefix`) was written in L8b for reuse; stored files are verified
by `commands/attachments.ts#verifyAttachmentReferences`; profile rules live in `lib/targetProfiles.ts`
(`assertRevisionKind`, `isEvidenceKindPermitted`, `countsAsAcEvidence`). The table has a non-unique lookup index
`(tenant, org, project, kind, payload_hash)` and no unique index for generic kinds, so idempotency is decided in the
application under the project row lock (`lockScopedProject`) — no migration. `reference_material` is already ignored by
`countsAsAcEvidence`, `checkVerification` and the traceability flag, each with a test; the only missing assertion is
that it does not move `deriveProjectStatus` progress.

## Detailed Findings

### Contract (spec `.ai/specs/2026-09-18-delivery-os-hackathon.md`)
- R19 row (:285): `POST /projects/:id/evidence`, feature `delivery_os.results.import`, no lock header.
- UA-13 row (:308): request `{ kind, taskId?, attemptId?, baselineId, sourceRevision?, payload, attachmentIds? }`,
  response `201 { evidenceId, duplicate, taskStatus?, taskUpdatedAt? }` (task fields only on a review transition);
  errors 422 `unknown_ac`, `unknown_test_id`, `hash_mismatch`, `deployment_incomplete`, `revision_kind_mismatch`,
  `unsupported_evidence_kind`, `missing_required_tests`, `baseline_mismatch`; 409 `invalid_transition`; 404.
- Event (:221): `delivery_os.evidence.recorded { projectId, taskId?, attemptId?, evidenceId, kind, duplicate,
  completionDelivery?, tenantId, organizationId }`; scope also passed as emit options (:223).
- Append-only (:27, :129); `payload_hash` = sha256 of canonical payload, `raw_report_hash` for tests and scans (:139-140).
- Profile table (:191): `reference_material` permitted only by `wordpress-theme@1`; WP revision kind is `snapshot`.
- Master plan `plan.md:133`: the endpoint does not publish; `plan.md:198`: upload without URL verification is `unverified`.

### Reusable code
- `data/validators.ts:292-441` — schemas, `REVISION_REQUIRED_KINDS = test, review, scan`, `deployment_incomplete`
  issues, `parseRecordEvidenceBody` (unknown kind → 422 `unsupported_evidence_kind`).
- `lib/resultChecks.ts:40` `checkReportedChecks({ checks, resultRevision, validationProfile, acceptanceCriteriaIds,
  knownTestIds, pathPrefix })`; called for results at `lib/resultAcceptance.ts:126-137`.
- `lib/taskPackage.ts:101-126` — how the AC of a task and the frozen `requiredTests` are cut from the baseline
  content (`baselineContentV1Schema`, hash intact check).
- `commands/attachments.ts:87` `verifyAttachmentReferences(tx, ctx, references, scope)`; `:145` `verifyResultArtifacts`
  shows the error mapping (`attachment_scope_mismatch` → `foreign_reference`).
- `commands/shared.ts` — `lockScopedProject`, `requireScopedTask`, `resolveDeliveryScope`, `deliveryHttpError`;
  `commands/tasks.ts#findProjectBaseline`.
- `commands/evidence.ts:55,178-209` — `evidenceCrudIndexer`, emit + `emitCrudSideEffects` template.
- `api/tasks/[id]/results/route.ts` — sibling route: scope-first 404, body cap 8 MB, `pathInput` wins over body,
  `duplicate ? 200 : 201`. `api/projects/[id]/baselines/route.ts` — project-scoped shape.
- `DeliveryEvidenceSource = 'adapter' | 'manual'` (`data/entities.ts:14`); R19 is operator-facing → `manual`.

### Pinned guards to update (`commands/__tests__/scopeChange.test.ts`)
- :260-278 command id list and :280-285 append-only list — add `delivery_os.evidence.record`; no `undo` allowed.
- :293 append-only route list — add `projects/[id]/evidence/route.ts`; POST only.
- `__tests__/module-registration.test.ts` needs no change (no new feature or event).

### Test kits
- Command tests: `commands/__tests__/baselineTestKit.ts` (`makeProject`, `makeBaseline`, `makeAttachmentInspector`,
  `catchHttpError`, `expectFrozenBody`, `detailCodes`, `getHandler`); `results.test.ts:181-215` local harness whose
  `persist` pushes into `store.evidence`.
- Route tests: `api/__tests__/routeTestKit.ts` (`routeState.store.evidence`, `signInAs`, `apiRequest`, `routeParams`,
  `expectFrozenError`, `isAllowedBy`, `FOREIGN_TENANT_ID`), five standard `jest.mock` calls.

### reference_material
- `lib/targetProfiles.ts:52,185` `AC_EVIDENCE_KINDS = result_manifest, test, review`.
- Tests exist: `targetProfiles.test.ts:146`, `taskLifecycle.test.ts:124`, `traceability.test.ts:87`.
- `lib/projectStatus.ts:85-106` — progress reads task status only; evidence is read only for `result_manifest`.
  No test feeds `reference_material` → add one.

## Open Questions (answered in the plan)
- Test evidence without `taskId`: validated against the whole baseline map.
- Scan `checkId` vs profile checks; deployment verification status derivation.
