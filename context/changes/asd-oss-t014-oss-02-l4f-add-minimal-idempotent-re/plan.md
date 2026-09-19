# OSS-02 (L4f): minimal idempotent result acceptance — Implementation Plan

## Overview

Add the deterministic intake for agent results: a pure `evaluateResultAcceptance` in `lib/resultAcceptance.ts` and
the command `delivery_os.results.accept` in `commands/evidence.ts`. The manual route (R16, `source: 'manual'`) and
the enterprise worker (UA-24, `source: 'adapter'`) will both call this one command, so "the agent proposes, the
system decides" has a single validation path.

## Current State Analysis

`checkResultCorrelation` exists; nothing evaluates a manifest end to end, nothing writes `DeliveryEvidence`, and
`buildTaskPackageV1` refuses every non-open attempt (see `research.md`). The attempt schema is frozen and has no
result-hash field.

## Desired End State

`commandBus`/registry has `delivery_os.results.accept`. A valid manifest for a reserved attempt creates exactly one
`result_manifest` evidence row, marks the attempt `result_received`, sets `completionDelivery='pending'` only with a
`workflowRef`, moves the task to `awaiting_review` and emits `evidence.recorded` + `task.updated`. An identical
replay writes nothing and re-emits `evidence.recorded {duplicate:true}`. Everything else answers a frozen
catalogue code. Verify with `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`.

### Key Discoveries:

- Frozen conflict code is `result_conflict` (`lib/contracts.ts:40`).
- The manifest schema strips unknown keys, so hashing the PARSED manifest makes a `tenantId` in the body irrelevant
  to both scope and idempotency.
- Result hash lives on `DeliveryEvidence.payloadHash`; `existingResult` is the evidence row for (task, attempt).
- Revision kind vs profile must be checked before field correlation (fixture `snapshot-for-react`).
- Unique-violation recovery pattern: `commands/baselines.ts:157-200`.

## What We're NOT Doing

- No route (R16), no OpenAPI, no ACL check inside the command (routes task checks `delivery_os.results.import`).
- No `allowedPaths` check, attachment-hash check or size limits — named no-op seams only (OSS-04).
- No claim / cancel / reconcile / mark_delivery commands, no `listPendingDeliveries`, no workflow signalling.
- No closing of the attempt (`closedAt`, `outcome='result_accepted'`) — that belongs to review/verify (OSS-04).
- No unblock propagation to descendants when a `blocked` task moves to `awaiting_review` (needs the project-wide
  lock; recorded as a limitation).
- No migration, no contract/schema-version change, no update/delete path for `DeliveryEvidence`.

## Decisions (questions answered autonomously)

| # | Question | Choice | Why |
|---|----------|--------|-----|
| 1 | What is hashed for idempotency? | `hashCanonical(parsed manifest)` | Unknown keys (tenantId) are stripped, canonical-safe, the same bytes are stored as `payload`. |
| 2 | Where is the result hash stored? | `DeliveryEvidence.payloadHash`; attempt gets only `resultEvidenceId` | The attempt DTO v1 is frozen; adding a field would break the published contract. |
| 3 | Conflict code | `409 result_conflict` | Frozen catalogue. |
| 4 | Result gate | `reserved`/`claimed` accept; `cancel_requested` accepts only with `reconciliation.resolution==='completed'`, else `attempt_cancelled`; `reconciliation_required` accepts only with `completed`, else `reconciliation_required`; `result_received`/`closed` → `attempt_cancelled` when `outcome==='cancelled'`, else `attempt_closed` | T008 decision; a late result after cancel is rejected, `completed` still goes through validation. |
| 5 | Package for a non-open attempt | `buildTaskPackageV1(input, { attemptGate: 'none' })`, default `'open'` | The GET package behaviour is unchanged; the result gate is applied by `evaluateResultAcceptance`. |
| 6 | Package failure vs duplicate | `evaluate` receives the `TaskPackageResult`; a build failure surfaces only at the correlation step | Duplicate must win even when the baseline was altered later. |
| 7 | Kind check order | `assertRevisionKind(profile, manifest.resultRevision)` before `checkResultCorrelation` | Published negative fixture expects `revision_kind_mismatch`. |
| 8 | Locks | Lock the task row only; read project/baseline unlocked; no optimistic-lock header | Spec R16: idempotent by attempt + hash; single lock cannot deadlock with project→tasks writers. |
| 9 | Attempt after accept | `state='result_received'`, `resultEvidenceId`, `externalRunId ??= manifest.externalRunId`, `completionDelivery = workflowRef ? 'pending' : null`; via a new pure reducer `recordAttemptResult` in `lib/attempts.ts` | Same reducer style as reserve/claim; validated by `executionAttemptSchema`. |
| 10 | `source: 'adapter'` with `ctx.request` | `403 forbidden` / `trusted_execution_required` | Same fail-closed boundary as T013: only the in-process worker is an adapter. |
| 11 | Unreadable attempt register | `409 reconciliation_required` / `unreadable_attempt_register` | Same as reserve; fail closed. |
| 12 | Audit | `buildLog` returns `null` on duplicate; label key `delivery_os.audit.results.accept` | T012/T013 decision: a duplicate leaves no audit entry. |
| 13 | Unique-violation race | catch `isUniqueViolation`, re-read evidence + task with a fresh EM (status, updatedAt and the attempt's `completionDelivery` come from that committed row); same hash → duplicate, else `result_conflict` | Task description; baselines pattern. |
| 15 | Manifest for attempt B posted against attempt A that already has a result | `409 result_conflict` (idempotency runs before correlation) | Frozen order; tested in lib. |
| 14 | `recordedBy` | `ctx.auth.sub` when it is a uuid, else `null` | API-key callers must be able to import (T013 decision). |

## Critical Implementation Details

**State sequencing**: inside the transaction every read (task lock, project, baseline, evidence lookup) happens before the first mutation; after `tx.create/persist` and the task field assignments nothing is read on that EM (packages/core/AGENTS.md, `withAtomicFlush` rule).

## Phase 1: Pure evaluation (`lib`)

### Changes Required:

#### 1. `lib/taskPackage.ts`
**Intent**: let the result path build the correlation package for an attempt that is no longer open.
**Contract**: `buildTaskPackageV1(input, options?: { attemptGate?: 'open' | 'none' })`; default `'open'` keeps the
current behaviour; `'none'` still answers `attempt_not_found` for a missing attempt.

#### 2. `lib/attempts.ts`
**Intent**: pure gate and reducer for results.
**Contract**: `checkAttemptAcceptsResult(attempt | undefined): DeliveryCheckResult` (decision 4);
`recordAttemptResult(register, { attemptId, evidenceId, externalRunId }): { ok: true; attempt; register } | AttemptFailure` (decision 9).

#### 3. `lib/resultAcceptance.ts`
**Intent**: the frozen order in one pure function.
**Contract**:
`evaluateResultAcceptance({ manifestRaw, task: { id, allowedPaths }, attempt, taskPackage: TaskPackageResult, existingResult: { evidenceId, payloadHash } | null })`
→ `{ ok: true; outcome: 'accept'; manifest; manifestHash } | { ok: true; outcome: 'duplicate'; evidenceId; manifestHash } | ({ ok: false } & DeliveryErrorResult)`.
Order: parseVersioned (map with only the result-manifest version) → `attempt_not_found` → idempotency
(`existingResult`: same hash → duplicate, else `result_conflict`) → `checkAttemptAcceptsResult` → package failure →
profile lookup + `assertRevisionKind` on `resultRevision` → `checkResultCorrelation` → OSS-04 seams. Seams are
exported named no-op checks `checkChangedPathsAllowed`, `checkArtifactAttachments`, `checkResultSizeLimits`
collected in `RESULT_ACCEPTANCE_PENDING_CHECKS`, each returning `{ ok: true }`. An un-hashable manifest →
`validation_failed`.

#### 4. Tests
`lib/__tests__/resultAcceptance.test.ts` (new), additions to `lib/__tests__/attempts.test.ts` and
`lib/__tests__/taskPackage.test.ts`.

### Success Criteria:

#### Automated Verification:
- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` passes

---

## Phase 2: Command `delivery_os.results.accept`

### Changes Required:

#### 1. `data/validators.ts`
**Contract**: `acceptResultCommandSchema = { taskId, attemptId, manifest, source: 'manual' | 'adapter' }` + type.

#### 2. `commands/shared.ts`
**Contract**: `DELIVERY_EVIDENCE_RESOURCE_KIND = 'delivery_os.evidence'`.

#### 3. `commands/evidence.ts` (new) + `commands/index.ts`
**Intent**: one transaction per the task description. Scope from `ctx` only.
**Contract**: result `ResultAcceptCommandResult = { evidenceId, duplicate, taskStatus, taskUpdatedAt }`.
Flow: scope → parse input → adapter/request guard → `transactional`: `lockScopedTask` (foreign → 404) → register →
project, baseline, profile → `buildTaskPackageV1(…, { attemptGate: 'none' })` (missing baseline →
`foreign_reference/foreign_baseline`, unknown profile → `unknown_target_profile`, both as package failures) →
existing evidence lookup → evaluate → duplicate: return; accept: `canTransition(status, 'awaiting_review')`,
`recordAttemptResult`, `tx.create(DeliveryEvidence, { id: randomUUID(), … })`, `tx.persist`, task fields.
After commit: `evidence.recorded` always (persistent, scoped options), and on accept `emitTaskSideEffects`,
`emitTaskUpdated`, evidence `emitCrudSideEffects('created')`. Unique violation → decision 13.

#### 4. Tests `commands/__tests__/results.test.ts`
All cases from the task description, using shipped fixtures (`loadTaskPackageFixture`, `loadResultManifestFixture`,
negatives `foreign-attempt`, `snapshot-for-react`), seeded with the fixture ids.

#### 5. Docs
Changelog line in `.ai/specs/2026-09-18-delivery-os-hackathon.md`; hand-over note
`context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md`.

### Success Criteria:

#### Automated Verification:
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes
- Scoped typecheck passes: `yarn workspace @open-mercato/core typecheck` (or `tsc --noEmit -p packages/core`)
- `grep -rn "DeliveryEvidence" packages/core/src/modules/delivery_os --include=*.ts` shows only create/find usages (no update/delete/remove/assign)

#### Manual Verification:
- A human reviews the hand-over note and confirms Progress 2.1 evidence

## Testing Strategy

Unit only (mocked EM, same harness as `attempts.test.ts`). HTTP-level and two-connection race belong to the routes
task and QA TC-DELIVERY-006.

## References

- `research.md`; spec `.ai/specs/2026-09-18-delivery-os-hackathon.md:254,281,306,337,369`
- Patterns: `commands/attempts.ts`, `commands/baselines.ts:157-200`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Pure evaluation (lib)

#### Automated

- [x] 1.1 lib jest suite passes

### Phase 2: Command delivery_os.results.accept

#### Automated

- [x] 2.1 delivery_os jest suite passes
- [x] 2.2 Scoped typecheck passes
- [x] 2.3 grep shows no update/delete path for DeliveryEvidence

#### Manual

- [ ] 2.4 Human reviews the hand-over note and confirms Progress 2.1 evidence
