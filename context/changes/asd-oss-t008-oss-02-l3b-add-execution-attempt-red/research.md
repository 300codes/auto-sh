---
date: 2026-09-19T02:54:23+0200
researcher: Claude (autonomous OSS developer)
git_commit: f15db049c
branch: dev-mateusz
repository: open-mercato
topic: "What the master plan, the delivery_os spec and lib/contracts.ts fix about the execution-attempt state model and the baseline build/readiness rules"
tags: [research, delivery_os, attempts, baseline, contracts]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: execution-attempt state model and baseline build/readiness rules

## Research Question

What do the master plan ('Minimalny model danych', 'Publiczne operacje prób i decyzji'), the delivery_os spec and
`lib/contracts.ts` already fix, so that the pure reducers `lib/attempts.ts` and `lib/baseline.ts` can be written
consistently with the existing lib modules?

## Summary

Everything needed is already frozen; the task only adds behaviour on top of existing schemas.

- The attempt record, its states and the register invariants are executable in `lib/contracts.ts`
  (`executionAttemptSchema`, `executionAttemptsSchema`, `ACTIVE_ATTEMPT_STATES`, `MAX_EXECUTION_ATTEMPTS = 16`).
- Error codes are frozen in the spec and **differ from the task wording**: `active_attempt_exists` →
  `attempt_active`, `attempt_terminal` → `attempt_not_active` (cancel) / `attempt_not_reconcilable` (reconcile).
  The spec changelog (T003) says the spec names are authoritative.
- `BaselineContent v1` is executable (`baselineContentV1Schema`); the draft (`draftSpecV1Schema`) lives in
  `data/validators.ts`, which pure lib modules must not import (it pulls `@open-mercato/shared`), so `baseline.ts`
  takes a structural draft type.
- Decisions: append-only, bound to `subject_hash` + `subject_version`; "latest decision per (kind, subject_hash)
  wins: a later reject voids an earlier approve".

## Detailed Findings

### Attempt state model

- `lib/contracts.ts:585-595` — states `reserved claimed result_received cancel_requested reconciliation_required
  closed`; active = `reserved | claimed | cancel_requested`.
- `lib/contracts.ts:608-638` — attempt fields; `baseCommit` must equal `baseRevision.commitSha` for git and be null
  for snapshot (`checkRevisionCommit`), so the reducer derives `baseCommit` from `baseRevision` instead of trusting a
  separate input. `stopConfirmation: 'stop_unconfirmed' | 'stopped' | null`; `outcome: result_accepted | cancelled |
  not_started | stopped | null`; `reconciliation { resolution, note, observedAt, actorUserId, resolvedAt }`.
- `lib/contracts.ts:640-658` — register invariants: ≤ 16, ≤ 1 active, unique attemptId and idempotencyKey.
- Master plan `plan.md:107` — same key + payload → existing attempt, other payload → 409; limit 16 blocks a new
  start and never trims history; one active attempt. `plan.md:127` — 201 created / 200 replay / 409.
  `plan.md:131` — cancel records a request only; reconcile `not_started/stopped/completed/unknown`; unknown blocks
  restart and archive; completed leads to normal manifest validation, never directly to verified; a stop is confirmed
  from the real process, not from the cancel call. `plan.md:109` — an active or unreconciled attempt blocks archive.
  `plan.md:149` — cancel shows `stop_unconfirmed` without confirmation.
- Spec `:302` (UA-10) — replay is compared **before** the lock and before the other checks; codes
  `idempotency_conflict`, `attempt_active`, `attempt_limit_reached`, `reconciliation_required`. `:303` (UA-11)
  `attempt_not_found`, `attempt_cancelled`, `attempt_closed`. `:310` (UA-18) response
  `{ state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed' }`, 409 `attempt_not_active`. `:311` (UA-19)
  `not_started/stopped` → attempt `closed`; `completed` → same validation as UA-12, ends `awaiting_review`;
  `unknown` → task `blocked/reconciliation_required`; 409 `attempt_not_reconcilable`. `:249` claim sets `claimedAt`
  and `workerRef` exactly once.
- `lib/taskLifecycle.ts` — task statuses are decided there; attempt reducers must not return a task status, only a
  task *effect* the L4 command maps through `canTransition` (T007 note: reconcile passes the post-change
  `statusReason`).

### Baseline rules

- `lib/contracts.ts:469-495` — `baselineContentV1Schema`: needs ≥ 1 AC (`missing_acceptance_criteria`), unique
  requirement/AC ids (`duplicate_stable_id`), AC → known requirement (`foreign_reference`), `acTestMap` /
  `manualChecks` keys must be known ACs (`unknown_ac`), unique declared tests. A screen always carries
  `attachmentId` + `sha256`, so a "temporary URL only" screen cannot be expressed; `temporary_url_only` stays a
  command/attachment-level check.
- `data/validators.ts:95-138` — draft comments `{ id, screenAttachmentId, anchor, body, status: open|resolved,
  resolution? }`; baseline stores `resolvedComments { id, screenAttachmentId, anchor, body, resolution }` — the
  snapshot of resolutions (master plan `plan.md:111`).
- Spec `:93-106` — version n+1 per project; `content_hash` = sha256 of canonical JSON of `content` (`lib/hash.ts
  #hashCanonical`); identical content → existing row. Spec `:301` (UA-09) ready gate codes: `baseline_not_approved`,
  `missing_render`, `missing_required_tests`. Spec `:149-164` decisions. Master plan `plan.md:121` — an empty
  required-test set means missing; manually judged ACs point at a `manualCheckId`, never a fake automated test.
- `lib/targetProfiles.ts` — `getTargetProfile(id, version)` returns `undefined` for unknown →
  `422 unknown_target_profile`; profile carries `id` and `version`.
- Requirements-proposal baselines (UA-06) legitimately have no screens, so `missing_render` is a *ready gate* /
  manual-baseline check, not part of `buildBaselineContent`.

## Code References

- `packages/core/src/modules/delivery_os/lib/contracts.ts:20,582-658` — attempt schemas and constants
- `packages/core/src/modules/delivery_os/lib/contracts.ts:103-143` — `buildDeliveryError`, `deliveryErrorFromZod`
- `packages/core/src/modules/delivery_os/lib/contracts.ts:469-495` — `baselineContentV1Schema`
- `packages/core/src/modules/delivery_os/lib/hash.ts:48-59` — `canonicalize`, `hashCanonical`
- `packages/core/src/modules/delivery_os/lib/taskLifecycle.ts` — style reference (`DeliveryCheckResult`, `reject`)
- `packages/core/src/modules/delivery_os/lib/fixtures/baseline-content.v1.json` — valid baseline fixture for tests

## Architecture Insights

Pure lib modules return `DeliveryCheckResult`-compatible values built with `buildDeliveryError`, never throw for
domain errors, import only `./contracts`, `./hash`, `./targetProfiles`, `./dag`, and never `data/validators`.

## Historical Context (from prior changes)

- `context/changes/asd-oss-t007-oss-02-l3a-add-dag-task-lifecycle-pr/plan.md` — lifecycle gates; `→ ready` takes the
  readiness result produced by this task's `checkTaskReadiness`.
- T003 spec changelog — code renames; spec is authoritative over the breakdown.

## Open Questions

None blocking. `completed` leaves the attempt state untouched until the OSS-04 result-acceptance reducer sets
`result_received` (fail closed: the attempt keeps blocking reserve/archive until a valid manifest lands).
