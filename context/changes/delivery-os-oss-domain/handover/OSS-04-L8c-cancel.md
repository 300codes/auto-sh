# OSS-04 (L8c) hand-over — attempt cancel (R17)

Task T026 · DTO/contract version: **v1, unchanged** (no new attempt field) · additive: route R17, command
`delivery_os.attempts.cancel`, response schema `attemptCancelResponseSchema` · no migration, no event, no ACL feature,
no DI key, no error code, no fixture change.

## Contract

`POST /api/delivery_os/tasks/:id/attempts/:attemptId/cancel`

- Feature: `delivery_os.attempts.manage` (already in `acl.ts` and in the admin default role).
- Header: task optimistic lock `x-om-ext-optimistic-lock-expected-updated-at: <task.updatedAt>` (required).
- Body: `{ reason?: string ≤ 2000 }` — kept only in the audit entry (`snapshotAfter.reason`), never on the attempt.
- `200 { attemptId, state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed', taskStatus, taskUpdatedAt }`.
  `state` / `stopConfirmation` are literals: the response never says the external process stopped.

| Case | Answer |
|---|---|
| `reserved` / `claimed` attempt, fresh version | `200`, attempt → `cancel_requested`, `cancellationRequestedAt` set, task stays `executing`, one `delivery_os.task.updated`, one audit entry |
| same request again (attempt already `cancel_requested`), even with a stale version | `200` same body, nothing written, no event, no audit |
| header missing | `428 optimistic_lock_required` |
| stale version | platform `409 optimistic_lock_conflict` |
| `result_received` / `closed` / `reconciliation_required` attempt | `409 attempt_not_active` |
| unknown attempt on the task | `404 attempt_not_found` |
| foreign tenant/org, archived task, malformed ids | `404 not_found` |
| reason above 2000 characters | `400 validation_failed` |
| user without `attempts.manage` (e.g. `projects.manage` + `results.import`) | `403` from route metadata |

After a cancel, until R18 reconcile: new reservation → `409 attempt_active`; task and project archive → `409
attempt_active` (detail `attempt_cancel_requested`); claim / link_workflow / GET package → `409 attempt_cancelled` (already covered by earlier tests);
result import → `409 attempt_cancelled`, no evidence row; an identical replay of an already accepted manifest still
answers `200 duplicate: true` (cancel of that attempt is `409 attempt_not_active`).

## Patch requests

- **UI**: add i18n key `delivery_os.audit.attempts.cancel` ("Request execution attempt cancellation"). Show
  `cancel_requested` + `stop_unconfirmed` as "cancellation requested — stop not confirmed" and offer reconcile (R18)
  next; do not label it "stopped". Send the task `updatedAt` as the lock header; a 200 on a repeat is normal.
- **EXEC**: a claim or link that answers `409 attempt_cancelled` means "do not start / stop the run"; the stop itself
  is confirmed only by reconcile (`stopped` / `not_started`), never by this route.
- **QA** (TC-DELIVERY-007 candidates): reserve → cancel 200 body; cancel again 200; reserve 409 `attempt_active`; task
  DELETE 409; late result 409 `attempt_cancelled` + zero evidence; 428 / stale 409; manage-less user 403.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 39 suites, 991 tests passed
  (new: 10 command tests in `commands/__tests__/attempts.test.ts`, 8 route tests in `api/__tests__/cancel.route.test.ts`).
- `yarn workspace @open-mercato/core typecheck` → clean.
- Live on :3100 (rebuilt core, `yarn dev:app`): 428 → stale 409 → 200 documented body → repeat 200 → reserve 409 →
  task DELETE 409 → project DELETE 409 → late result 409 `attempt_cancelled` with 0 evidence → unknown attempt 404;
  audit API shows one `delivery_os.attempts.cancel` entry with the reason. Test rows deleted afterwards.
