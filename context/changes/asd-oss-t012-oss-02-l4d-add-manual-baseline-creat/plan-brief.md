# OSS-02 (L4d): manual baseline and decisions — Plan Brief

> Full plan: `context/changes/asd-oss-t012-oss-02-l4d-add-manual-baseline-creat/plan.md`
> Research: `context/changes/asd-oss-t012-oss-02-l4d-add-manual-baseline-creat/research.md`

## What & Why
Add `delivery_os.baselines.create` (manual) and `delivery_os.decisions.record` (requirements/design). They freeze the
agreed scope and bind the human approval to an exact hash and version. Without them no task can legally become ready.

## Starting Point
Pure baseline rules, entities, validators, events and the command helpers exist (T004–T011). No command can create a
baseline or set `activeBaselineId`.

## Desired End State
A user freezes the draft, approves requirements and design, and the project gets an active baseline plus one
`baseline.approved` event. Every failure path answers a catalogue code. Baselines and decisions are append-only.

## Key Decisions Made
| Decision | Choice | Why | Source |
|---|---|---|---|
| Lock header | required inside the commands, `428` when missing | safety boundary must not depend on a route | Plan |
| Second writer loses | every decision bumps `project.updatedAt` → platform 409 | reuses the platform conflict bar | Plan |
| Reject of the active baseline | clears `activeBaselineId`, no event | fail closed | Plan |
| Event | only when `activeBaselineId` becomes a baseline id | workflows trigger on approval | Plan |
| deploy/release kinds | `422 unsupported_evidence_kind` | OSS-05 | Plan |
| Attachments | same-scope lookup by id, `422 attachment_scope_mismatch` | FK-id coupling; bytes in OSS-03 | Research |
| Duplicate | same hash → existing row, `duplicate: true`; unique-violation recovery | idempotent UA-05 | Research |

## Scope
**In scope:** two command files, shared helpers, registration, unit tests, spec changelog, hand-over note.
**Out of scope:** routes/ACL, proposal import, byte verification, deploy/release, i18n, migrations.

## Architecture / Approach
One transaction per command: lock the project, load, check in memory, mutate last, emit after commit.

## Phases at a Glance
| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Commands and tests | both commands + unit tests | mock dispatch per entity; decision ties |

**Prerequisites:** T011 merged. **Estimated effort:** one session.

## Open Risks & Assumptions
- Routes must merge the path id into the input and check `baselines.approve` (`manage` is not enough).
- With `OM_OPTIMISTIC_LOCK=off` the second-writer rule is not enforced by the platform helper.

## Success Criteria (Summary)
- Listed jest commands and the scoped typecheck pass; grep finds no update/delete path.
