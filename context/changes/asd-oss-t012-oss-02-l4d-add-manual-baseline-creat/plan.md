# OSS-02 (L4d): manual baseline creation and atomic requirements/design decisions — Implementation Plan

## Overview

Add `delivery_os.baselines.create` (source `manual`) and `delivery_os.decisions.record` (kinds `requirements`, `design`).
They freeze what was agreed and bind the human approval to an exact content hash and version — the visible
"The Agent Proposes. The System Decides." boundary, and the precondition of the legal package export (H10 gate).

## Current State Analysis

- Pure rules exist: `lib/baseline.ts` (`buildBaselineContent`, `nextBaselineVersion`, `resolveActiveBaseline`), `lib/hash.ts`.
- Command infrastructure exists: `commands/shared.ts` (`lockProjectForWrite` = row lock + platform optimistic check),
  `commands/projects.ts`, `commands/tasks.ts` (decision loading shape at `tasks.ts:315-345`).
- Entities, validators (`baselineCreateSchema`, `baselineDecisionSchema`), events (`delivery_os.baseline.approved`) and
  the error catalogue exist. No baseline or decision command exists; nothing can set `activeBaselineId` today.

## Desired End State

Two registered commands with unit tests. A user can freeze the draft into baseline v1, approve requirements and design
against its hash, and the project gets `activeBaselineId` plus exactly one `baseline.approved` event. All failure paths
answer the frozen `{ error, code, details[] }` body (or the platform 409 body for a stale project). No update/delete
path for baselines or decisions exists. No migration, no contract change.

### Key Discoveries:

- `lockProjectForWrite` is a no-op without the header (`commands/shared.ts:126`), so "header required" needs an
  explicit check; the catalogue already has `optimistic_lock_required: 428` (`lib/contracts.ts:76`).
- `buildBaselineContent` never throws; zero AC → `422 missing_acceptance_criteria`; an AC needs a known requirement,
  so ≥1 AC implies ≥1 requirement (`lib/contracts.ts:251-268`, `485-494`). Screens are not required by the schema.
- `isUniqueViolation(err, constraintName?)` in `packages/shared/src/lib/crud/errors.ts:65`.
- `Attachment` has nullable `tenantId`/`organizationId` and no `deletedAt`
  (`packages/core/src/modules/attachments/data/entities.ts:51`); `catalog/commands/variants.ts:21` imports the class
  by package path (FK-id coupling, no relation).

## Decisions (questions answered autonomously)

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Where is the required lock header enforced? | In both commands: missing header → `428 optimistic_lock_required` (detail path `headers.if-match-updated-at` style code `optimistic_lock_required`), before the transaction. | The task says "required"; the decision is the safety boundary and must not depend on a route remembering it. Routes may still answer 428 earlier. Both commands call `lockProjectForWrite(..., { force: true })`, which passes `envValue: 'all'`, so the `OM_OPTIMISTIC_LOCK` opt-out cannot disable the hash-bound rule (plan-review F1). |
| D2 | How does the "second writer loses" rule work? | Every recorded decision bumps `project.updatedAt`. The concurrent writer waits on the row lock, then fails the platform optimistic check → platform `409 optimistic_lock_conflict`. | Uses the platform conflict bar the UI already understands; no new code. |
| D3 | Sequential reject after approve (fresh header)? | Allowed; appended. If the rejected baseline is the active one, `activeBaselineId` is set to `null`. | "A later reject voids"; fail closed. No fallback to an older baseline — a human must decide again. |
| D4 | When is `baseline.approved` emitted? | Only when `activeBaselineId` changes to a baseline id (not when cleared). Persistent, after commit. | The event name says approved; AO workflows trigger planning on it and must not fire on a reject. |
| D5 | deploy/release kinds | `422 unsupported_evidence_kind`, detail `decision_kind_not_supported` (path `kind`). | The task asks for a clear 422 with an existing code until OSS-05. |
| D6 | No screens | `422 missing_render` (path `screens`). No requirements → `422 missing_acceptance_criteria` detail `missing_requirements` (path `requirements`). | Catalogue codes; ≥1 requirement has no own code. The command collects `missing_requirements`, `missing_acceptance_criteria` and `missing_render` into one `details[]` before the builder runs; the top code is `missing_acceptance_criteria` when either of the first two is present, else `missing_render` (plan-review F2). |
| D7 | Missing/foreign attachment | `422 attachment_scope_mismatch`, one detail per reference (`screens.N.attachmentId` / `attachments.N.attachmentId`), same answer for missing and foreign. | No existence leak. Hash/size/type verification of bytes is OSS-03. |
| D8 | Shape-invalid stored draft | Catalogue status is kept (`400 validation_failed`); domain gaps are 422; never a 500. | The DTO v1 catalogue is frozen (T004); the draft is validated on write, so this path is defensive only. |
| D9 | Duplicate detection | Same `contentHash` in the project → return that baseline, `duplicate: true`, no write. A unique violation on the hash or version constraint is recovered by re-reading by hash on a fresh fork; if found → duplicate, otherwise the error is rethrown. | Task text; the project row lock makes the race nearly impossible, the recovery is a net. |
| D10 | Does baseline create bump the project? | No. | Nothing on the project changes; avoids useless 409s in the UI. |
| D11 | Decision on an older baseline version | Allowed; the subject is the stored row named by `baselineId`. A baseline with a lower version than the active one is recorded but never promoted (impl-review F4). | Spec compares with "the stored baseline"; keeps the rule simple. |
| D12 | `decidedAt` | `max(now, latest existing decidedAt + 1 ms)` under the lock. | Ties fail closed in `resolveActiveBaseline`; a monotonic clock under the lock avoids accidental ties. |
| D13 | Actor | `ctx.auth.sub` must be a uuid, else `403 forbidden` detail `actor_required`. | `actor_user_id` is not null; a decision is a human act. |
| D14 | Audit | `buildLog` with `resourceKind` `delivery_os.baseline` / `delivery_os.decision`; none for a duplicate. No undo. Query-index side effect `created` for the new row and `updated` for the project when it changed. | Consistent with T010/T011. |

Implementation notes (adaptations): both commands pre-read the project so a foreign or archived project answers
`404 not_found` instead of the platform record-gone 409; a malformed lock header answers `400 validation_failed` /
`optimistic_lock_invalid` (impl-review F1); the approval event is emitted before the index side effects (F2).

## What We're NOT Doing

Routes and ACL checks (routes task), `requirements_proposal` source and attachment byte verification (OSS-03),
deploy/release decisions (OSS-05), i18n files (UI stream), migrations, any update/delete path.

## Implementation Approach

One transaction per command; all loads first, pure checks in memory, mutations last, events and index side effects
after commit. Small shared helpers go to `commands/shared.ts`.

## Critical Implementation Details

- **State sequencing**: in `decisions.record` read the baseline (immutable) on the forked EM first to learn the
  `projectId`, then lock the project, then re-use the loaded baseline. Approval is computed in memory from the loaded
  decisions plus the new record, so no query runs after `persist`.
- **Input shape**: the path id is merged by the route: baselines `{ projectId, source }`, decisions
  `{ baselineId, kind, verdict, subjectHash, subjectVersion, reason? }`. The kind is checked for deploy/release before
  the strict schema parse so D5 answers 422 and not a zod enum 400.

## Phase 1: Commands and tests

### Changes Required:

#### 1. Shared helpers
**File**: `packages/core/src/modules/delivery_os/commands/shared.ts`
**Intent**: add an optional `{ force?: boolean }` argument to `lockProjectForWrite` (D1), `requireLockHeader(ctx)` (D1), `requireActorUserId(ctx)` (D13), resource-kind constants
`DELIVERY_BASELINE_RESOURCE_KIND`, `DELIVERY_DECISION_RESOURCE_KIND`, and `findScopedBaseline(em, id, scope)`.
**Contract**: exported functions; existing exports unchanged.

#### 2. Baseline command
**File**: `packages/core/src/modules/delivery_os/commands/baselines.ts`
**Intent**: `delivery_os.baselines.create` per D6–D10.
**Contract**: input `{ projectId: uuid } & baselineCreateSchema`; `source: 'requirements_proposal'` →
`400 validation_failed` detail `unsupported_source` (same as T011). Result
`{ baselineId, projectId, version, contentHash, duplicate, openCommentIds }`. Exports `BaselineCommandResult`.
`attachmentIds` on the row = unique ids of screens and attachments.

#### 3. Decision command
**File**: `packages/core/src/modules/delivery_os/commands/decisions.ts`
**Intent**: `delivery_os.decisions.record` per D2–D5, D11–D13.
**Contract**: result `{ decisionId, projectId, baselineId, activeBaselineId, activeBaselineChanged, projectUpdatedAt }`.
Mismatch of hash or version → `409 subject_hash_mismatch` (details name `subjectHash` / `subjectVersion`). Foreign or
missing baseline, archived project → `404 not_found`.

#### 4. Registration
**File**: `packages/core/src/modules/delivery_os/commands/index.ts` — import both files.

#### 5. Tests
**Files**: `commands/__tests__/baselines.test.ts`, `commands/__tests__/decisions.test.ts`
**Intent**: cases from the task: no AC / no render / foreign attachment → 422; identical draft twice → one row and
`duplicate: true`; version increments; unique-violation recovery; missing header 428; hash mismatch 409; version
mismatch 409; stale project 409 (platform body); approve requirements only → unchanged and no event; both → set + one
event; reject after approve clears; reject without reason 422; deploy kind 422; foreign scope 404; no query after
persist; a guard test that the registry has no `delivery_os.baselines.update|delete` / `delivery_os.decisions.update|delete`.

#### 6. Docs
**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (changelog line),
`context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md` (hand-over note).

### Success Criteria:

#### Automated Verification:

- `yarn generate` succeeds (command discovery)
- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands --maxWorkers=2` is green
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` is green
- Scoped typecheck of `@open-mercato/core` reports no error in `delivery_os`
- grep shows no update/delete command for DeliveryBaseline or DeliveryDecision

#### Manual Verification:

- A human confirms the decision flow in the UI once routes and pages exist (joint acceptance 2.3–2.4)

## Testing Strategy

Unit tests with the mocked EM and `findWithDecryption` dispatch per entity class, as in `tasks.test.ts`. Integration
tests belong to QA (TC-DELIVERY-002/003).

## Performance Considerations

One project lock, at most three reads per command. Attachments are loaded with one `$in` query.

## Migration Notes

None.

## References

- Research: `context/changes/asd-oss-t012-oss-02-l4d-add-manual-baseline-creat/research.md`
- Pattern: `packages/core/src/modules/delivery_os/commands/projects.ts`, `commands/tasks.ts:315-345`
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (UA-05, UA-15)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Commands and tests

#### Automated

- [x] 1.1 yarn generate succeeds
- [x] 1.2 commands jest suite is green
- [x] 1.3 delivery_os jest suite is green
- [x] 1.4 scoped typecheck has no delivery_os error
- [x] 1.5 grep shows no update/delete command for baselines or decisions

#### Manual

- [ ] 1.6 human confirms the decision flow in the UI once routes and pages exist
