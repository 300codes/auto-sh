# OSS-02 (L4e): attempt reservation and TaskPackage builder — Plan Brief

> Full plan: `context/changes/asd-oss-t013-oss-02-l4e-add-attempt-reservation-c/plan.md`
> Research: `context/changes/asd-oss-t013-oss-02-l4e-add-attempt-reservation-c/research.md`

## What & Why

Before any executor (human hand-off or agent) may start a task, the system reserves one attempt under a row lock.
This task adds that command and the pure builder of the TaskPackage v1 document the executor receives. It is the
point where "the agent proposes, the system decides" becomes enforceable: one key, one attempt, one pinned baseline.

## Starting Point

Pure reducers (`reserveAttempt`, `checkAttemptOpen`, `canTransition`) and shared command helpers exist. Nothing
writes the attempt register and no package builder exists.

## Desired End State

`delivery_os.attempts.reserve` reserves idempotently and moves the task to `executing`; `buildTaskPackageV1`
produces a schema-valid package equal to the published fixtures, or a catalogue error. The whole module suite is green.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Check order | replay → key conflict → lock → register conflicts → task checks | Replay before lock (spec); conflicts reachable | Plan |
| Lock | Header required and compare forced for request-bound new keys; none for trusted in-process | Gate must not depend on env | Plan / T012 |
| `automatic` | Only without `ctx.request` and with typed `trustedExecution`; else 403 `forbidden` | Spec line 250, fail closed | Research |
| Blocked task | `task_not_ready` + detail `task_blocked` | Catalogue is frozen | Plan |
| Stale baseline | 422 `baseline_not_active` on a new key | No agent run on stale scope | Plan |
| Actor | Not required for manual reserve | API-key callers, register stores no actor | Plan |
| Builder scope | Only the task's ACs, their requirements and tests | Matches fixtures | Research |

## Scope

**In scope:** `lib/taskPackage.ts`, `commands/attempts.ts`, validator, four exports from `commands/tasks.ts`, unit tests, spec/hand-over notes.

**Out of scope:** routes, claim/cancel/reconcile, result import, UI, integration tests, enterprise.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Builder | Pure package builder + tests | Fixture equality |
| 2. Reserve | Command + tests + notes | Check ordering |

**Prerequisites:** T010–T012 commands (done). **Estimated effort:** one session.

## Open Risks & Assumptions

- `task.updatedAt` is set by the ORM `onUpdate` hook at flush; the mocked EM cannot prove it. Verify over HTTP in the routes task.
- A real two-connection race is QA's.

## Success Criteria (Summary)

- Module jest suite green; scoped typecheck clean.
- Same key twice → one attempt; automatic mode unreachable from HTTP.
