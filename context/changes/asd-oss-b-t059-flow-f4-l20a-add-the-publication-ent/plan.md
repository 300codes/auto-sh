# FLOW-F4 L20a — publication entity, migration, validators, pure rules

## Overview
Data and rule layer for the F14 publication record (FLOW-F0 contract, `PublicationResult v1`). No route, command or
registry change; L20b wires the command/route on top.

## Current State Analysis
- Contract exists: `publicationResultV1Schema`, `publicationVerificationSchema` (verified ⇒ method+checkedAt+evidenceId,
  code `deployment_unverified`), `publicationRecordResponseSchema` (`lib/contracts.ts:1746-1790`); fixture
  `lib/fixtures/flow/publication-result.v1.json` + negative `publication-result.verified-without-evidence.v1.json`.
- v1 deployment evidence: `deploymentEvidencePayloadSchema` (`data/validators.ts:352`), status derived by
  `deriveDeploymentVerificationStatus` (`lib/evidenceRules.ts:97`) — verified only if verification.status verified,
  observedBuildId === buildId, uploadStatus succeeded.
- Deploy consent semantics: `commands/decisions.ts#checkDeployConsent` (subjectHash = baseline contentHash, revision
  read via `sourceRevisionSchema.safeParse(decision.sourceRevision)`, compared by `isSameRevision`). Deploy decisions
  store `subjectType 'baseline'`, `subjectId = baseline.id`.
- Migration style: `Migration20260919111236_delivery_os_flow_f1.ts`; test style `data/__tests__/flowMigration.test.ts`.

## Desired End State
Entity + one migration applied locally, `yarn db:generate` quiet for delivery_os; validators and rules unit-tested.

## Decisions (answered autonomously)
1. Consent check takes the ONE decision named by `deployDecisionId` plus `projectId`/`baselineId`; checks
   kind=deploy, same project, `subjectId === baselineId` and `subjectHash === baselineContentHash` → else
   `deploy_decision_missing`; revision unreadable or different → `revision_mismatch`; verdict rejected →
   `deploy_decision_missing` detail `deploy_decision_rejected`. Order: identity/baseline → revision → verdict (a
   reject bound to another revision is reported as `revision_mismatch`). A later reject on
   the same revision is caught by L20b additionally running `checkDeployConsent` over all deploy decisions (noted).
2. Derived evidence: `buildId` = commitSha (git) or contentHash (snapshot); `uploadStatus 'succeeded'`; `deployedAt` =
   publishedAt; verified publication → `verification { status 'verified', checkedAt, method, observedBuildId: buildId }`;
   unverified → `verification: null` (→ `unverified`, never `failed`/`verified`).
3. Payload hash = `hashCanonical(parsed PublicationResult v1)`; unique `(tenant, org, project, payload_hash)`.
4. No PII in the table (`published_by`/`recorded_by` are user ids, URL is a public target) → no encryption-map entry.
5. Entity is append-only: no `updated_at`/`deleted_at` (spec table says append-only; exempt from optimistic lock).
6. `lib/publicationRules.ts` declares its own `PublicationDeploymentEvidencePayload` type (lib stays independent of data); tests parse it through `deploymentEvidencePayloadSchema` and `recordEvidenceSchema` so drift is caught.

## What We're NOT Doing
Command, route, OpenAPI, ACL/event/DI registries, encryption map, integration spec (all L20b), F2 seams.

## Phase 1: Data — entity, migration, validators
- `data/entities.ts`: append `DeliveryPublication` (`delivery_publications`): id, tenant_id, organization_id,
  project_id, baseline_id, source_revision jsonb, snapshot_ref jsonb null, target jsonb, url text,
  deploy_decision_id uuid, deployment_evidence_id uuid, verification jsonb, published_at timestamptz,
  published_by uuid null, payload_hash text, recorded_by uuid null, created_at. Index
  `delivery_publications_scope_project_created_idx`, unique `delivery_publications_scope_project_payload_hash_uq`.
- `migrations/Migration<ts>_delivery_os_flow_f4.ts` (only this table, with `down`) + snapshot update.
- `data/validators.ts`: `recordPublicationCommandInputSchema` (`{ projectId, publication }` with path binding →
  `foreign_reference`), `publicationListQuerySchema` (page, pageSize ≤ 100).
- Tests: `data/__tests__/publicationMigration.test.ts`, `data/__tests__/publicationValidators.test.ts`.

### Success Criteria
#### Automated Verification:
- Exactly one new migration file + snapshot diff; migration test green
- `yarn db:migrate` applies; `yarn db:generate` then emits nothing for delivery_os
- Validator tests green
#### Manual Verification:
- Human reviews the SQL at merge alongside lane A's F2 migration (snapshot regeneration)

## Phase 2: Pure rules
- `lib/publicationRules.ts`: `checkPublicationDeployConsent`, `checkPublicationVerification`,
  `buildDeploymentEvidencePayload`, `hashPublicationPayload`, `publicationBuildId`.
- `lib/__tests__/publicationRules.test.ts`: every code; derived payload parses via `deploymentEvidencePayloadSchema`
  and `deriveDeploymentVerificationStatus` yields verified/unverified.

### Success Criteria
#### Automated Verification:
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green

## Progress

> Convention: `- [ ]` pending, `- [x]` done. See `references/progress-format.md`.

### Phase 1: Data — entity, migration, validators

#### Automated

- [x] 1.1 Exactly one new migration file + snapshot diff; migration test green
- [x] 1.2 `yarn db:migrate` applies; `yarn db:generate` then emits nothing for delivery_os
- [x] 1.3 Validator tests green

#### Manual

- [ ] 1.4 Human reviews the SQL at merge alongside lane A's F2 migration (snapshot regeneration)

### Phase 2: Pure rules

#### Automated

- [x] 2.1 `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- [x] 2.2 `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green
