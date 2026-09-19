# OSS-04 (L8f) hand-over — review evidence, verified / changes_requested, correction limit (R19)

Task T029 · DTO/contract version: **v1, unchanged** (request schema `recordEvidenceSchema`, response schema
`evidenceRecordResponseSchema` untouched — `taskStatus` / `taskUpdatedAt` are now sent for reviews) · additive: kind
`review` in `delivery_os.evidence.record`, pure helper `lib/acProof.ts` · no migration, event, ACL feature, DI key,
error code or fixture change.

## Contract

`POST /api/delivery_os/projects/:id/evidence` with `kind: 'review'`

- Feature: `delivery_os.results.import`. No lock header (the project row and all project task rows are locked inside).
- Body: `{ kind: 'review', baselineId, taskId, sourceRevision, attachmentIds?, payload: { verdict, summary, findings?, manualCheckId?, reviewedEvidenceId?, reviewer: { kind: 'human' | 'agent', ref? } } }`.
  `sourceRevision` must be the `resultRevision` of the task's newest accepted result.
- `201 { evidenceId, duplicate: false, taskStatus, taskUpdatedAt }`; a replay `200 { …, duplicate: true, taskStatus, taskUpdatedAt }`
  with the task's current status. A review is a replay only while it is still the newest review or result of its task.
- The command result additionally carries `taskStatusReason` and `propagatedTaskIds` for in-process callers and the audit snapshot.

| Review | Effect |
|---|---|
| `changes_requested` (no `manualCheckId`) | `awaiting_review → changes_requested`; the round that reaches `limits.maxCorrectionRounds` (default 2, so the third) → `blocked` / `correction_limit_reached`, `draft` / `ready` dependants → `blocked` / `dependency_blocked` |
| `approved` (no `manualCheckId`) | `awaiting_review → verified` only when every AC of the task is proven on the result revision; `dependency_blocked` descendants return to `draft` |
| any verdict with `manualCheckId` | stores the human verdict for that manual check, moves nothing, is not a correction round; latest human verdict wins |

An AC is proven when all its `acTestMap` tests are `passed` in the accepted manifest or in `test` evidence (task or project-level) on the
pinned baseline and result revision (`failed` is sticky, `not_run` / missing never pass) and, when it has a manual check, a human review
with that `manualCheckId` approved it. An agent may approve — the system decides from the proof — but cannot decide a manual check and
nothing here publishes (deploy / release decisions are separate, OSS-05).

| Case | Answer |
|---|---|
| task not `awaiting_review` (incl. after the limit, verified, executing) | `409 invalid_transition` / `task_not_awaiting_review` |
| an AC not proven | `422 missing_required_tests`, one `ac_unproven` detail per AC (`acIds.<id>`), nothing stored |
| review names another revision than the accepted result | `422 missing_required_tests` / `revision_mismatch` (path `sourceRevision`) |
| no accepted result on the task | `422 missing_required_tests` / `missing_evidence` |
| results only on another baseline | `422 baseline_mismatch` |
| `reviewer.kind = 'human'` without a signed-in user | `403 forbidden` / `actor_required` |
| `manualCheckId` with an agent reviewer | `400 validation_failed` / `human_reviewer_required` |
| `manualCheckId` not a manual check of the task's AC | `422 unknown_test_id` / `unknown_manual_check` |
| `reviewedEvidenceId` not a row of the task | `422 foreign_reference` / `foreign_evidence` |
| task not of the project / pinned elsewhere / foreign baseline | as for the other kinds (`422 foreign_reference`, `422 baseline_mismatch`) |
| stored baseline altered | `422 hash_mismatch` |

Events after commit: `delivery_os.evidence.recorded` (new row and duplicate) and, when the task moved, `delivery_os.task.updated`
for the task and each propagated task. One audit entry per new row (`delivery_os.audit.evidence.record`, snapshot with `taskStatus`).

## Accepted risks (implementation review F1, F2)

- R19 stays gated by `delivery_os.results.import` (frozen route table; the feature is defined as "import results, record evidence").
  An importer credential can therefore post a review; the approval gate is the deterministic proof, not the role. A dedicated
  review feature is an ACL-contract change — a question for a human (OSS-06 / enterprise), not decided here.
- `reviewer.kind = 'human'` is trusted from the body when a user is signed in (plan D6, `recordedBy` names the user). **AI tool packs
  that post reviews MUST force `reviewer.kind: 'agent'` server-side** and route manual-check verdicts through the human approval UI.

## Patch requests

- **UI (UI-04 / UI-05):** the review form posts to R19 with `kind: 'review'`; read `taskStatus` from the response and refresh the task;
  show `blocked / correction_limit_reached` as an escalation to a human; render a `changes_requested` manual-check review as a
  failed manual AC (not a correction round); label agent reviews as agent. i18n key already present: `delivery_os.audit.evidence.record`.
  Strict copies of the R19 response must accept `taskStatus` / `taskUpdatedAt`.
- **EXEC:** a reviewer agent posts `reviewer: { kind: 'agent', ref }`; send the accepted result's `resultRevision` as `sourceRevision`
  and, when known, the `attemptId` (the review is then checked against that attempt's result).
  On `422 missing_required_tests` read `details[].path` (`acIds.<id>`) to name the AC to fix; on `409 invalid_transition` with
  `task_not_awaiting_review` do not retry. Test evidence posted at project level (`taskId` absent) counts for every task on that revision.
- **QA (TC-DELIVERY-008 candidates):** approved → verified with a green manifest; approved refused with one `not_run` check (status unchanged,
  no row); test evidence on another revision ignored; three `changes_requested` → `blocked` / `correction_limit_reached` and a `ready`
  dependant → `dependency_blocked`; replay 200 right after, new review after a new result; manual AC: agent manual-check → 400,
  human manual-check approved → 201 `awaiting_review`, then approved → verified; R12 `PUT /tasks status=verified` → 409.

## For the next OSS tasks

- **OSS-05 report:** call `proveAcceptanceCriteria` with the baseline's AC, `acTestMap`, `manualChecks`, the final revision and the rows of
  that baseline (task rows + project-level tests) — every `AcProof` names the evidence ids that decided it (`tests[].evidenceId`,
  `manualCheck.evidenceId`) for the drill-down. `not_run`, `failed`, `missing` are three distinct statuses; never fold them.
- The correction counter is `countCorrectionRounds` over the task's `review` rows (manual-check reviews excluded).
- No exit from `blocked / correction_limit_reached` other than `cancelled` (unchanged).

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 45 suites, 1116 tests green.
- `npx tsc --noEmit` in `packages/core` → clean; eslint on the touched files → clean.
- Live on http://localhost:3100 (script `/tmp/t029/live.ts`, log `/tmp/t029/live.log`): revision_mismatch 422 → changes_requested 201 →
  replay 200 duplicate → 409 while changes_requested → result with `not_run` → approved 422 `ac_unproven` (status unchanged) → round two →
  green result → agent approval 201 `verified` → 409 after verified; manual AC: 422 `ac_unproven AC-003` → agent manual-check 400 →
  unknown check 422 → human manual-check 201 `awaiting_review` → approved 201 `verified`; third round → `blocked / correction_limit_reached`,
  dependant `blocked / dependency_blocked`, new reservation 409. Audit rows carry `taskStatus`. Test data removed by SQL afterwards.
