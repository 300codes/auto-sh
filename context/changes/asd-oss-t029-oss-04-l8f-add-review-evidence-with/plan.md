# OSS-04 (L8f): review evidence, verified / changes_requested transitions and correction limit — Implementation Plan

All code paths are under `packages/core/src/modules/delivery_os/` unless a full path is given.

## Overview

`delivery_os.evidence.record` (route R19) learns the kind `review`. A review is the only way a task leaves
`awaiting_review`: `changes_requested` opens a correction round (or escalates to `blocked / correction_limit_reached`
when the rounds are used up), `approved` moves the task to `verified` only when the system itself can prove every AC
of the task on the accepted result revision. A review that carries a `manualCheckId` records the human verdict of a
manual AC and never moves the task. The proof is computed by a new pure helper, `lib/acProof.ts`, which the OSS-05
report will reuse.

"The agent proposes, the system decides": an agent (or a human) can *say* approved, the status changes only when the
recorded test evidence says so.

## Current State Analysis

See `research.md`. In short: the lifecycle gates (`canTransition`, `checkVerification`, `changesRequestedOutcome`,
block / unblock propagation), the correction counter (`loadCorrectionBudget`), the review payload schema and the
optional `taskStatus` / `taskUpdatedAt` response fields all exist. Missing: the dispatch of `review` in the command
(a stub answers `422 review_not_yet_supported`), the computation of `unprovenAcIds`, and task locking / propagation
/ `task.updated` in this command.

## Desired End State

- `POST /api/delivery_os/projects/:id/evidence` with `kind: 'review'` answers
  `201 { evidenceId, duplicate: false, taskStatus, taskUpdatedAt }` and moves the task as described below; an
  identical replay answers `200` with `duplicate: true` and the task's current status, and moves nothing.
- `lib/acProof.ts` answers, for a list of AC, the frozen maps, a baseline, a revision and evidence rows, the status of
  every AC (`passed | failed | not_run | missing`) with the evidence ids that decided it.
- jest for `delivery_os` is green, including the acceptance cases of the task.

### Decisions (questions of the planning skill, answered autonomously)

| # | Question | Decision | Why |
|---|----------|----------|-----|
| D1 | What identifies a required test in a check — `testId` or `testId` + the check's `acIds`? | `testId` only; the frozen `acTestMap` of the baseline is the only AC→test mapping. | Master plan l.121: the model may not add mappings; `check.acIds` is a claim. Runners that omit `acIds` still count — demo dependability. |
| D2 | Several results for one test on the same revision | `failed` is sticky; otherwise `passed` beats `not_run`; nothing → `missing`. | F3: failed / not_run never pass. A later real run may replace "not run yet", nothing may erase a failure on the same revision — a fix is a new revision. |
| D3 | Which rows feed the proof of a task | Rows of the pinned baseline whose `sourceRevision` is the revision of the task's latest accepted result, and that belong to this task or to no task (project-level test evidence). | "Test evidence on a different revision does not count"; project-level test runs are allowed by R19. |
| D4 | What a review with `manualCheckId` does | Stores the human verdict only; never moves the task and is not a correction round. The id must be a manual check of one of the task's AC. Only `reviewer.kind = 'human'` is accepted; the latest human verdict on the revision wins. | Matches the existing `countCorrectionRounds` (ignores manual-check reviews) and the master plan ("manual AC: a human decision, never a fake test"). |
| D5 | May an agent review with verdict `approved` verify a task? | Yes — the gate is the deterministic proof, not the reviewer. An agent can never approve a manual check, and nothing here publishes (deploy / release decisions are separate human commands, OSS-05). | Track criterion 4 (least human involvement) with the safety story intact. |
| D6 | How is `human` trusted | `reviewer.kind = 'human'` needs a signed-in user (`ctx.auth.sub` is a user UUID), else `403 forbidden / actor_required`. | An in-process agent caller cannot pose as a human; reuses an existing code. |
| D7 | Review on another revision than the accepted result | `422 missing_required_tests`, detail `revision_mismatch`, path `sourceRevision`. | Same code and detail as `checkVerification`; stays inside the R19 error list. |
| D8 | No accepted result on the pinned baseline | `422 baseline_mismatch` when results exist only for another baseline, else `422 missing_required_tests / missing_evidence`. Applies to every review. | A review reviews a result; codes are the ones the task names. |
| D9 | Task not in `awaiting_review` | `409 invalid_transition`, detail `task_not_awaiting_review`, for every review (also manual-check ones). | Acceptance criterion; `blocked → changes_requested` is in the table so the table alone is not enough. |
| D10 | Failed approval | Nothing is stored (the transaction rolls back), status unchanged. | Acceptance criterion "status unchanged"; an approval that did not happen is not evidence. |
| D11 | Locks | project row → all live project tasks (the order of `tasks.update` and `attempts.reconcile`), only for reviews. Other kinds keep today's path untouched. | No deadlock with the other commands; propagation needs the sibling rows. |
| D12 | Response | Route sends `taskStatus` + `taskUpdatedAt` only for reviews; the command result also carries `taskStatusReason` and `propagatedTaskIds` for in-process callers and the audit snapshot. | Spec row R19; UI strict copies of the response stay valid. |
| D13 | `reviewedEvidenceId` | When given it must be a row of this task, else `422 foreign_reference / foreign_evidence`. | Never reference another task's or organization's proof. |
| D14 | Escalation at the limit | `changesRequestedOutcome` decides: with `requested >= max` the task goes `blocked / correction_limit_reached`, the review row is still stored, `draft` / `ready` dependants are blocked (`dependency_blocked`). | Existing, unit-tested helper; default `max = 2` → third round blocks. |
| D15 | When is an identical review a replay (plan review F1) | Only when the matching row is the newest among the task's `review` and `result_manifest` rows. After a new result, or after another verdict, the same words are a new review. | Otherwise a repeated `changes_requested` on an unchanged revision would leave the task stuck in `awaiting_review`. |

## What We're NOT Doing

- No migration, error code, event, ACL feature, DI key or validator change; no optimistic-lock header on R19.
- No report API (OSS-05) — only the helper it will reuse.
- No comparison of `testDefinitionHash` (OSS-05 candidate, unchanged).
- No UI, i18n, integration-spec or enterprise change; patch requests go to the hand-over.
- No exit from `blocked / correction_limit_reached` other than the existing `cancelled`.

## Implementation Approach

One phase for the pure helper with its tests, one for the command + route + tests + docs. All reads happen before the
first mutation inside the transaction (MikroORM identity-map rule from `packages/core/AGENTS.md`).

## Critical Implementation Details

- **State sequencing**: inside `recordEvidenceInTransaction` load everything first (tasks under lock, baseline,
  evidence rows), decide the target status purely, then `tx.persist(evidence)` and mutate the task and the propagated
  tasks last. No `find*` after the first mutation.
- **Correction count**: `requested` is counted from the rows that exist *before* the new review is inserted
  (round 1 → 0, round 3 → 2 = max → blocked).
- **Reading the rows (plan review F2)**: two scoped queries — every row of the task, and the `test` rows of the project on
  the pinned baseline with `taskId: null` (`IN (…, NULL)` never matches NULL). The first set also feeds
  `countCorrectionRounds` and the D15 replay decision.
- **Ordering of evidence for D4**: rows are sorted by `createdAt`, then `id`, ascending before they reach `acProof`; the helper
  documents "later rows win" and does not read clocks.

## Phase 1: Pure AC proof helper

### Changes Required

#### 1. `lib/acProof.ts` (new)

**Intent**: Decide, without I/O, whether each AC is proven on one baseline + revision. Reused by the review gate now
and by the OSS-05 report.

**Contract**:
- `type AcProofStatus = 'passed' | 'failed' | 'not_run' | 'missing'`
- `type AcProofEvidence = { id: string; kind: DeliveryEvidenceKind; baselineId: string; sourceRevision: SourceRevision | null; payload: unknown }` (ordered oldest → newest)
- `proveAcceptanceCriteria({ acIds, acTestMap, manualChecks, baselineId, revision, evidence }): AcProof[]` where
  `AcProof = { acId, status, proven, tests: { testId, status, evidenceId | null }[], manualCheck: { manualCheckId, status: 'approved' | 'changes_requested' | 'missing', evidenceId | null } | null }`
- `listUnprovenAcIds(proofs): string[]`
- Rules: only rows with the same `baselineId` and `isSameRevision(sourceRevision, revision)`; checks come from
  `result_manifest` and `test` payloads (`payload.checks[]`, read defensively with `resultCheckSchema`; a check whose
  own `sourceRevision` differs is ignored); D1, D2; an AC with no required test and no manual check is `missing`;
  a manual check counts only from `review` rows with `reviewer.kind = 'human'` and that `manualCheckId`, latest wins;
  an AC with both needs both. AC status: `passed` when proven, else `failed` if any test failed or the manual verdict
  is `changes_requested`, else `not_run` if any test is `not_run`, else `missing`. Own-property lookups only
  (`Object.hasOwn`) so `__proto__`-like ids cannot match.

#### 2. `lib/__tests__/acProof.test.ts` (new)

**Intent**: Pin F3: all passed → proven; one `not_run` / `failed` / absent test → not proven with the right status;
other revision or other baseline ignored; failed sticky against a later pass; `not_run` replaced by a later pass;
empty required set → `missing`; manual AC unproven without review, with agent review, with human
`changes_requested`; proven with human `approved`; later human verdict wins; project-level test evidence counts;
`reference_material` / `screenshot` / `scan` rows never count; malformed payload ignored.

### Success Criteria

#### Automated Verification

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/acProof.test.ts --maxWorkers=2` passes

---

## Phase 2: Review dispatch in the command, route response, docs

### Changes Required

#### 1. `commands/evidence.ts`

**Intent**: Replace the review stub with the review path described in the decisions.

**Contract**:
- `EvidenceRecordCommandResult` gains optional `taskStatus`, `taskStatusReason`, `taskUpdatedAt`, `propagatedTaskIds`
  (present only for reviews). `RecordOutcome` gains `task` and `propagated`.
- Order for a review: project scope → schema → project lock → replay per D15 (answers with the task's current
  status, no move; other kinds keep today's replay) → baseline of the project → lock project tasks, pick the task (`422 foreign_reference / foreign_task`), pin
  checks as today → kind permitted / revision kind → **review rules**: D6 → D9 → D4 validation (`400
  validation_failed / human_reviewer_required`, `422 unknown_test_id / unknown_manual_check`) → load the task's and
  the project-level rows of the pinned baseline → D8 → D7 → D13 → decide the target:
  manual check → no move; `changes_requested` → `changesRequestedOutcome` + `canTransition`; `approved` →
  `canTransition(…, 'verified', { verification: { taskBaselineId, resultRevision, evidence, unprovenAcIds } })` with
  `unprovenAcIds` from `lib/acProof.ts` (baseline content unreadable / hash altered → the existing `422
  hash_mismatch`) → attachments → insert → mutate task → propagation (block on `blocked`, unblock plan on
  `verified`).
- After commit: `evidence.recorded` as today; when the task moved, `emitTaskSideEffects` + `emitTaskUpdated` for the
  task and each propagated task. The audit snapshot includes the result (task status).
- `requireEvidenceTask` takes the already locked task list for reviews; other kinds are untouched.

#### 2. `api/projects/[id]/evidence/route.ts`

**Intent**: Send `taskStatus` / `taskUpdatedAt` when the command returns them; update the OpenAPI text (review now
recorded here, 403 and 409 `invalid_transition` / `correction` cases listed).

**Contract**: response stays within `evidenceRecordResponseSchema`.

#### 3. Tests

- `commands/__tests__/evidence.test.ts`: replace the stub assertion; new `describe` for reviews covering every
  acceptance case of the task plus: replay moves nothing, agent approval verifies, agent manual-check refused, human
  without signed-in user refused, unknown manual check, review on another revision, result only on another baseline,
  foreign `reviewedEvidenceId`, third round blocks and blocks a `ready` dependant, `verified` returns a
  `dependency_blocked` dependant to `draft`, events emitted (`task.updated` for task + propagated), manual AC flow
  (approved refused → human manual check approved → approved verifies).
- `api/__tests__/evidence.route.test.ts`: review answers 201 with `taskStatus` / `taskUpdatedAt`; other kinds still
  send only `{ evidenceId, duplicate }`.
- R12 cannot set `verified`: confirm the existing test in `commands/__tests__/tasks.test.ts`; add one if absent.

#### 4. Docs

- `.ai/specs/2026-09-18-delivery-os-hackathon.md`: changelog entry for L8f (order, decisions, codes).
- `context/changes/delivery-os-oss-domain/handover/OSS-04-L8f-review.md`: what works, DTO version, test evidence,
  patch requests for UI / EXEC / QA, OSS-05 notes.

### Success Criteria

#### Automated Verification

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes
- Scoped typecheck of the module (sources and tests) passes
- `eslint` on the touched files passes
- Live API check on http://localhost:3100: result → review `changes_requested` → … → review `approved` → task `verified`

#### Manual Verification

- A human reviews the hand-over and confirms the review flow in the UI once UI-04 wires it

---

## Testing Strategy

Unit tests only (OSS owns them); integration specs belong to QA — candidates are listed in the hand-over.
Live smoke through the real HTTP API on the local dev instance, cleaned up by SQL afterwards.

## Performance Considerations

One extra query (evidence rows of one task + project-level rows on one baseline) and the task row locks, only for
reviews. Projects have tens of tasks.

## Migration Notes

None.

## References

- Research: `context/changes/asd-oss-t029-oss-04-l8f-add-review-evidence-with/research.md`
- Pattern: `commands/reconcile.ts:100-194` (locks, propagation, emission)
- Gates: `lib/taskLifecycle.ts:98-178`
- Spec row R19: `.ai/specs/2026-09-18-delivery-os-hackathon.md:308`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure AC proof helper

#### Automated

- [x] 1.1 acProof unit tests pass

### Phase 2: Review dispatch in the command, route response, docs

#### Automated

- [x] 2.1 delivery_os jest suite passes
- [x] 2.2 Scoped typecheck of the module passes
- [x] 2.3 eslint on the touched files passes
- [x] 2.4 Live API check of the review flow on localhost:3100

#### Manual

- [ ] 2.5 A human reviews the hand-over and confirms the review flow in the UI once UI-04 wires it
