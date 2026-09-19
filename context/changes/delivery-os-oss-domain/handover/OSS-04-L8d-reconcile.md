# OSS-04 (L8d) hand-over — attempt reconcile (R18)

Task T027 · DTO/contract version: **v1, unchanged** (external evidence lives in the existing `reconciliation` +
`externalRunId` attempt fields) · additive: route R18, command `delivery_os.attempts.reconcile`, response schema
`attemptReconcileResponseSchema`, command schema `reconcileAttemptCommandSchema` · no migration, event, ACL feature,
DI key, error code or fixture change.

## Contract

`POST /api/delivery_os/tasks/:id/attempts/:attemptId/reconcile`

- Feature: `delivery_os.attempts.reconcile` (separate from `attempts.manage`; admin has it through `delivery_os.*`,
  employee does not).
- Header: task optimistic lock `x-om-ext-optimistic-lock-expected-updated-at: <task.updatedAt>` (required).
- Body: `{ resolution: 'not_started' | 'stopped' | 'completed' | 'unknown', externalEvidence: { note ≤ 4000, observedAt, externalRunId? }, manifest? }`.
- `200 { attemptId, resolution, taskStatus, taskUpdatedAt, evidenceId? }` (`evidenceId` only for `completed`).

| Case | Answer |
|---|---|
| `not_started` / `stopped` on an active or unknown attempt | attempt `closed` (`outcome` `not_started` / `stopped`, or `cancelled` after a cancel request; `stopConfirmation: 'stopped'` for `stopped`), task `ready` |
| same, in a correction round (an earlier attempt has a result) | task `changes_requested` |
| same, but the task no longer passes the ready gate (baseline not active / not approved) | attempt still closed, task `blocked` with reason null (`dependency_blocked` when an ancestor is blocked); dependants `blocked / dependency_blocked` |
| `completed` + manifest | exactly the R16 validation; evidence `result_manifest` (`source: manual`), attempt `result_accepted`, task `awaiting_review`; `delivery_os.evidence.recorded` with `completionDelivery` as in R16 |
| `completed` without manifest | `422 manifest_required` |
| `completed` with a bad manifest | the R16 code (`correlation_mismatch`, `path_not_allowed`, …); nothing written, also no reconciliation record |
| `unknown` | attempt `reconciliation_required`, task `blocked / reconciliation_required`; reserve, archive and result import answer `409 reconciliation_required`; dependants blocked |
| later reconcile of an unknown attempt | allowed with any resolution; releasing moves `dependency_blocked` dependants back to `draft` (existing un-block rule — a human sets them ready again) |
| attempt with a result or closed | `409 attempt_not_reconcilable` (no replay) |
| unknown attempt id | `404 attempt_not_found`; foreign scope / archived / malformed ids → `404 not_found` (before body validation) |
| header missing / stale | `428 optimistic_lock_required` / platform `409 optimistic_lock_conflict` |
| user with `attempts.manage` only | `403` from route metadata |

Nothing is restarted or dispatched: the command resolves no command bus, queue or workflow service and emits only
`delivery_os.task.updated` (+ `delivery_os.evidence.recorded` for `completed`).

## Patch requests

- **EXEC**: after a worker restart, for every attempt that is `claimed` with no live process call
  `commandBus.execute('delivery_os.attempts.reconcile', { input: { taskId, attemptId, resolution: 'unknown', externalEvidence: { note, observedAt }, trustedExecution: issueTrustedExecution(actorUserId) }, ctx })`
  with a ctx that has no `request` (no lock header needed in-process). Never re-run the CLI for such an attempt.
  A reconciled `completed` on a workflow-linked attempt emits `evidence.recorded` with `completionDelivery: 'pending'`
  exactly like R16, so the existing resume path delivers it; no extra signal.
- **UI**: add i18n key `delivery_os.audit.attempts.reconcile` ("Reconcile execution attempt"). `AttemptActions`:
  offer reconcile for `cancel_requested`, `claimed`/`reserved` and `reconciliation_required` attempts; require the
  note and observed time; show the manifest field only for `completed`; send the task `updatedAt` as the lock header;
  after `unknown` show "state unknown — reconcile before retry". Allow non-null `reconciliation` in strict copies.
- **QA** (TC-DELIVERY-007 candidates): cancel → reconcile `stopped` → reserve 201; reserve → `unknown` → reserve 409 +
  task DELETE 409 + result import 409 → reconcile `completed` with the manifest → `awaiting_review`, one evidence row;
  `completed` without manifest 422; user with only `attempts.manage` 403; closed attempt 409
  `attempt_not_reconcilable`; stale version 409; after a restart the unknown attempt does not start again by itself.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 41 suites, 1022 tests green.
- Live smoke on :3100 (`/tmp/t027/live.ts`, log `/tmp/t027/live.log`): 428 / 409 stale / 400 / 422
  `manifest_required`; `unknown` → blocked + reserve/archive/import 409; foreign manifest → 422
  `correlation_mismatch`; real manifest → 200 `awaiting_review` + evidence; closed → 409; identical import replay →
  200 duplicate; second task `stopped` → `ready` → reserve 201; audit entries present. Test rows cleaned up.

## Limitations

- "Correction round" is derived from the register (another attempt with a result), not from review evidence.
- The 428 message text still says "project version header" (shared helper wording, unchanged here).
