# OSS-04 (L8f): review evidence and the verified gate — Plan Brief

> Full plan: `context/changes/asd-oss-t029-oss-04-l8f-add-review-evidence-with/plan.md`
> Research: `context/changes/asd-oss-t029-oss-04-l8f-add-review-evidence-with/research.md`

## What & Why

The evidence endpoint (R19) learns the kind `review`. A review is the only exit from `awaiting_review`: it opens a
correction round, escalates to a human after the round limit, or verifies the task — and verification happens only
when the system can prove every AC on the accepted result revision. This closes the correction loop of the demo
("the agent proposes, the system decides") and gives OSS-05 its proof helper.

## Starting Point

Lifecycle gates, the correction counter, the review schema and the response fields already exist and are tested. The
command refuses reviews with a stub and nothing computes which AC are unproven.

## Desired End State

`POST /projects/:id/evidence` with a review moves the task under row locks and answers `taskStatus` /
`taskUpdatedAt`. `lib/acProof.ts` answers `passed | failed | not_run | missing` per AC with the deciding evidence ids.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Test identity | `testId` from the frozen `acTestMap`; `check.acIds` is only a claim | The model may not add mappings | Plan |
| Conflicting runs on one revision | `failed` sticky, `passed` beats `not_run` | F3; a fix is a new revision | Plan |
| Proof rows | pinned baseline + latest accepted result revision; task rows and project-level rows | "other revision does not count" | Plan |
| Manual check review | human only, stores the verdict, never moves the task, not a correction round | matches `countCorrectionRounds` | Research |
| Agent `approved` | may verify — the proof is the gate; never approves a manual check, never publishes | least human involvement, safety intact | Plan |
| `human` reviewer | needs a signed-in user, else 403 | an in-process agent cannot pose as a human | Plan |
| Failed approval | nothing stored, 422 | acceptance criterion | Plan |
| Limit | `changesRequestedOutcome`: third round → `blocked / correction_limit_reached`, dependants blocked | existing helper | Research |
| Locks | project → project tasks, reviews only | same order as `tasks.update` / reconcile | Research |

## Scope

**In scope:** `lib/acProof.ts` + tests; review path in `commands/evidence.ts`; route response + OpenAPI text; unit
and route tests; spec changelog; hand-over.

**Out of scope:** migrations, new codes / events / ACL, report API, UI / i18n, integration specs, enterprise.

## Architecture / Approach

Read everything under locks, decide purely (`acProof` → `canTransition`), then insert the row and move the task and
its dependants; emit `evidence.recorded` and `task.updated` after commit.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure AC proof helper | `lib/acProof.ts` with F3 unit tests | rule ambiguity (decided in D1–D4) |
| 2. Review dispatch | command, route, tests, docs, live check | read-after-mutate in one EntityManager — reads first |

**Prerequisites:** L8e (T028) merged — yes.
**Estimated effort:** one session.

## Open Risks & Assumptions

- `reviewer.kind` is client-declared; only the `human` claim is checked (signed-in user).
- UI strict response copies must allow `taskStatus` / `taskUpdatedAt` (already optional in the frozen schema).

## Success Criteria (Summary)

- All acceptance cases of T029 are jest tests and pass.
- A live run on localhost ends with a `verified` task only after passed tests on the result revision.
