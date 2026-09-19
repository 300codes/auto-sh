---
date: 2026-09-19T10:00:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: c24ac8ba8de8a042018d4b555e7fd6dd0b9777b6
branch: dev-mateusz
repository: open-mercato
topic: "Adding kind 'review' to delivery_os.evidence.record with lifecycle transitions and a pure AC proof helper"
tags: [research, delivery_os, evidence, review, task-lifecycle, ac-proof]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: review evidence, lifecycle gates and AC proof

All paths are under `packages/core/src/modules/delivery_os/` unless a full path is given.

## Research Question

How does `delivery_os.evidence.record` work today, which lifecycle gates already exist for `changes_requested`,
the correction limit and `verified`, how are results and test evidence stored, and what do the master plan and the
module spec require, so that kind `review` can be added with a pure `lib/acProof.ts`?

## Summary

- Everything the review needs on the lifecycle side already exists and is unit-tested: `canTransition`,
  `checkVerification`, `changesRequestedOutcome`, `isCorrectionBudgetExhausted`, block / unblock propagation
  (`lib/taskLifecycle.ts`), and `loadCorrectionBudget` / `countCorrectionRounds` (`commands/tasks.ts:266,376`).
  Nothing computes `unprovenAcIds` yet — that is the gap `lib/acProof.ts` fills.
- The command stops reviews with a stub (`commands/evidence.ts:323`) and never touches a task. The schema for the
  review payload and the optional `taskStatus` / `taskUpdatedAt` response fields are already frozen.
- No migration, error code, event, ACL feature or DI key is needed.

## Detailed Findings

### The command today (`commands/evidence.ts`)
- `parseRecordEvidenceInput` (315) parses the body with `parseRecordEvidenceBody` and throws
  `422 unsupported_evidence_kind / review_not_yet_supported` for a review (323-329).
- `recordEvidenceInTransaction` (460): project row lock → replay lookup by
  (project, kind, taskId, attemptId, payloadHash) → baseline of the project → task of the project with pin checks
  (`requireEvidenceTask`, not locked) → `assertKindRules` (kind permitted by profile, revision kind, scan/test rules)
  → attachments → one insert. The result is `{ evidenceId, duplicate, kind }`.
- After commit: `delivery_os.evidence.recorded` (always), index side effects on a new row. The route
  `api/projects/[id]/evidence/route.ts` answers only `{ evidenceId, duplicate }`.

### Lifecycle gates (`lib/taskLifecycle.ts`)
- `awaiting_review → changes_requested` asks for the correction budget and refuses with
  `409 correction_limit_reached` when `requested >= max` (85-96, 165-168).
- `changesRequestedOutcome(correction)` (173) already returns `blocked / correction_limit_reached` when the budget
  is exhausted — this is the planned escalation path; `awaiting_review → blocked` is in the table.
- `→ executing` refuses only when `requested > max`, so after `max` rounds the last correction can still run.
  With the default `maxCorrectionRounds = 2` (`lib/contracts.ts:321`): rounds 1 and 2 → `changes_requested`,
  round 3 → `blocked / correction_limit_reached`.
- `→ verified` calls `checkVerification` (98): needs AC evidence, on the pinned baseline (`baseline_mismatch`),
  on the result revision (`missing_required_tests / revision_mismatch`) and an empty `unprovenAcIds`
  (`missing_required_tests / ac_unproven`).
- `status_update` source (R12) can never reach `verified` (`not_user_settable`, 137) — already tested in
  `lib/__tests__/taskLifecycle.test.ts` and `commands/__tests__/tasks.test.ts`.
- `countCorrectionRounds` ignores reviews that carry a `manualCheckId` — a manual-check verdict is not a
  correction round.
- `planUnblockPropagation(taskId, tasks)` returns `dependency_blocked` descendants to `draft` when no other root
  block remains; `planBlockPropagation` blocks `draft` / `ready` descendants.

### Locking pattern for task moves (`commands/reconcile.ts:129-183`)
project row lock → `lockScopedProjectTasks` → find the task in the locked list → change → `applyPropagation` →
after commit `emitTaskSideEffects` + `emitTaskUpdated` for the task and every propagated task.

### Stored proof
- A result: `DeliveryEvidence` kind `result_manifest`, `sourceRevision = manifest.resultRevision`,
  `baselineId = task.baselineId`, `payload = ResultManifest v1` with `checks[]` (`commands/evidence.ts:179-195`).
- Test evidence: kind `test`, `payload.checks[]` (same `ResultCheck` shape, `lib/contracts.ts:373`), validated
  against the frozen `acTestMap` at write time; may be project-level (`taskId = null`).
- `ResultCheck.status` is `passed | failed | not_run` (runner `skipped` is mapped to `not_run`).
- Baseline content: `acTestMap: { acId: requiredTestIds[] }`, `manualChecks: { acId: manualCheckId }`
  (fixture: AC-001/AC-002 tests, AC-003 → `MC-visual-001`).

### Requirements
- Master plan line 121: PASS for an AC needs all required tests on the accepted revision, none failed / skipped /
  not_run; an empty required set is `missing`; manual AC use a `manualCheckId` and a human decision, never a fake
  test. Line 198: `not_run`, `missing`, `unverified` are three states that are never folded into success (BN-12/F3).
- Module spec `.ai/specs/2026-09-18-delivery-os-hackathon.md` row R19 (line 308): the exact transitions, response
  `{ evidenceId, duplicate, taskStatus?, taskUpdatedAt? }`, errors `missing_required_tests`, `baseline_mismatch`,
  `409 invalid_transition`.

### Tests
`commands/__tests__/evidence.test.ts` has an in-memory store harness (`matches` supports equality, `$in`, `$gt` —
no `$or`), fixtures `loadTaskPackageFixture('git')`, `loadResultManifestFixture('git')` (all checks passed),
and one test that pins the review stub (531) which must be replaced.

## Code References
- `commands/evidence.ts:315-331` — review stub to replace
- `commands/evidence.ts:460-517` — transaction to extend
- `commands/tasks.ts:266,376,404` — `countCorrectionRounds`, `loadCorrectionBudget`, `applyPropagation`
- `lib/taskLifecycle.ts:98,135,173,196` — verification gate, transitions, escalation outcome, unblock plan
- `commands/reconcile.ts:100-105,185-194` — propagation and post-commit emission pattern
- `api/projects/[id]/evidence/route.ts` and `api/schemas.ts:150` — response shape

## Open Questions
None blocking; choices are recorded in the plan (test identity by `testId`, sticky `failed`, agent approval).
