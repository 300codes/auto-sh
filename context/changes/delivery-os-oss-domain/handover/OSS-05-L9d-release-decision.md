# OSS-05 (L9d) hand-over — release decision (final acceptance) and route R21

Task T034 · DTO version: **unchanged** (`releaseDecisionSchema` as frozen in OSS-02, `DeliveryReport v1`) · additive:
route R21, command kind `release` on `delivery_os.decisions.record`, response schema `releaseDecisionCreateResponseSchema`,
exported helper `checkDeployConsent`, audit key `delivery_os.audit.decisions.release` · no migration, event, ACL feature
or error code change.

## Route

`POST /api/delivery_os/projects/:id/release-decisions` — feature `delivery_os.release.approve` (publish consent
`deploy.approve` alone is not enough), header `x-om-ext-optimistic-lock-expected-updated-at: <project.updatedAt>`.

```json
{ "deploymentEvidenceId": "<deployment evidence id from report.deployment.evidenceId>", "verdict": "approved" }
{ "deploymentEvidenceId": "…", "verdict": "rejected", "reason": "Header overlaps the menu on mobile" }
```

`201 { decisionId, projectUpdatedAt }` — use `projectUpdatedAt` as the next lock value.

| Answer | When |
|---|---|
| `400 validation_failed` | body invalid |
| `422 reason_required` | reject without a (non-blank) reason |
| `428` / `409` | lock header missing / stale project version |
| `404 not_found` | project out of scope; evidence id unknown, of another project, tenant or organization (path `deploymentEvidenceId`) |
| `422 unsupported_evidence_kind` (`not_deployment_evidence`) | the row is not a `deployment` row |
| `422 baseline_not_active` | the deployment belongs to a baseline that is not active (approve and reject) |
| `422 deployment_incomplete` | the row has no stored revision |
| `422 deployment_unverified` | approve: not verified (no verification, `failed`, `observedBuildId ≠ buildId`, upload failed) |
| `422 revision_mismatch` (`deploy_revision_mismatch`) | approve: publish consent names another revision |
| `422 deploy_decision_missing` (`deploy_decision_missing` / `deploy_decision_rejected`) | approve: no consent for this revision, or the latest one is a reject |
| `422 report_not_green` | approve: `report.gates.releasable.ok` false on the deployed revision (details `<kind>:<id>` = status) |

Order for an approve: verified → consent → report gate, all after the project row lock. A reject only needs a reason.
"Verified" is decided by `lib/deliveryReport.ts#isVerifiedDeploymentPayload`, the same parser the report uses.

Known limit (same as R20): the report gate is read on its own connection after the project lock; R19 evidence writers
take the project lock, but result-manifest acceptance (`commands/evidence.ts` results path) locks only the task, so a
result committed in the same instant may be missed by the gate. The effect is a refusal or an acceptance based on the
state just before that result; a human sees the same report. Candidate for OSS-06 if it matters.

## Binding and applicability

Row: `kind release`, `subjectType deployment_evidence`, `subjectId = deploymentEvidenceId`, `subjectHash` /
`subjectVersion` of the active baseline, `sourceRevision` copied from the deployment row. R22 shows it with
`appliesToRevision: true` only on that revision; a new revision never inherits an old acceptance.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → see the task report (new: release
  block in `commands/__tests__/decisions.test.ts`, `api/__tests__/releaseDecision.route.test.ts`).
- `yarn workspace @open-mercato/core typecheck` → clean. `yarn generate` registers the route.

## Patch requests

- **UI-05** (report / acceptance panel): show "Accept release" only with `delivery_os.release.approve`; send
  `report.deployment.evidenceId`; disable approve when `gates.releasable.ok` is false but still map every 422 code
  above; reject needs a reason field. Suggested i18n keys: `delivery_os.audit.decisions.release` ("Record release
  decision"), `delivery_os.release.errors.deployment_unverified`, `…revision_mismatch`, `…deploy_decision_missing`,
  `…report_not_green`, `…reason_required`.
- **QA-05** (TC-DELIVERY-009 candidates): verified deployment + approved deploy on the same revision + green report →
  201 and R22 lists the release decision `appliesToRevision: true`; unverified → 422 `deployment_unverified`; deploy
  consent on A, deployment on B → 422 `revision_mismatch`; deploy approve then reject → 422 `deploy_decision_missing`;
  user with only `deploy.approve` → 403.
- **EXEC**: agents never call R21 — final acceptance is a human decision. EXEC records the deployment row (R19,
  `kind deployment` with `verification`) that R21 names.
