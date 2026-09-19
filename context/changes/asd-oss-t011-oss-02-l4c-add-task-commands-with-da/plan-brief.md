# OSS-02 (L4c): task commands — Plan Brief

> Full plan: `context/changes/asd-oss-t011-oss-02-l4c-add-task-commands-with-da/plan.md`
> Research: `context/changes/asd-oss-t011-oss-02-l4c-add-task-commands-with-da/research.md`

## What & Why
Add `delivery_os.tasks.create|update|delete`. They are the only way a human plans work for the coding agents, so every
gate (approved baseline, known AC, acyclic dependencies, ready gate, no tampering with live runs) is enforced here.

## Starting Point
Project commands, shared lock helpers and all pure domain rules exist (T004–T010). No task command exists.

## Desired End State
Three registered commands with unit tests for the happy path and all failure paths; no migration or contract change.

## Key Decisions Made
| Decision | Choice | Why | Source |
|---|---|---|---|
| Lock order | project row → live project tasks → optimistic check on the task | no cycle race, same as archive | Research |
| Foreign baseline | `422 foreign_reference` | spec UA-08 | Research |
| Scope edits | only in `draft`/`blocked`, else `409 invalid_transition` | cannot bypass the ready gate | Plan |
| User status change on a live/unknown run | `409 attempt_active` / `reconciliation_required` | system decides, not the caller | Plan |
| Status reasons | only `dependency_blocked` is cleared here | reconcile/review own the others | Plan |
| Delete with dependents | `422 foreign_dependency` / `has_dependents` | no new codes | Plan |
| `plan_proposal` source | `400 validation_failed` here | OSS-03 | Plan |

## Scope
**In scope:** `commands/tasks.ts`, `lockTaskForWrite`, classifier label, tests, spec changelog, hand-over note.
**Out of scope:** routes, plan import, attempts/results/reviews, i18n, migrations.

## Architecture / Approach
One transaction per command: loads under locks, pure checks from `lib/*`, mutations last, propagation on locked rows,
events and index side effects after commit.

## Phases at a Glance
| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Task commands and tests | commands + unit tests | mock dispatch per entity in tests |

**Prerequisites:** T010 merged. **Estimated effort:** one session.

## Open Risks & Assumptions
- Routes must pass `projectId` from the path into the create command.
- Review evidence count as correction budget is reused by OSS-04.

## Success Criteria (Summary)
- The listed jest commands and scoped typecheck pass.
