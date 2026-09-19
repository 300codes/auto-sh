# FLOW-F0 contract delta — Implementation Plan

## Overview

Publish the additive, versioned contract delta for the project-flow addendum (brief intake, template pinning, stage
artifacts and stage decisions with dependent currency and a server-side gate, staff Kanban linkage and idempotent
comment import, flow read model, publication result) as: a spec section, executable zod schemas under a new version
constant, positive/negative fixtures with tests, and a hand-over for Adam, Marcin and Michał. No route, command,
entity or migration is implemented; the v1 contract stays byte-identical.

## Current State Analysis

- v1 is frozen (`DELIVERY_CONTRACT_VERSION = 1`, 8 schema versions, error catalogue, R1–R22, decision kinds
  `requirements|design|deploy|release`) — see `research.md`.
- Dispatch already refuses unapproved / inactive baselines at `commands/tasks.ts:356`, `commands/attempts.ts:218`;
  deploy consent at `commands/decisions.ts:363`. The flow gate is layered at those points in F1.
- Fixture tests enumerate only `lib/fixtures/negative/*.v1.json` and the `positiveDeliveryFixtures` array; a sibling
  `lib/fixtures/flow/` tree is invisible to them.
- Staff public seams: command ids `staff.timesheets.tasks.*`, `staff.timesheets.task_comments.*`,
  `staff.timesheets.time_projects.*`; routes `/api/staff/timesheets/tasks`, `/tasks/[id]/comments`; access through
  DI `timeTrackingAccessResolver` + `assertProjectAccess`. Limits: title ≤ 255, description ≤ 8000, comment ≤ 5000.
- Workflows identity: definition `(workflowId, version, tenantId)`, instance `definitionId/workflowId/version`.
- Encryption maps: per-module `encryption.ts` exporting `defaultEncryptionMaps` (`messages/encryption.ts`).

## Desired End State

- `.ai/specs/2026-09-18-delivery-os-hackathon.md` has a section **"Flow delta v1 (FLOW-F0)"** covering every
  operation of `01-mateusz-domain.md` step 1 with method/path or command id, zod request/response, ACL, scope, lock,
  idempotency, errors, OpenAPI note; the additive entities/columns/indexes, migration plan, PII + encryption map, and
  the explicit v1 boundary.
- `lib/contracts.ts` exports `DELIVERY_FLOW_CONTRACT_VERSION = 1`, `DELIVERY_FLOW_SCHEMA_VERSIONS`, the flow
  schemas, `deliveryFlowDocumentSchemas` and additive error codes; nothing existing changes.
- `lib/fixtures/flow/` holds positive and negative fixtures with an index and loaders; `lib/__tests__/flowContracts.test.ts`
  and `flowFixtures.test.ts` pass with `--maxWorkers=2`; v1 suites pass unchanged; core typecheck passes.
- `context/changes/delivery-os-oss-domain/handover/FLOW-F0-contracts.md` exists with the operation table, fixture
  list, decisions taken on open questions, estimate for F1–F4 and blockers.

### Key Discoveries

- `deliveryErrorCodes` is an object literal; adding keys is additive and the `error-body` enum widens automatically.
- `parseVersioned(schemaMap, input)` is generic over the map, so a second map keeps v1 dispatch untouched.
- Existing helpers to reuse: `uuidSchema`, `sha256Schema`, `isoDateTimeSchema`, `stableIdSchema`, `idempotencyKeySchema`,
  `attachmentRefSchema`, `designScreenSchema`, `acceptanceCriterionSchema`, `requirementSchema`, `proposalQuestionSchema`,
  `proposalRiskSchema`, `sourceRevisionSchema`, `reportGateSchema`, `addDeliveryIssue`.

## What We're NOT Doing

- No routes, commands, entities, migrations, ACL/event/DI registrations, i18n, UI, or generator runs.
- No change to any v1 schema, enum, error status, route, fixture or test.
- No Figma provider, no workflow template registry, no WordPress adapter (other owners).
- No edits under `context/changes/autonomous-software-delivery/` (read-only planning docs).

## Implementation Approach

Design once in the plan (decision table below), then express it three times consistently: executable schemas +
fixtures (Phase 1), the spec section (Phase 2), the hand-over (Phase 3). Schemas are the source of truth; the spec
and hand-over quote their names.

### Decision table (answers to the planning questions, taken autonomously)

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Where does the wizard draft live? | New editable table `delivery_intakes` (one row per project, own `updated_at`, own encryption map) | Autosave conflicts must not 409 project edits; brief PII encrypted at field level |
| D2 | Platform choice in Scope vs frozen target profile | Scope artifact carries `platform.recommendation` and `platform.chosen`; server refuses `chosen ≠ project profile` with `422 target_profile_frozen`; switching = new project (future intake→create route, v2) | Addendum: no hidden edit of the frozen profile; demo preselects WP |
| D3 | Stage decisions vs legacy `design` | New append-only table `delivery_stage_decisions`, stage enum `scope|ux|key_visual|design_system_ui`, new feature `delivery_os.stages.approve`; legacy `requirements`/`design` decisions still required for the v1 baseline | Frozen enum untouched; three consents never folded into one |
| D4 | Who is gated? | Gate applies only to projects with a pinned template (`flow_template_id IS NOT NULL`); legacy projects keep v1 behaviour | FLOW-08 regression; no mass migration |
| D5 | Where does the gate run? | Pure `lib/stageGate.ts` (F1) called from task `ready`, attempt reserve (manual and automatic), deploy decision, publication | Old endpoints cannot bypass it |
| D6 | Currency model | Derived, never stored: `approved` / `stale` (approved artifact's `dependsOn` hashes ≠ current approved upstream) / `pending` / `rejected` / `missing`; history stays | Addendum: upstream change invalidates downstream without deleting history |
| D7 | Template pin | Nullable columns on `delivery_projects` + jsonb snapshot `FlowTemplate v1`; pin once (`409 flow_already_pinned`); instance linked by trusted internal command | Immutable snapshot per project; re-pin needs human impact analysis (not demo) |
| D8 | Comment import unit of work | One DB transaction per thread (delivery thread row + staff task + comments through public staff commands); unique `(project, source, fileKey, threadKey)` and `(thread, commentKey, revision)`; batch `Idempotency-Key`; unique-violation recovered as `duplicate` | Retry after crash and parallel imports never duplicate |
| D9 | Body longer than staff limits | Staff comment/description truncated with a marker; full text on the delivery row; title = first line ≤ 255 | Staff schema limits are frozen |
| D10 | Staff Done vs `verified` | No subscriber to staff status events mutates delivery tasks; link `linkedDeliveryTaskId` is display-only; F2 test asserts | Addendum hard rule |
| D11 | Report additions | Separate `deliveryReportFlowSectionSchema`; route spreads it as optional `flow` in F3 (`deliveryReportV1Schema` untouched in F0) | v1 schema untouched |
| D12 | Publication result | New document `PublicationResult v1` + new route; server records `deployment` evidence internally | R19 untouched; Michał's adapter gets one typed payload |
| D13 | Blocking comments and approval | An open, un-triaged thread on the stage's current artifact blocks approval (`422 blocking_comments_open`); deferral is bound to the artifact hash | Addendum: comments resolved or explicitly deferred per version |
| D14 | Fixture layout | `lib/fixtures/flow/{*.v1.json, negative/*.v1.json, index.ts}` with its own catalogue test | v1 catalogue tests untouched |
| D15 | Estimate | F1 ≈ 10 h, F2 ≈ 8 h, F3 ≈ 4 h, F4 ≈ 4 h domain work (≈ 26 h) — reported, not hidden | README: new estimate, no silent scope cut |

## Phase 1: Executable flow contracts, fixtures and tests

### Overview

Add the flow schemas and error codes to `lib/contracts.ts` additively, the fixture tree, and the two test suites.

### Changes Required

#### 1. `packages/core/src/modules/delivery_os/lib/contracts.ts`

**Intent**: Append (never edit) a "Flow delta v1" block.

**Contract**:
- `DELIVERY_FLOW_CONTRACT_VERSION = 1`; `DELIVERY_FLOW_SCHEMA_VERSIONS = { intake: 'delivery.intake/v1', scopingProposal: 'delivery.scoping-proposal/v1', flowTemplate: 'delivery.flow-template/v1', stageArtifact: 'delivery.stage-artifact/v1', commentImport: 'delivery.comment-import/v1', flowStatus: 'delivery.flow-status/v1', publicationResult: 'delivery.publication-result/v1' }`.
- Additive `deliveryErrorCodes` keys: `target_profile_frozen 422`, `flow_already_pinned 409`, `flow_not_pinned 422`, `unknown_flow_template 422`, `flow_template_hash_mismatch 422`, `stage_unknown 422`, `stage_not_approved 422`, `stage_dependency_stale 422`, `stage_artifact_stale 409`, `client_approval_required 422`, `blocking_comments_open 422`, `staff_link_required 422`, `intake_step_invalid 422`, `sync_cursor_conflict 409`. (Review F1: no `thread_not_found`; foreign or missing thread → `404 not_found`.)
- Schemas: `flowStageIdSchema` (`scope|ux|key_visual|design_system_ui`), `flowTemplateStageKindSchema` (the four + `implementation|qa|deploy|release`), `flowTemplateV1Schema`, `intakeV1Schema` (brief, scoping questions/answers, proposals, platform recommendation/chosen, tools, step), `scopingProposalV1Schema`, `stageArtifactV1Schema` (discriminated on `stageId`: scope content vs design-stage content), `stageArtifactCreateRequestSchema`, `stageArtifactCreateResponseSchema`, `stageDecisionRequestSchema` (+ `clientApproval`), `stageDecisionResponseSchema`, `stageCurrencySchema`, `flowStatusV1Schema`, `staffLinkRequestSchema`/`staffLinkSchema`, `commentImportBatchV1Schema` (threads/replies/cursor), `commentImportResponseSchema`, `commentThreadTriageRequestSchema`, `deliveryReportFlowSectionSchema`, `publicationResultV1Schema`, `flowPinRequestSchema`, `flowPinResponseSchema`.
- `deliveryFlowDocumentSchemas` map keyed by the new versions; works with the existing `parseVersioned`.
- Refinements carry delivery codes via `addDeliveryIssue` (e.g. `dependsOn` stage must be upstream of `stageId` → `stage_dependency_stale`? no: `foreign_reference`/`cycle`; duplicate `threadKey` in a batch → `duplicate_stable_id`; `clientApproval` required when `requiresClientApproval` cannot be known at schema level → left to the command).

#### 2. `packages/core/src/modules/delivery_os/lib/fixtures/flow/`

**Intent**: One coherent WordPress demo scenario (project `1111…`, template `delivery-default@1`) as positive fixtures, plus negative wrappers in the v1 self-describing format.

**Contract**: positive `intake.v1.json`, `scoping-proposal.v1.json`, `flow-template.v1.json`, `stage-artifact.scope.v1.json`, `stage-artifact.ux.v1.json`, `stage-decision.request.v1.json`, `flow-status.v1.json`, `comment-import.v1.json`, `comment-import.response.v1.json`, `publication-result.v1.json`, `staff-link.v1.json`. Negative (`negative/`, **schema-stage only** per review F2): `intake.invalid-step`, `intake.unknown-schema-version`, `stage-artifact.unknown-stage`, `stage-artifact.dependency-not-upstream`, `stage-artifact.duplicate-dependency`, `stage-decision.rejected-without-reason`, `stage-decision.client-approval-without-name`, `comment-import.duplicate-thread-key`, `comment-import.missing-thread-key`, `comment-import.duplicate-comment-key`, `flow-template.duplicate-stage`, `flow-template.dependency-cycle`, `publication-result.verified-without-evidence`. Domain-stage rejections (frozen-profile mismatch, stale dependency, client approval required by template, staff link missing, foreign project) are listed in the spec Integration Coverage as F1/F2 tests. `index.ts` exports `positiveFlowFixtures`, typed loaders, `loadNegativeFlowFixtures()` with wrapper schema `{ description, expected: { stage: 'schema', code, status }, documentType, document }`.

#### 3. Tests `lib/__tests__/flowContracts.test.ts`, `lib/__tests__/flowFixtures.test.ts`

**Intent**: Prove the acceptance criteria mechanically.

**Contract**: positive fixtures parse and round-trip through `parseVersioned(deliveryFlowDocumentSchemas, …)`; every negative file is catalogued exactly once and fails at the labelled stage with the labelled code/status (schema-stage ones through the schema, all at the schema stage); the v1 report fixture still parses through `deliveryReportV1Schema.extend({ flow: deliveryReportFlowSectionSchema.optional() })` (review F3); v1 invariants: `DELIVERY_SCHEMA_VERSIONS`, `deliveryDocumentSchemas` keys and the v1 error-code statuses are unchanged (snapshot of the frozen set); the two schema maps share no key.

### Success Criteria

#### Automated Verification

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` passes (new + v1 suites).
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` passes.
- `git diff --stat` shows no change to v1 fixture JSON, `fixtures/index.ts`, `contracts.test.ts`, `fixtures.test.ts`.

---

## Phase 2: Spec section "Flow delta v1 (FLOW-F0)"

### Overview

Write the product/technical contract into the OSS spec, quoting Phase 1 names.

### Changes Required

#### 1. `.ai/specs/2026-09-18-delivery-os-hackathon.md`

**Intent**: Insert a new top-level section before "Migration & Backward Compatibility" and a changelog entry.

**Contract**: sub-sections — v1 boundary (what stays frozen); additive data models (5 tables + project columns, indexes, PII column list, `encryption.ts` map); operation table (F1…F14: intake GET/PUT, scoping proposal import, flow pin, flow instance link (internal), stage artifact create, stage decision, stages/flow status GET, staff link PUT/GET, comment import, thread triage, publication result, report `flow` section) each with method/path or command id, request/response schema names, feature, scope, lock, idempotency, error codes, OpenAPI note; stage currency + gate rules; comment import rules (identity, transaction unit, truncation, deferral, Done ≠ verified); events and ACL additions (names only, registered in F1); migration plan; integration coverage FLOW-01/02/03/04/08/09 → `TC-DELIVERY-FLOW-*.spec.ts` names; estimate and blockers.

### Success Criteria

#### Automated Verification

- Section present: `grep -c "## Flow delta v1 (FLOW-F0)" .ai/specs/2026-09-18-delivery-os-hackathon.md` = 1.
- Every schema name referenced in the section exists in `lib/contracts.ts` (grep check of the names list).

#### Manual Verification

- Adam / Marcin / Michał confirm the operation table covers their needs (human sign-off, not ticked by the agent).

---

## Phase 3: Hand-over and verification

### Changes Required

#### 1. `context/changes/delivery-os-oss-domain/handover/FLOW-F0-contracts.md`

**Intent**: Give the other owners one page they can integrate against.

**Contract**: base commit, contract version, import paths, operation table (condensed), fixture list with what each proves, open questions + decision taken (D1–D15), estimate F1–F4, explicit blockers (Figma comment read probe, template registry seam, publication target), what is NOT implemented yet.

### Success Criteria

#### Automated Verification

- File exists and links resolve (`ls` + grep of spec anchor).
- Full delivery_os jest run with `--maxWorkers=2` passes; core typecheck passes.

## Testing Strategy

- Unit: schema tests above. Integration tests ship with F1+ (`TC-DELIVERY-FLOW-*.spec.ts`), named in the spec now.

## Migration Notes

Design only: one additive migration planned for F1 (five tables, five nullable project columns, indexes) — not generated here.

## References

- Research: `context/changes/asd-oss-t040-flow-f0-publish-the-versioned-contra/research.md`
- Hand-over format: `context/changes/delivery-os-oss-domain/handover/OSS-02-H4-contracts.md`
- Fixture pattern: `packages/core/src/modules/delivery_os/lib/fixtures/index.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Executable flow contracts, fixtures and tests

#### Automated

- [x] 1.1 delivery_os lib jest suites pass with --maxWorkers=2 (new and v1)
- [x] 1.2 scoped core typecheck passes
- [x] 1.3 no v1 fixture, index or v1 test file changed

### Phase 2: Spec section "Flow delta v1 (FLOW-F0)"

#### Automated

- [x] 2.1 spec section present exactly once
- [x] 2.2 every schema name in the section exists in contracts.ts

#### Manual

- [ ] 2.3 Adam, Marcin and Michał confirm the operation table covers their needs

### Phase 3: Hand-over and verification

#### Automated

- [x] 3.1 FLOW-F0-contracts.md exists and links resolve
- [x] 3.2 full delivery_os jest run and core typecheck pass
