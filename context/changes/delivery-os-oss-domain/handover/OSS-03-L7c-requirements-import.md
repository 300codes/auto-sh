# OSS-03 (L7c) hand-over — requirements-proposal import on R7

Task T021 · DTO/contract version: **v1, additive** · no migration, no generated file, no workspace change.

## What works

`POST /api/delivery_os/projects/:id/baselines` with `{ "source": "requirements_proposal", "manifest": <RequirementsProposal v1> }`:

| Case | Answer |
|---|---|
| new manifest, current project lock header, `delivery_os.results.import` | `201 { baselineId, version, contentHash, duplicate: false, openCommentIds, projectUpdatedAt }` — baseline n+1 with `source: requirements_proposal`; the merged draft is copied into `draftSpec` in the same transaction |
| same `manifestId` + same content again (any / stale / no lock header) | `200 { …, duplicate: true, openCommentIds: [] }` with the FIRST baseline, no write |
| same `manifestId`, other content | `409 idempotency_conflict` (detail path `manifest.manifestId`) |
| unknown `schemaVersion` (also another document type) | `422 unsupported_schema_version` |
| manifest `projectId` ≠ route project | `422 foreign_reference` / `foreign_project` |
| duplicate requirement/AC/question/risk ids | `422 duplicate_stable_id` |
| proposal without acceptance criteria | `422 missing_acceptance_criteria` |
| new manifest without header / stale header | `428 optimistic_lock_required` / platform `409 optimistic_lock_conflict` |
| user without `delivery_os.results.import` (e.g. manage-only) | `403 forbidden` / `feature_required` |
| project of another tenant/organization, archived | `404 not_found` |
| body > 8 000 000 bytes | `413 payload_too_large` |

Error precedence: 404 → 400/422 manifest → replay (200/409) → 428 → platform 409 → freeze checks.

- `projectUpdatedAt` (both sources) is the project version to send as the next lock header — the import bumps it.
- Screens are optional for this source (FROM_BRIEF: requirements come before the design). A task still cannot become
  `ready` without a render and both decisions. When the draft already has screens, the manual render / design /
  attachment checks run unchanged.
- Importing while a baseline is approved creates version n+1 and leaves `activeBaselineId` and every existing row
  untouched; the new version needs its own requirements + design decisions.
- The command result and the audit entry (`snapshotAfter`) carry `manifestId`, `manifestHash` and `prunedAcIds`.
- The proposal replaces `requirements`, `acceptanceCriteria`, `questions`, `risks`; `acTestMap` / `manualChecks`
  entries of AC ids that disappeared are pruned; every other draft section is kept.

## Contract change (additive)

`BaselineContent v1.importedManifests?: [{ manifestId, manifestHash }]` (max 50) — present only on imported
baselines, so manual hashes and all fixtures are unchanged. **EXEC/UI/QA: any strict copy of the baseline content
schema must allow this optional key.** `importedManifestHashes` is still filled.

## Patch requests to other streams

- **UI (i18n, 5 locales):** `delivery_os.audit.baselines.import_requirements` ("Import requirements proposal");
  render the top codes above through `delivery_os.errors.<code>`; new detail code to translate: `foreign_project`
  already listed in L7a, plus `idempotency_conflict`.
- **UI-03:** after a 201/200 use `projectUpdatedAt` for the next write instead of re-reading the project.
- **QA (TC-DELIVERY-002):** scenario = create project → import fixture proposal with the real `projectId` → replay
  with the old header (200) → same `manifestId` with `risks: []` (409) → `schemaVersion …/v9` (422) → GET baselines
  shows one row, `isActive: false`. Live script used here: `/tmp/t021/live.ts` (not in the repo).
- **EXEC (agent skill `requirements-from-brief`):** generate a fresh `manifestId` per session; a retry of the same
  document is safe and needs no lock header.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 34 suites, 839 tests passed.
- `yarn typecheck` in `packages/core` clean; eslint on touched files clean.
- Live on http://localhost:3100 (dev server restarted): 12/12 checks (422 ×2, 428, 409 lock, 201, draft copied,
  200 replay ×2, 409 conflict, list, project untouched by replays).
- Master-plan Progress rows with new evidence: **3.1** (both inputs write the same baseline schema and hash), **3.3**
  and the requirements half of **3.6** (unknown version / foreign reference rejected, re-import does not duplicate).

## Limitations

- A later manual baseline does not carry the import provenance forward (replay lookup scans all baselines, so
  idempotency still holds).
- No seeded manage-only account exists, so the 403 leg is proven by the route unit test, not live.
- Plan-proposal import (R10) is the next L7 task.
