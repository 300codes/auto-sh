# OSS-04 (L8e): generic evidence recording (R19) — Plan Brief

> Full plan: `context/changes/asd-oss-t028-oss-04-l8e-add-generic-evidence-reco/plan.md`
> Research: `context/changes/asd-oss-t028-oss-04-l8e-add-generic-evidence-reco/research.md`

## What & Why

The operator (UA-13) and the WordPress PoC import (UA-27) need to put proof next to a project: test reports,
screenshots, scans, deployments and historical reference material. The system must check that proof against the frozen
baseline and the target profile, store it once, and never let it publish anything or move a task.

## Starting Point

The request schema, the check-mapping helper, the attachment verifier and the profile rules exist. Only the command
`delivery_os.evidence.record` and the route `POST /projects/:id/evidence` are missing.

## Desired End State

A valid body answers `201 { evidenceId, duplicate: false }`, an identical replay `200 { …, duplicate: true }` with one
row. False hashes, AC or tests outside the baseline map, incomplete deployments, wrong revision kinds and kinds the
profile does not permit are refused with the frozen codes.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Idempotency | Project row lock + lookup by (project, kind, task, attempt, hash); no migration | Schema must not change; lock serializes writers | Plan |
| Check order | Replay before domain checks and storage reads | Same as result import | Research |
| Test evidence without a task | Validated against the whole baseline map | Validator allows it; no invented mappings | Plan |
| Screenshot errors | Scope → `foreign_reference`; other → `hash_mismatch` | Spec lists `hash_mismatch` for R19 | Research |
| Deployment | System derives `verificationStatus`; `verified` only for the same build and a succeeded upload | Agent proposes, system decides | Plan |
| Kind vs profile | Not permitted → `422 unsupported_evidence_kind` | `reference_material` is WordPress-only | Research |
| `review` kind | 422 stub until L8f | Keeps the commit working | Task |
| Response | `{ evidenceId, duplicate }` only | No task transition here; UI strict copies | Research |

## Scope

**In scope:** `lib/evidenceRules.ts`, command, attachment helper, route, response schema, unit and route tests, pinned guards, `projectStatus` assertion, spec changelog, hand-over.

**Out of scope:** review kind, status changes, deploy/release decisions, report API, migration, UI, i18n, integration specs.

## Architecture / Approach

Route (scope, cap, schema) → command bus → command: project lock → replay lookup → baseline/task/attempt references →
profile rules → pure kind rules → stored-file verification → one insert → after commit: event + index side effects.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rules, command, guards | Working command with unit tests | Test context cut from the baseline must match L8b semantics |
| 2. Route, generate, docs, live check | HTTP surface, spec, hand-over, smoke evidence | Dev server serves stale command modules (restart needed) |

**Prerequisites:** L8b helper and the frozen validators (done).
**Estimated effort:** one session, two phases.

## Open Risks & Assumptions

- Evidence may name a baseline that is not approved; it is stored with that baseline and cannot prove another one.
- `testDefinitionHash` is stored but not compared (nothing frozen to compare with) — left to OSS-05.
- UI must add the audit i18n key and allow `verificationStatus` in a deployment payload.

## Success Criteria (Summary)

- Each kind is stored once; a replay never creates a second row.
- Every listed refusal answers the frozen code; no task or publication side effect exists.
- The two new test files and the pinned guards are green with `--maxWorkers=2`.
