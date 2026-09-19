# FLOW-F1 L11 — flow entities, F1 migration, encryption map and validators — Implementation Plan

## Overview

First layer of FLOW-F1: persist what the F0 contract (`lib/contracts.ts`, spec § Additive data models, L435–461)
already describes. Commands, routes and the server-side gate are later F1 layers; this change only ships entities,
one additive migration, the PII encryption map and the zod wrappers those layers will consume.

## Current State Analysis

- `data/entities.ts` has the five v1 entities; the only migration is `Migration20260919003425_delivery_os.ts` plus
  `migrations/.snapshot-open-mercato.json`.
- F0 schemas exist in `lib/contracts.ts` (`intakeUpdateRequestSchema`, `scopingProposalV1Schema`,
  `flowPinRequestSchema`, `flowInstanceLinkSchema`, `stageArtifactV1Schema`, `stageDecisionRequestSchema`); several are
  refined (`superRefine`), so zod 4 `.extend()` on them is not safe → wrappers nest them instead of extending.
- Encryption maps are discovered by convention (`<module>/encryption.ts`, `defaultEncryptionMaps`), see
  `staff/encryption.ts` and `bootstrap.ts#getDefaultEncryptionMaps`. The encryption subscriber supports json/jsonb
  columns (`shared/lib/encryption/subscriber.ts#isJsonColumnProperty`). Entity ids are derived from class names
  (`DeliveryIntake` → `delivery_os:delivery_intake`).
- `yarn db:generate` regenerates an unrelated wms migration on every run (T038 note) — delete it each time.

## Desired End State

`delivery_projects` has seven nullable `flow_*` columns + scope/template index; the three new tables exist with the
spec's uniques; the migration contains only additive `delivery_*` DDL; encrypted PII fields are declared; validators
export F1 command/route schemas and paged list queries (pageSize ≤ 100). Applied on omhack and a throw-away DB;
`yarn db:generate` afterwards yields no delivery_* diff.

### Key Discoveries

- Existing unique/index naming: `delivery_<table>_<purpose>_uq|_idx` (`data/entities.ts`).
- v1 append-only rows carry `created_at` only; editable rows `updated_at` with `onUpdate`.
- `projectListQuerySchema` (validators.ts:163) is the paging pattern (coerce, max 100, default 50).

## What We're NOT Doing

- No commands, routes, OpenAPI, events, DI, ACL features (later F1 layers, F4–F9).
- No F2/F4 tables (`delivery_staff_links`, comment threads/replies, publications).
- No change to any v1 column, enum, DTO or error code (FLOW-08); no backfill.

## Implementation Approach

Entities → encryption map → validators → `yarn generate` → `yarn db:generate` (keep only delivery DDL, rename file to
`…_delivery_os_flow_f1.ts`) → apply locally + throw-away DB → tests.

## Decisions (answered autonomously)

| Question | Choice | Why |
|---|---|---|
| Wrapper shape for refined F0 schemas | nest the payload (`{ projectId, intake }`, `{ projectId, stageId, idempotencyKey, decision }`, …) | zod 4 forbids extending refined objects; keeps the frozen F0 schema untouched |
| Path/body `stageId` mismatch | command artifact wrapper refines `stageId === artifact.stageId` (`foreign_reference`) | defence in depth; route still checks the pinned template first (`stage_unknown`) |
| Common columns | new tables get `created_at`; intake also `updated_at` (own lock) | matches v1 conventions and the spec's common-columns rule |
| Nullability | `flow_*` all nullable (NULL = legacy); new-table JSON lists `not null default '[]'` | FLOW-08: legacy rows untouched |
| `brief` / `questions` / approver PII stored as jsonb/text and encrypted via map | as spec | subscriber supports json columns |
| Migration test location | `data/__tests__/flowMigration.test.ts` | acceptance command runs `jest src/modules/delivery_os/data`; no stray files in `migrations/` |
| List queries | `stageHistoryListQuerySchema` page ≥1, pageSize 1..100 default 50 | AGENTS pageSize ≤ 100 |

## Phase 1: Entities, encryption map, validators

### Changes Required

#### 1. `packages/core/src/modules/delivery_os/data/entities.ts`
**Intent**: add `flow_*` columns + index to `DeliveryProject`; add `DeliveryIntake`, `DeliveryFlowStageArtifact`,
`DeliveryFlowStageDecision` exactly per spec table (FK ids only).
**Contract**: uniques `delivery_intakes_scope_project_uq`, `delivery_flow_stage_artifacts_project_stage_version_uq`,
`…_project_stage_hash_uq`, `delivery_flow_stage_decisions_project_idempotency_uq`; indexes
`delivery_projects_scope_flow_template_idx`, `delivery_flow_stage_decisions_scope_project_stage_decided_idx`.

#### 2. `packages/core/src/modules/delivery_os/encryption.ts` (new)
**Intent**: `defaultEncryptionMaps` for `delivery_os:delivery_intake` (brief, questions) and
`delivery_os:delivery_flow_stage_decision` (client_approver_name, client_approval_evidence).

#### 3. `packages/core/src/modules/delivery_os/data/validators.ts`
**Intent**: F1 wrappers: `intakeUpdateCommandSchema`, `scopingProposalImportCommandSchema`, `flowPinCommandSchema`,
`flowInstanceLinkCommandSchema` (trustedExecution required), `stageArtifactCreateCommandSchema`,
`stageDecisionCommandSchema` (idempotencyKey required), `stageHistoryListQuerySchema`; re-export the F0 request schemas.

### Success Criteria

#### Automated Verification
- Validator, encryption-map tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/data --maxWorkers=2`
- Core typecheck: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`
- `yarn generate` succeeds and registers the three entity ids; `git status` shows no committed file outside delivery_os changed (plan-review F2)

## Phase 2: Migration, apply, regression

### Changes Required

#### 1. `migrations/Migration<ts>_delivery_os_flow_f1.ts` + `.snapshot-open-mercato.json`
**Intent**: generated additive DDL only; unrelated generator output deleted.

#### 2. `commands/__tests__/appendOnly.test.ts` (plan-review F1)
**Intent**: add `DeliveryFlowStageArtifact`, `DeliveryFlowStageDecision` to the static `HISTORY_ENTITIES` list.

#### 3. `data/__tests__/flowMigration.test.ts`
**Intent**: every `addSql` in `up()` targets a `delivery_*` table and is additive (create table/index, alter … add);
`down()` only drops what `up()` added.

### Success Criteria

#### Automated Verification
- Migration test passes (same jest command)
- `yarn db:migrate` applies on omhack; throw-away DB shows four tables/columns with uniques (`docker exec omhack-postgres psql`)
- `yarn db:generate` afterwards emits no delivery_* diff
- Existing delivery_os suites green: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`

#### Manual Verification
- Human reviews the generated SQL against the spec table

## Testing Strategy

Unit: validators (happy + proposals stripped + stageId mismatch + missing idempotency key + pageSize 101 rejected),
encryption map ids/fields, migration file static audit. DB: psql `\d` on both databases.

## References

- Spec `.ai/specs/2026-09-18-delivery-os-hackathon.md` L435–461; F0 hand-over `context/changes/delivery-os-oss-domain/handover/FLOW-F0-contracts.md`
- Pattern `packages/core/src/modules/staff/encryption.ts`, `messages/data/__tests__/encryption.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Entities, encryption map, validators

#### Automated

- [x] 1.1 Validator, encryption-map tests pass
- [x] 1.2 Core typecheck passes
- [x] 1.3 yarn generate succeeds and registers the three entity ids

### Phase 2: Migration, apply, regression

#### Automated

- [x] 2.1 Migration static test passes
- [x] 2.2 Migration applied on omhack and verified on a throw-away DB
- [x] 2.3 db:generate afterwards emits no delivery_* diff
- [x] 2.4 Existing delivery_os suites green

#### Manual

- [ ] 2.5 Human reviews the generated SQL against the spec table
