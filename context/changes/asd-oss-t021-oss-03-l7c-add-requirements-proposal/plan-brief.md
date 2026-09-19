# OSS-03 (L7c): requirements-proposal import — Plan Brief

> Full plan: `context/changes/asd-oss-t021-oss-03-l7c-add-requirements-proposal/plan.md`
> Research: `context/changes/asd-oss-t021-oss-03-l7c-add-requirements-proposal/research.md`

## What & Why

The requirements agent turns a brief into a `RequirementsProposal v1`. This change lets that proposal enter Delivery OS
safely: it is validated, merged into the project draft and frozen as the next append-only baseline that a human then
approves ("the agent proposes, the system decides"). Retries of an unattended agent must never duplicate scope.

## Starting Point

R7 accepts only `source: 'manual'`; the proposal source passes the feature gate and then answers `unsupported_source`.
The pure validator and the baseline builder exist; nothing remembers a `manifestId`.

## Desired End State

One POST imports the proposal (201), the same POST again answers `200 duplicate: true` without any write — even with
the now-stale lock header — and a different body under the same `manifestId` answers `409 idempotency_conflict`.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| `manifestId` storage | optional `importedManifests[]` in baseline content | no table/migration, old hashes unchanged | Plan |
| Replay vs lock | replay first, under the project row lock | first import bumps `updatedAt`; spec "Replay before lock" | Research |
| Screens at import | not required; AC required | requirements precede the design in FROM_BRIEF; readiness still blocks | Plan |
| Shared pipeline | one `freezeDraft` helper for both sources | "same schema and hash algorithm" by construction | Plan |
| Response | additive `projectUpdatedAt` | agent continues without an extra GET | Plan |
| Body | 8 MB capped reader for the route | same as results route | Research |

## Scope

**In scope:** contract field, parser split, command, route dispatch, schemas/openApi, unit + route tests, spec, hand-over.

**Out of scope:** plan/design import, tasks, migrations, events, UI/i18n, integration specs (QA).

## Architecture / Approach

Route (feature by source, capped body) → command bus → one transaction: row lock → baselines → replay → lock header +
optimistic lock → `validateRequirementsProposal` → `freezeDraft` → draft copy + baseline persist last → side effects after commit.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Contract, command, unit tests | working command with all legs proven | fixture hashes must stay stable |
| 2. Route, docs, live check | R7 wired, spec + hand-over, smoke on :3100 | dev server keeps stale command modules |

**Prerequisites:** T019/T020 in the tree. **Estimated effort:** one session.

## Open Risks & Assumptions

- Other streams' strict copies of `BaselineContent v1` must allow the optional field (hand-over note).
- UI-03's proposal contract is assumed to be the frozen `RequirementsProposal v1`.

## Success Criteria (Summary)

- delivery_os jest scope green; re-import writes nothing; 403/404/409/422 legs proven at route level.
