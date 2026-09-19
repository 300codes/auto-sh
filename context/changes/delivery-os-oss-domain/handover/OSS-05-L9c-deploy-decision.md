# OSS-05 (L9c) hand-over — deploy decision (publish consent) and route R20

Task T033 · DTO version: **unchanged** (`deployDecisionSchema` as frozen in OSS-02, `DeliveryReport v1`) · additive:
route R20, command kind `deploy` on `delivery_os.decisions.record`, response schema `deployDecisionCreateResponseSchema`,
audit key `delivery_os.audit.decisions.deploy` · no migration, event, ACL feature or error code change.

## Route

`POST /api/delivery_os/projects/:id/deploy-decisions` — feature `delivery_os.deploy.approve`, header
`x-om-ext-optimistic-lock-expected-updated-at: <project.updatedAt>`.

```json
{ "baselineId": "<active baseline id>", "sourceRevision": { "kind": "git", "commitSha": "<sha>" }, "verdict": "approved" }
{ "baselineId": "…", "sourceRevision": { … }, "verdict": "rejected", "reason": "Preview layout is broken" }
```

`201 { decisionId, projectUpdatedAt }` — use `projectUpdatedAt` as the next lock value.

| Answer | When |
|---|---|
| `400 validation_failed` | body invalid, `sourceRevision` missing / null |
| `422 reason_required` | reject without a (non-blank) reason |
| `428 optimistic_lock_required` / `409 optimistic_lock_conflict` | header missing / stale project version |
| `404 not_found` | project of another tenant / organization, archived or malformed id |
| `422 invalid_revision` (`revision_kind_mismatch`) | revision kind ≠ pinned profile (react-vite = git) |
| `422 baseline_not_active` | `baselineId` is not `project.activeBaselineId` (approve and reject) |
| `422 report_not_green` | approve while `report.gates.publishable.ok` is false on that revision |
| `422 hash_mismatch` / `unknown_target_profile` | from the report query (tampered baseline / unknown profile) |

`report_not_green` details: one per publish blocker, `{ path: '<kind>:<id>', code: '<status>', message }`, kinds
`revision | ac | scan` (e.g. `ac:AC-002` / `failed`, `ac:AC-002` / `not_run`, `scan:dependency-audit` / `missing`).
The gate is the same `deliveryOsReportQueries` R22 uses, so the report the human sees and the gate cannot disagree.
A reject is always accepted (with reason) and never checks the report.

## Binding and applicability

Row: `kind deploy`, `subjectType baseline`, `subjectId` / `subjectHash` / `subjectVersion` of the active baseline,
`sourceRevision`, `verdict`, `reason`, `actorUserId`, `decidedAt` (strictly increasing). R22 marks it
`appliesToRevision: true` only for the same revision and baseline hash; the latest applicable deploy decision feeds
`gates.releasable` (`deploy_decision` blocker) — R21 (next task) builds on that.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 50 suites, 1198 tests green
  (new: `commands/__tests__/decisions.test.ts` deploy block, `api/__tests__/deployDecision.route.test.ts`).
- Live on :3100 (`/tmp/t033/live.ts`, cleans up): approve on red → 422 `report_not_green` `ac:AC-002=missing`; reject
  without reason → 422; reject with reason → 201; stale → 409; no header → 428; snapshot revision → 422
  `invalid_revision`; foreign baseline id → 422 `baseline_not_active`; after the missing test + scan rows → approve 201;
  R22 on that revision: `publishable=true`, deploy decisions `appliesToRevision: true`; on another revision `false`.

## Patch requests

- **UI-05** (report / publish panel): POST to R20 with the report's `baselineId` and `revision`; disable "Approve
  publication" when `gates.publishable.ok` is false but still map `422 report_not_green` details (`path` split on the
  first `:` → kind / id, `code` = status) to the blocker list; reject needs a reason field. Suggested i18n keys:
  `delivery_os.audit.decisions.deploy` ("Record deploy decision"), `delivery_os.deploy.errors.report_not_green`,
  `delivery_os.deploy.errors.baseline_not_active`, `delivery_os.deploy.errors.reason_required`.
- **QA-05** (TC-DELIVERY-008 candidates): red report → 422 naming the blocker; green → 201 and R22 shows
  `appliesToRevision` true / false per revision; user with `projects.manage` only → 403; foreign org → 404.
- **EXEC**: agents never call R20 — publish consent is a human decision (`delivery_os.deploy.approve`); an AI tool pack
  must not be granted this feature.
