# OSS-04 (L8d): attempt reconcile (R18) — Plan Brief

> Full plan: `context/changes/asd-oss-t027-oss-04-l8d-add-attempt-reconcile-com/plan.md`
> Research: `context/changes/asd-oss-t027-oss-04-l8d-add-attempt-reconcile-com/research.md`

## What & Why

When an agent run becomes uncertain (cancel requested, crash, restart), a human states what really happened and the
system decides what follows. This closes the attempt lifecycle of OSS-04 and is the visible "agent proposes, system
decides" boundary: nothing restarts on its own.

## Starting Point

The pure reducer, request schema, ACL feature, error codes and all the blocking rules exist. The command, the route,
tests and docs do not.

## Desired End State

`POST /api/delivery_os/tasks/:id/attempts/:attemptId/reconcile` records the resolution. `not_started`/`stopped`
release the task, `completed` runs the very same acceptance as the result import and ends in `awaiting_review`,
`unknown` blocks the task until a later reconcile.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Acceptance reuse | Extract the transaction body of `results.accept` into a shared helper | One validation path, as the spec demands | Plan |
| Correction round | Earlier attempt with a result ⇒ `changes_requested` | Pure rule, matches the lifecycle | Research |
| Ready gate fails on release | Task goes `blocked` (no reason) | Never leaves an unarchivable active attempt, never fakes `ready` | Plan |
| Propagation | Block / unblock descendants like `tasks.update` | Board stays truthful | Plan |
| Actor | User uuid, or issued trusted executor in-process | EXEC must mark `unknown` after a restart | Plan |
| Replay | None; closed attempt → 409 | Acceptance criterion | Task |
| Contract | No new attempt fields | `reconciliation` + `externalRunId` already hold the evidence | Research |

## Scope

**In scope:** command, shared helper, route, response schema, unit + route tests, spec changelog, hand-over, generate.

**Out of scope:** executor/dispatch, UI, i18n, integration spec, new DTO fields.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Command and shared acceptance | Working command with tests | Refactor of `results.accept` must not change behaviour |
| 2. Route, docs, generation | R18 live, documented | Dev server serves stale core build (restart needed) |

**Prerequisites:** T024-T026 landed. **Estimated effort:** one session.

## Open Risks & Assumptions

- EXEC calls the command in-process with the issued trusted option to mark `unknown` after a restart.
- UI adds the audit i18n key and the reconcile form.

## Success Criteria (Summary)

- All four resolutions behave as the spec line for UA-19 says; `completed` can never skip review.
- An unknown attempt blocks reserve and archive until reconciled; nothing is dispatched by reconcile.
