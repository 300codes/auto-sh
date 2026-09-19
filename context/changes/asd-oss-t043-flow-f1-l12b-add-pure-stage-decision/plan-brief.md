# FLOW-F1 L12b — Pure Stage-Decision and Flow-Status Rules — Plan Brief

> Full plan: `context/changes/asd-oss-t043-flow-f1-l12b-add-pure-stage-decision/plan.md`

## What & Why

Stage approvals are the human gate of the delivery flow ("the agent proposes, the system decides"). The rules that
decide whether an approval counts (right approver, current artifact, upstream approved, client consent, no open
feedback) and the read model that tells everyone where a project stands must live in one pure, tested place before
the F8 command and F6 route exist.

## Starting Point

F0 contracts, `flowRules.ts` (currency, gate), `stageArtifacts.ts` (T042) and the T041 entities exist; no decision
rules and no status assembly yet.

## Desired End State

`lib/stageDecisions.ts` plans a decision row or refuses with a published code; `lib/flowStatus.ts` assembles
`FlowStatus v1` and the report `flow` section from in-memory rows, reproducing the F0 fixture.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Replay | canonical hash of parsed request per Idempotency-Key | same key+hash duplicate, other hash 409, new key = new row |
| Check order | approver → replay → identity → stale → hash → verdict checks | most actionable error first; auth never leaks |
| Rejections | always recordable once bound | saying "no" needs no upstream/thread checks |
| Blocking threads | open + un-triaged, bound to artifact or unbound on stage | fail closed; deferral is the explicit human path |
| Deferrals | hash-bound records only for open threads | a new version clears them, unknown keys 422 |
| Dispatch gate | flow gate AND no active/unknown attempt | unknown process must be reconciled first |
| Legacy nextAction | `none` (pin_template only when an intake exists) | never nudge v1 projects into the flow |

## Scope

**In:** `lib/stageDecisions.ts`, `lib/flowStatus.ts`, two test suites. **Out:** commands, routes, DI, header parsing,
lock, comment import/triage rules, schema/fixture changes.

## Phases at a Glance

| Phase | Delivers | Risk |
|---|---|---|
| 1. Decision rules | approver, replay, subject binding, upstream, client approval, threads, deferrals | check order vs L13 expectations |
| 2. Flow status | FlowStatus v1, blockers/gates, pendingApprovals, nextAction, report section | fixture equality on ordering |

**Estimated effort:** ~1 session.

## Open Risks & Assumptions

- The L13 command must pass the caller's effective features (with wildcard grants) into `planStageDecision`.
- Thread rows come from the F2 entity (L12c); the decision rule consumes a minimal record type until then.
