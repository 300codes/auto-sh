# OSS-02 (L3b): execution-attempt reducers and baseline build/readiness rules — Implementation Plan

## Overview

Add two pure rule modules to `packages/core/src/modules/delivery_os/lib/`: `attempts.ts` (reserve / claim / cancel /
reconcile reducers over the `executionAttempts` register plus the archive block) and `baseline.ts` (build + hash of
`BaselineContent v1` from the draft, version numbering, stable ids, decision resolution, the task ready gate). Both ship
with jest tests. The L4 commands (next task) only do I/O around these rules.

## Current State Analysis

- `lib/contracts.ts` already freezes the attempt record (`executionAttemptSchema`), register invariants
  (`executionAttemptsSchema`), `ACTIVE_ATTEMPT_STATES`, `MAX_EXECUTION_ATTEMPTS`, `baselineContentV1Schema` and the error
  catalogue. `lib/hash.ts#hashCanonical` is the canonical hash. `lib/taskLifecycle.ts` expects a `readiness` result for
  `→ ready` and a post-change `statusReason` from reconcile.
- No reducer exists yet; nothing decides idempotent reserve, single claim, cancel, reconcile, baseline hash or readiness.
- Full findings: `research.md` in this folder.

## Desired End State

`attempts.ts` and `baseline.ts` exist, import only `./contracts`, `./hash`, `./targetProfiles` (types), return
`DeliveryCheckResult`-compatible errors built with `buildDeliveryError`, never mutate their inputs, and are covered by
`lib/__tests__/{attempts,baseline}.test.ts`. The whole `delivery_os` jest folder is green and the core typecheck is clean.
A progress note in `context/changes/delivery-os-oss-domain/handover/` states L1–L3 are done.

### Key Discoveries:

- Spec error names win over the task wording (T003 changelog): `active_attempt_exists` → `attempt_active`,
  `attempt_terminal` → `attempt_not_active` (cancel) / `attempt_not_reconcilable` (reconcile).
- `baseCommit` must equal `baseRevision.commitSha` for git and be null for snapshot (`contracts.ts:195-213`), so the
  reserve reducer takes `baseRevision` and derives `baseCommit` instead of trusting a second input.
- Spec `:164`: the latest decision per `(kind, subject_hash)` wins. `target_profile_id/version` live on the **task**
  (`data/entities.ts:171-175`, copied from the project); the baseline has no profile columns.
- Lib modules must not import `data/validators.ts` (pulls `@open-mercato/shared`), so `baseline.ts` takes a structural
  draft type.

## What We're NOT Doing

- No commands, routes, ORM, events or locking (L4 / OSS-04). No result-acceptance reducer (`result_received`,
  `completionDelivery`) — OSS-04. No `link_workflow` / `mark_delivery` reducers (enterprise-facing, OSS-04).
- No `temporary_url_only` / attachment scope checks (need I/O), no `unknown_test_id` catalogue check (plan import, OSS-03).
- No new error codes, no contract changes.

## Implementation Approach

Reducers take an already parsed register (`readonly ExecutionAttempt[]`) and return a new array; `parseAttemptRegister`
turns the raw jsonb into that type. Every failure is `{ ok: false, status, body }`. Reducers that change the task return
a task *effect*, never a task status — `taskLifecycle.canTransition` stays the only place that decides statuses.

Decisions taken (autonomous):

| Question | Choice | Why |
|---|---|---|
| Reserve check order | idempotency → `reconciliation_required` → `attempt_active` → `attempt_limit_reached` | Spec UA-10: a replay stays 200; unknown is the most severe block and tells the user what to do first |
| Replay of a key whose attempt is closed | `existing` | Spec: same key + payload → same body, regardless of state |
| Claim by another worker | 409 `attempt_active` | The attempt is held by someone else; no new code needed |
| Claim / export on non-open attempt | `cancel_requested` → `attempt_cancelled`; `reconciliation_required` → `reconciliation_required`; `result_received`/`closed` → `attempt_closed` (outcome `cancelled` → `attempt_cancelled`) | Codes of UA-11; shared helper `checkAttemptOpen` so GET package (L4) uses the same mapping |
| Cancel twice | idempotent, first timestamp kept | A user double-click must not fail; cancel is only a request |
| Reconcile `completed` | records the reconciliation, leaves `state` untouched, effect `await_manifest` | Fail closed: the attempt keeps blocking reserve/archive until a valid manifest is accepted (OSS-04); never verified |
| Reconcile `stopped` | `closed`, outcome `stopped`, `stopConfirmation: 'stopped'` | The human observation is the stop confirmation (master plan: confirmed from the real process) |
| Open draft comments | not copied into the baseline; returned as `openCommentIds` | Baseline stores the snapshot of resolutions; the UI can warn, nothing is invented |
| Resolved comment without resolution text | `validation_failed` | The snapshot must say what was resolved |
| Decision tie on `decidedAt` | `rejected` wins | Fail closed |
| Readiness result | all reasons as details; the first reason (fixed order) is the body code | One round-trip shows the user everything to fix |
| Required tests | AC needs a non-empty `acTestMap[ac]` or a `manualChecks[ac]` | Master plan: empty set = missing; manual AC points at a `manualCheckId` |
| Profile mismatch code | `unknown_target_profile` when the profile is missing (detail `unknown_target_profile`) or differs from `task.targetProfileId/Version` (detail `target_profile_mismatch`) | Existing codes only; the profile is pinned on the task |
| Invalid `decidedAt` | the kind counts as not approved | Fail closed (plan review F2) |

## Phase 1: Attempt reducers

### Changes Required:

#### 1. `packages/core/src/modules/delivery_os/lib/attempts.ts`

**Intent**: Decide every change of the attempt register without I/O.

**Contract**:
- `parseAttemptRegister(raw: unknown)` → `{ ok: true, register } | failure` (null/undefined → empty; zod errors via `deliveryErrorFromZod`).
- `isAttemptActive(attempt)`, `findAttempt(register, attemptId)`, `hasUnreconciledAttempt(register)`, `isArchiveBlocked(register)`.
- `checkAttemptOpen(attempt | undefined)` → `DeliveryCheckResult` (`attempt_not_found`, `attempt_cancelled`, `attempt_closed`, `reconciliation_required`).
- `reserveAttempt(register, { idempotencyKey, payload, mode, baselineId, baselineHash, baseRevision, now, newAttemptId })` →
  `{ ok: true, outcome: 'created' | 'existing', attempt, register } | { ok: false, outcome: 'conflict', status, body }`.
  `payloadHash = hashCanonical(payload)`; the new attempt is validated with `executionAttemptSchema` (bad key/ids → `validation_failed`).
- `claimAttempt(register, { attemptId, workerRef, now })` → `{ ok: true, attempt, register, alreadyClaimed } | failure`.
- `requestCancellation(register, { attemptId, now })` → `{ ok: true, attempt, register, alreadyRequested } | failure` (`attempt_not_found`, `attempt_not_active`).
- `reconcileAttempt(register, { attemptId, resolution, note, observedAt, actorUserId, now, externalRunId? })` →
  `{ ok: true, attempt, register, taskEffect: 'release_task' | 'await_manifest' | 'block_task' } | failure`
  (`attempt_not_found`, `attempt_not_reconcilable` for `result_received`/`closed`). Reconcilable = active states + `reconciliation_required`.
  After `completed` the state is untouched, so a corrected observation (`unknown`, `stopped`, …) is still accepted; the last record wins.

#### 2. `packages/core/src/modules/delivery_os/lib/__tests__/attempts.test.ts`

**Intent**: created/existing/conflict matrix; replay wins over active/limit/unknown; second active attempt; 17th attempt
with history intact; unknown blocks reserve and archive; claim once (same worker idempotent, other worker rejected,
cancelled/closed rejected); cancel on terminal; cancel idempotent; each reconcile resolution; completed never
closes/verifies; inputs are not mutated; output register always passes `executionAttemptsSchema`.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/attempts.test.ts --maxWorkers=2` passes

---

## Phase 2: Baseline rules, docs and hand-over note

### Changes Required:

#### 1. `packages/core/src/modules/delivery_os/lib/baseline.ts`

**Intent**: Build the immutable baseline document and decide approval / readiness.

**Contract**:
- `buildBaselineContent(draft: BaselineDraftInput, extras?: { importedManifestHashes?: string[] })` →
  `{ ok: true, content, contentHash, openCommentIds } | failure`; deep clone first, validate with `baselineContentV1Schema`.
- `hashBaseline(content)`, `nextBaselineVersion(existingVersions)`, `assertStableIds({ requirements, acceptanceCriteria })`.
- `BaselineDecisionRecord = { kind, verdict, subjectHash, subjectVersion, decidedAt }`;
  `latestBaselineDecisions(decisions, subject)`; `resolveActiveBaseline(decisions, { contentHash, version })` → boolean.
- `collectReadinessReasons(input)` → `ReadinessReason[]`; `checkTaskReadiness({ task, baseline, decisions, profile })` → `DeliveryCheckResult`.
  Order: profile vs task (`unknown_target_profile`), pinned baseline (`baseline_mismatch`), stored content vs hash
  (`hash_mismatch`, added during implementation as an integrity check),
  `baseline_not_approved`, `missing_acceptance_criteria`, `unknown_ac`, `missing_render`, `missing_required_tests`.

#### 2. `packages/core/src/modules/delivery_os/lib/__tests__/baseline.test.ts`

**Intent**: build from the fixture-shaped draft; draft mutated after the build leaves content and hash unchanged; key
order does not change the hash; open comments excluded; negatives (no AC, duplicate ids, foreign requirement, unknown AC
in maps); versions; every readiness negative paired with the passing case; decision for an old hash/version ignored;
later reject voids approve; tie fails closed.

#### 3. Docs

**Intent**: spec changelog entry in `.ai/specs/2026-09-18-delivery-os-hackathon.md`; progress note
`context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md` (evidence for Progress 2.1, nothing ticked).

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes (whole module folder)
- Core typecheck is clean: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`
- `grep -nE "^import" lib/attempts.ts lib/baseline.ts` shows only `./contracts`, `./hash`, `./targetProfiles`
- Progress note exists in `context/changes/delivery-os-oss-domain/handover/`

## Testing Strategy

Unit tests only (pure functions). Attempts are built by a local factory and every reducer output is re-parsed with
`executionAttemptsSchema`, so a reducer can never produce a register the contract rejects.

## References

- Research: `context/changes/asd-oss-t008-oss-02-l3b-add-execution-attempt-red/research.md`
- Style reference: `packages/core/src/modules/delivery_os/lib/taskLifecycle.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Attempt reducers

#### Automated

- [x] 1.1 attempts jest test passes

### Phase 2: Baseline rules, docs and hand-over note

#### Automated

- [x] 2.1 whole delivery_os jest folder passes
- [x] 2.2 core typecheck is clean
- [x] 2.3 attempts.ts and baseline.ts import only pure lib modules
- [x] 2.4 progress note exists in the hand-over folder
