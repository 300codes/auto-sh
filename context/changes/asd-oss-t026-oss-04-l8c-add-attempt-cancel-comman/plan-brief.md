# OSS-04 (L8c): attempt cancel command and route R17 — Plan Brief

> Full plan: `context/changes/asd-oss-t026-oss-04-l8c-add-attempt-cancel-comman/plan.md`

## What & Why

UA-18: an operator cancels a running agent execution attempt. The system records the request and blocks new
dispatch, late results, a new reservation and archiving until the attempt is reconciled — and it never pretends the
external process stopped. This is the visible "the agent proposes, the system decides" boundary for the demo.

## Starting Point

The pure reducer `requestCancellation`, the late-result gate (`attempt_cancelled`), the archive/reserve guards and the
input schema already exist. There is no command, route or response schema yet.

## Desired End State

`POST /api/delivery_os/tasks/:id/attempts/:attemptId/cancel` answers
`200 { attemptId, state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed', taskStatus, taskUpdatedAt }`,
with 428 / 409 stale / 409 `attempt_not_active` / 404 / 403 for the failure paths.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Reason storage | Audit entry only | `ExecutionAttempt v1` is frozen; UI keeps strict copies |
| Repeated cancel | Idempotent 200, no write, even with stale header | Retries/double clicks must not 409 |
| Check order | 404 → 428 → register → replay → stale 409 → domain 409 | Mirrors reserve; stale beats conflict |
| Task status | Stays `executing` | Only reconcile/result move it; no `executing → cancelled` edge |
| Response typing | Literal `cancel_requested` / `stop_unconfirmed` | The body can never claim a stop |

## Scope

**In scope:** command, route R17, response schema, command + route tests, pinned id list, `yarn generate`, spec
changelog, hand-over.

**Out of scope:** reconcile (R18), stopping external processes, UI, i18n, Playwright tests, migrations.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Cancel command | `delivery_os.attempts.cancel` + tests | Lock/replay ordering |
| 2. Route R17 + smoke | Route, schema, route tests, docs, live check | Dev-server restart after core build |

**Prerequisites:** T024/T025 landed (attempt commands, result acceptance). **Estimated effort:** one session.

## Open Risks & Assumptions

- The live smoke needs a core build and a dev server restart (memory notes: free :3100 before `yarn dev:app`).

## Success Criteria (Summary)

- A cancelled attempt is honest (`stop_unconfirmed`), blocks reserve/archive/late results, and every failure path
  answers the documented code.
