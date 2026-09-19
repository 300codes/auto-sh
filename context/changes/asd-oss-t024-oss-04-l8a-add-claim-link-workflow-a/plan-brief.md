# OSS-04 (L8a): claim, link_workflow, mark_delivery and closing the attempt on accept — Plan Brief

> Full plan: `context/changes/asd-oss-t024-oss-04-l8a-add-claim-link-workflow-a/plan.md`
> Research: `context/changes/asd-oss-t024-oss-04-l8a-add-claim-link-workflow-a/research.md`

## What & Why

The EXEC bridge needs real OSS commands to run the live vertical trial: claim an attempt once, link it to the workflow
step that waits for it, and mark the completion delivery. OSS owns them so "the agent proposes, the system decides"
holds: every write to the attempt register goes through one locked, validated domain path.

## Starting Point

`claimAttempt` exists as a pure reducer; only `attempts.reserve` and `results.accept` are commands. Accept records the
result and the pending delivery but never closes the attempt.

## Desired End State

Three internal, in-process-only commands plus an accept that closes the attempt atomically. A duplicate result writes
nothing but re-emits the pending signal; `listPendingDeliveries` shows the attempt until `mark_delivery` says delivered.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| State after accept | stays `result_received`, adds `closedAt` + `outcome: 'result_accepted'` | additive to the published H4/H9 behaviour | Plan |
| Delivery counter | optional `deliveryAttempts` on ExecutionAttempt v1 | no counter existed; optional keeps v1 registers valid | Research / Plan |
| Trusted gate | `!ctx.request` + `trustedExecution`, checked before parsing | same rule as automatic reserve; no hints to HTTP callers | Research |
| Locking | task row `PESSIMISTIC_WRITE`, no lock header | in-process callers, serialised per attempt | Spec |
| Error codes | reuse frozen codes with new detail codes | the error list is a frozen contract | Plan |
| link shape | `workflowRef`, `workflowStepId?`, `dispatched?`; immutable once set | bridge may link before enqueue and mark dispatched after | Master plan |
| mark_delivery | `delivered` / `failed + error`; delivered never regresses | retries must be idempotent | Spec |
| Events | none from the three commands; index side effect + audit only | status unchanged; avoids workflow trigger loops | Plan |

## Scope

**In scope:** reducers, DTO field, three commands, accept closing, unit tests, spec + EXEC hand-over.

**Out of scope:** cancel/reconcile commands, routes, ACL, events, migrations, enterprise code.

## Architecture / Approach

`commands/attempts.ts` gets one private runner: trusted gate → zod → transaction → `lockScopedTask` → reducer → write
register → (after commit) index side effect. `commands/evidence.ts` chains `recordAttemptResult` → `closeAttempt`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reducers | DTO field + three reducers with tests | rule gaps around idempotency |
| 2. Commands | three commands, accept closes, flow tests | harness mixing reserve + accept |
| 3. Docs | spec rows, EXEC hand-over | none |

**Prerequisites:** none (EXEC bridge is built against this contract).
**Estimated effort:** one session.

## Open Risks & Assumptions

- EXEC accepts the input shapes defined here (OSS owns the contract; listed in the hand-over).
- UI treats `result_received` + `closedAt` as finished; no UI code reads `closedAt` today.

## Success Criteria (Summary)

- Second claim by another worker conflicts; the executor runs once across reserve/claim/duplicate accept.
- Duplicate accept: no evidence row, event re-emitted with `completionDelivery: 'pending'`.
- `mark_delivery` flips `listPendingDeliveries`; HTTP-shaped callers cannot reach the commands.
