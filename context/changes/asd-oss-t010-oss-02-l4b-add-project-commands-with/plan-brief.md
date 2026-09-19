# OSS-02 (L4b): project commands — Plan Brief

> Full plan: `context/changes/asd-oss-t010-oss-02-l4b-add-project-commands-with/plan.md`
> Research: `context/changes/asd-oss-t010-oss-02-l4b-add-project-commands-with/research.md`

## What & Why

Add the first write path of the delivery domain: shared command helpers and the three project commands
(create, update, archive). This is the deterministic "system decides" side: scope from the session, validated
drafts, stale edits refused, no archive while an agent run is live or unknown.

## Starting Point

Entities, validators, error catalogue, domain rules, ACL and events exist. No `commands/` folder, no routes.

## Desired End State

The command bus can create, edit and archive a delivery project safely; later command files reuse the helpers.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Scope | session only (`ctx.auth`, selected org), body ignored | tenant isolation | Plan |
| Validation errors | frozen `{error, code, details[]}` via `deliveryErrorFromZod` | stable UI/QA contract | Research |
| Archive codes | `attempt_active`, `reconciliation_required` (fail closed on unreadable register) | spec is authoritative over task wording | Research |
| Active task status | `executing` | only status with a running process | Plan |
| Optimistic lock | platform helper, inside the row-locked transaction, platform 409 body | atomic, UI conflict bar works | Research |
| Undo | none, audit snapshots only | undo would bypass domain guards | Plan |
| Events | `project.created` once after commit, no CRUD events | T009 decision | Plan |

## Scope

**In scope:** `commands/{shared,projects,index}.ts`, `getLatestTargetProfile`, unit tests, `yarn generate`, spec changelog, hand-over note.

**Out of scope:** routes, 428 enforcement, other commands, UI/i18n, integration tests, attachment verification.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Shared helpers | scope, loaders, error + lock helpers, latest profile | mock fidelity of `findOneWithDecryption` |
| 2. Project commands | three commands, tests, generated registry | generator noise in shared generated files |

**Prerequisites:** T004–T009 landed. **Estimated effort:** one session.

## Open Risks & Assumptions

- The route task must enforce `428 optimistic_lock_required`; commands stay header-optional for workers.
- Audit label i18n keys are handed to the UI stream.

## Success Criteria (Summary)

- Commands jest suite green with paired positive/negative cases; scoped typecheck green.
