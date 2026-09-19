# OSS-04 (L8e) hand-over — generic evidence recording (R19)

Task T028 · DTO/contract version: **v1, unchanged** (request schema `recordEvidenceSchema` untouched) · additive:
route R19, command `delivery_os.evidence.record`, response schema `evidenceRecordResponseSchema`, derived stored field
`payload.verificationStatus` on deployment evidence · no migration, event, ACL feature, DI key, error code or fixture change.

## Contract

`POST /api/delivery_os/projects/:id/evidence`

- Feature: `delivery_os.results.import` (admin through `delivery_os.*`, employee has it). No lock header.
- Body: `{ kind, baselineId, taskId?, attemptId?, sourceRevision?, attachmentIds?, payload }`, kinds `test`, `screenshot`,
  `scan`, `deployment`, `reference_material` (payload shapes: spec changelog L2 / `data/validators.ts`).
- `201 { evidenceId, duplicate: false }`; identical replay `200 { evidenceId, duplicate: true }`, one row, no storage read.
  `taskStatus` / `taskUpdatedAt` are optional in the schema and arrive with the review kind (L8f).
- Never publishes, never changes a task, a decision or the active baseline.

| Case | Answer |
|---|---|
| project of another tenant / organization, archived, malformed id | `404 not_found` (before the body is read) |
| unknown kind / `review` (until L8f) | `422 unsupported_evidence_kind` (`unsupported_evidence_kind` / `review_not_yet_supported`) |
| kind the profile does not permit (`reference_material` outside `wordpress-theme@1`) | `422 unsupported_evidence_kind` / `kind_not_permitted_for_profile` |
| baseline or live task not of this project | `422 foreign_reference` (`foreign_baseline` / `foreign_task`) |
| attempt not on the task / unreadable attempt list | `404 attempt_not_found` / `409 reconciliation_required` |
| task or attempt pinned to another baseline | `422 baseline_mismatch` |
| `sourceRevision` kind differs from the profile (`snapshot` on `react-vite@1`, `git` on `wordpress-theme@1`) | `422 revision_kind_mismatch`, path `sourceRevision.kind` |
| test check with an AC outside the baseline (or outside the task) | `422 unknown_ac`, path `payload.checks.<i>.acIds.<j>` |
| test not declared / not mapped to the AC in the frozen `acTestMap` | `422 unknown_test_id` |
| check ran on another revision or profile version | `422 correlation_mismatch` |
| screenshot: stored bytes ≠ declared sha256, not an image, unreadable | `422 hash_mismatch` (details `sha256_mismatch`, `unsupported_mime_type`, `attachment_unreadable`) |
| screenshot or extra `attachmentIds` of another organization | `422 foreign_reference` / `attachment_scope_mismatch` |
| scan `checkId` naming a build / lint / test check of the profile | `422 unknown_test_id` / `check_id_mismatch` |
| deployment without `url`, `environment`, `buildId` or `sourceRevision` | `422 deployment_incomplete` |
| deployment without `verification` | stored, `payload.verificationStatus = 'unverified'` |
| deployment with `verification.status = verified`, same `buildId`, upload succeeded | `verificationStatus = 'verified'` |
| any other verification (another build, failed upload, failed check) | `verificationStatus = 'failed'` |
| body above 8 MB | `413 payload_too_large` |

Event: `delivery_os.evidence.recorded { projectId, taskId|null, attemptId|null, evidenceId, kind, duplicate, completionDelivery: null, tenantId, organizationId }`
on a new row and on a duplicate. Audit: one entry per new row, none for a duplicate.

## Patch requests

- **UI**: add i18n key `delivery_os.audit.evidence.record` ("Record delivery evidence"). Evidence form / import on the
  project page posts to R19; show `hash_mismatch` and `unknown_ac` details as a list (paths start with `payload.`).
  Strict copies of a deployment payload must allow `verificationStatus: 'unverified' | 'verified' | 'failed'`; render
  `unverified` and `failed` as not-success (master plan: three separate non-success states). `reference_material` rows
  must be labelled "reference only".
- **EXEC**: nothing to call here for results (keep `delivery_os.results.accept`). For screenshots and deployments made
  by the pipeline: upload the file first, then post `{ attachmentId, sha256 }`; send the deployment once without
  `verification` and again with `verification` after the URL check (append-only — a new row, the newest verified row of
  the revision counts). WordPress PoC: historical reports go in as `reference_material` with a `snapshot` revision.
- **QA** (TC-DELIVERY-008 candidates): 201 then 200 replay with one row; 403 for a user without `results.import`;
  404 foreign organization; `unknown_ac`; false screenshot hash; deployment without `buildId`; deployment without
  verification reads `unverified`; snapshot revision refused on a react-vite project and accepted on a wordpress one;
  `reference_material` refused on react-vite and leaves project progress unchanged on wordpress; PUT/DELETE answer 404.

## For the next OSS tasks

- L8f (review kind): replace the `review_not_yet_supported` stub in `parseRecordEvidenceInput`; the transaction already
  holds the project lock — lock the task after it (project → task order) and return `taskStatus` / `taskUpdatedAt`.
- OSS-05 report: read deployment state from `payload.verificationStatus` (or `deriveDeploymentVerificationStatus`);
  compute AC proof from the frozen map, never from `check.acIds` alone; `testDefinitionHash` is stored, not compared.
- Evidence may name a baseline that was never approved; proof is always computed per baseline.
- Known limitations (implementation review): one screenshot file (≤ 10 MiB) is read while the project row lock is held;
  a failed post-commit emit is not repaired by the retry (same pattern as `results.accept`) — candidates for OSS-06.
- Ids are compared and hashed case-insensitively, so the same body with uppercase uuids is still a duplicate.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 44 suites, 1074 tests passed
  (new: `lib/__tests__/evidenceRules.test.ts` 17, `commands/__tests__/evidence.test.ts` 26, `api/__tests__/evidence.route.test.ts` 8).
- Core typecheck passed; eslint clean on the touched files; `yarn generate` registered the route.
- Live smoke on http://localhost:3100 (`/tmp/t028/live.ts`, re-run on the final build): each kind 201 then 200 with the same id and one row; all
  refusals above answered the listed codes; deployment statuses `unverified, verified, failed`; wordpress project
  accepted a snapshot `reference_material` and its status and progress did not change; PUT and DELETE → 404; one audit
  entry per new row; cleanup left 0 rows.
