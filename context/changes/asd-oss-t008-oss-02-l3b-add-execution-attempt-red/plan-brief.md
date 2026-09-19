# OSS-02 (L3b): attempt reducers and baseline rules — Plan Brief

> Full plan: `context/changes/asd-oss-t008-oss-02-l3b-add-execution-attempt-red/plan.md`
> Research: `context/changes/asd-oss-t008-oss-02-l3b-add-execution-attempt-red/research.md`

## What & Why

Two pure rule modules for `delivery_os`: `lib/attempts.ts` decides reserve / claim / cancel / reconcile over the
per-task attempt register, `lib/baseline.ts` builds and hashes the immutable baseline and decides whether a task may
become `ready`. They are the "system decides" half of the agent boundary: one key reserves one attempt, an unknown
run never restarts by itself, and nothing runs without an approved baseline.

## Starting Point

Schemas, error codes, hash helper, DAG and task lifecycle exist (T003–T007). No code yet decides idempotent reserve,
single claim, reconciliation, baseline hash or readiness.

## Desired End State

L4 commands call these reducers and only add I/O (row lock, persistence, events). All rules are unit-tested; the
`delivery_os` jest folder and the core typecheck are green.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Error names | spec names (`attempt_active`, `attempt_not_active`, `attempt_not_reconcilable`) | spec is authoritative | Research |
| Reserve order | idempotency → unknown → active → limit | replay stays 200 | Research / Plan |
| `baseCommit` | derived from `baseRevision` | contract invariant | Research |
| Reconcile `completed` | record only, effect `await_manifest`, state untouched | fail closed, never verified | Plan |
| Open comments | excluded, reported as `openCommentIds` | baseline = snapshot of resolutions | Plan |
| Decisions | latest per kind for this hash+version; tie → rejected | spec `:164`, fail closed | Research / Plan |
| Readiness | all reasons as details, fixed order for the body code | user fixes everything in one pass | Plan |

## Scope

**In scope:** `lib/attempts.ts`, `lib/baseline.ts`, their tests, spec changelog, progress note.

**Out of scope:** commands/routes, result acceptance, workflow link / delivery marks, attachment checks, new error codes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Attempt reducers | `attempts.ts` + tests | reducer output violating register invariants (tests re-parse every output) |
| 2. Baseline rules + docs | `baseline.ts` + tests, changelog, progress note | draft/baseline shape drift (structural type checked by the schema) |

**Prerequisites:** T003–T007 merged. **Estimated effort:** one session.

## Open Risks & Assumptions

- OSS-04 result acceptance must treat `reconciliation.resolution === 'completed'` as the unlock for a manifest import.
- `missing_render` applies to every task; requirements-only baselines cannot make tasks ready until a render exists (master plan intent).

## Success Criteria (Summary)

- Matrix tests for reserve/claim/cancel/reconcile and readiness pass; module folder and typecheck green.
