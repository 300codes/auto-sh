# OSS-04 (L8a) hand-over — internal attempt commands and closing the attempt on accept

Task T024 · DTO/contract version: **v1, additive** (`ExecutionAttempt.deliveryAttempts?`) · no migration, no generated
file, no workspace change, no new route / event / ACL feature / DI key / error code.

## What works (for EXEC-04: the execution bridge)

Three OSS commands, **in-process only**. Call them through the command bus (`commandBus.execute(id, { input, ctx })`) —
the task query-index refresh and the audit entry run there, not in `handler.execute`.

| Command id | Input (besides `taskId`, `attemptId`, `trustedExecution`) | Effect |
|---|---|---|
| `delivery_os.attempts.claim` | `workerRef` (1–200) | `reserved → claimed`, sets `claimedAt` + `workerRef` exactly once |
| `delivery_os.attempts.link_workflow` | `workflowRef` (1–200), `workflowStepId?` (1–200 \| null), `dispatched?` (bool) | sets `workflowRef`, `workflowStepId`; `dispatchedAt` the first time `dispatched: true` is seen (same or later call) |
| `delivery_os.attempts.mark_delivery` | `outcome: 'delivered'` or `outcome: 'failed'` + `error` (1–8000) | `delivered` → `completionDelivery = 'delivered'`, `lastDeliveryError = null`; `failed` → stays `pending`, stores the error (cut to 2000); both add 1 to `deliveryAttempts` |

Result of all three: `{ taskId, attemptId, changed, attempt: ExecutionAttempt, taskUpdatedAt }` (type
`AttemptInternalCommandResult` from `commands/attempts.ts`). `changed: false` = idempotent replay: nothing written, no
audit entry.

**Trusted-context rule** (same as `mode: 'automatic'` on `attempts.reserve` and `source: 'adapter'` on `results.accept`):

- build the option in-process, once per call or per job:
  `import { issueTrustedExecution } from '@open-mercato/core/modules/delivery_os/lib/trustedExecution'` →
  `trustedExecution: issueTrustedExecution(actorUserId)`. It is a frozen `{ source: 'delivery_agents', actorUserId }`
  registered in a process-wide `WeakSet`; **an object of the same shape that was not issued is refused** (a copy, a
  spread, anything parsed from JSON or read from a queue payload — issue it inside the worker, never serialise it).
  Reason: the notification and message action dispatchers run a stored `commandId` with a ctx without `request` and
  merge the HTTP payload into the input, so a plain JSON marker could be forged by any tenant user;
- **the same issued option is now required for `attempts.reserve` with `mode: 'automatic'` and for `results.accept`
  with `source: 'adapter'`** (new optional command input `trustedExecution`); the public routes are unchanged;
- `ctx.request` present or option not issued → `403 forbidden` / `trusted_execution_required`, before any validation or read;
- tenant / organization come from `ctx.auth` only — values in the input are ignored; a foreign or archived task → `404 not_found`;
- never register these ids with `registerWorkflowSafeCommands`: `UPDATE_ENTITY` builds a ctx without `request`, so the
  input option would be the only barrier left. `scopeChange.test.ts` fails if the module ever does it.

| Case | Answer |
|---|---|
| second claim, same `workerRef` | `changed: false` (keeps the first `claimedAt`) |
| second claim, another worker | `409 attempt_active` |
| claim / link on an attempt with a result or closed | `409 attempt_closed` — **a redelivered job must treat this as "do not run the CLI"** |
| claim / link after a cancellation request / unknown run | `409 attempt_cancelled` / `409 reconciliation_required` |
| link with another `workflowRef` or another step | `409 attempt_active`, detail `workflow_link_conflict` (link is immutable; an omitted step never clears a stored one; a missing step can be filled later) |
| `mark_delivery` on an already delivered attempt (either outcome) | `changed: false` — delivered never regresses |
| `mark_delivery` when `completionDelivery` is null (OSS-only attempt, or no result yet) | `409 attempt_not_active`, detail `no_pending_delivery` |
| attempt id not on the task | `404 attempt_not_found` |
| unreadable attempt register | `409 reconciliation_required` (fail closed) |

All three lock the task row `PESSIMISTIC_WRITE` in one transaction, need no optimistic-lock header and emit no domain
event (task status does not change).

### `delivery_os.results.accept` now closes the attempt

Same transaction as the evidence row: `resultEvidenceId`, `completionDelivery = 'pending'` (only with a `workflowRef`),
**`closedAt` + `outcome: 'result_accepted'`**, task `→ awaiting_review`. The attempt `state` stays `result_received`.
A duplicate (same manifest) writes nothing and re-emits `delivery_os.evidence.recorded` with the **current**
`completionDelivery` (`pending` until `mark_delivery` says delivered, then `delivered`) — this is the retry signal; it
never re-runs anything.

### Suggested bridge order

1. `attempts.reserve` (`mode: 'automatic'`, trusted) — replay with the same key returns the same attempt.
2. `attempts.claim` — run the CLI **only if `changed: true`**; any 409 → skip the run.
3. `attempts.link_workflow` **before** `results.accept` (`dispatched: true` once the job is enqueued/started). The
   pending delivery is decided at accept time from `workflowRef`; a link after the result answers `409 attempt_closed`
   and the attempt would never become pending.
4. run the executor → `results.accept` (`source: 'adapter'`, in-process).
5. signal the waiting workflow step → `attempts.mark_delivery` `delivered`, or `failed` + error and retry later.
6. Recovery after a restart: `deliveryOsAttemptQueries.listPendingDeliveries(scope)` (lists the attempt until it is
   delivered) and/or the `delivery_os.evidence.recorded` event with `completionDelivery: 'pending'`.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 37 suites, 924 tests, all green.
  New: reducers in `lib/__tests__/attempts.test.ts`; `internal attempt commands` block in
  `commands/__tests__/attempts.test.ts` (trusted gate ×3 commands, row lock, claim race → one winner, link rules,
  serialised + idempotent `mark_delivery`, audit actor, no event); `execution bridge flow with a fake executor` in
  `commands/__tests__/results.test.ts` (executor invoked once across reserve replay / claim / redelivered job /
  duplicate accept; duplicate writes no evidence and re-emits `completionDelivery: 'pending'`; `mark_delivery` flips
  `listPendingDeliveries` from one row to none; OSS-only attempt needs no delivery); id list + workflow-safe guard in
  `commands/__tests__/scopeChange.test.ts`; issued-token rules in `lib/__tests__/trustedExecution.test.ts` and forged-option
  cases for reserve, accept and the three commands.
- `yarn workspace @open-mercato/core typecheck` green; touched test files type-check with a temporary tsconfig; eslint
  clean on the touched files.
- Live smoke on :3100 (`/tmp/t024/live.ts`, not in the repo; after a standalone core build + `yarn dev:app` restart):
  R14 → R15 → R16; stored attempt after accept = `state: result_received`, `closedAt` set, `outcome: result_accepted`,
  `completionDelivery: null` (OSS-only); duplicate 200, other content 409, package after the result 409
  `attempt_closed`, new reserve 409 `task_not_ready`; test rows removed.

Master-plan Progress rows with OSS-side evidence: **4.1** (claim once, executor once, duplicate does not duplicate
evidence), **4.7** (pending is durable, duplicate retries the pending delivery, delivered is recorded). The workflow
side of both stays open for EXEC/QA; no manual row is ticked.

## Limitations

- A worker that crashed after its claim and retries with the same `workerRef` gets `changed: false` and must NOT run
  the CLI again (master plan: an unknown process never restarts by itself) — that attempt waits for reconcile (next step).
- Every `failed` `mark_delivery` bumps the task `updatedAt` and writes one audit row: back off between delivery retries,
  and UI forms must re-read `updatedAt` before a task edit.

- The three commands have no HTTP surface, so they are verified by unit tests only; the live check needs the EXEC bridge.
- `cancel` / `reconcile` commands and the unknown-after-restart scenario are the next OSS-04 step.
- Attempts accepted before this change keep `closedAt: null` (nothing reads `closedAt`; `resultEvidenceId` marks them).
- `deliveryAttempts` is absent until the first `mark_delivery`; read it as 0.

## Patch requests to other streams

- **EXEC**: use the ids/shapes above in `delivery_agents/lib/executionBridge.ts` / `workers/{execute-task,resume-attempt}.ts`;
  treat `409 attempt_closed` on claim as "already done"; generate a stable `workerRef` per job so a retry of the same
  job is idempotent.
- **UI**: task responses may now carry `executionAttempts[].deliveryAttempts`, and `closedAt` / `outcome` are non-null
  after a result — allow them in any strict copy; i18n keys `delivery_os.audit.attempts.claim`, `.link_workflow`,
  `.mark_delivery`; detail codes `workflow_link_conflict`, `no_pending_delivery`.
- **QA**: TC-DELIVERY-006 may assert `outcome: 'result_accepted'` + `closedAt` after R16 and that a replay does not change them.
