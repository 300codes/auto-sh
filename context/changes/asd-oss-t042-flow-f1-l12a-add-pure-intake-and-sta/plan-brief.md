# FLOW-F1 L12a — Pure Intake and Stage-Artifact Rules — Plan Brief

> Full plan: `context/changes/asd-oss-t042-flow-f1-l12a-add-pure-intake-and-sta/plan.md`

## What & Why

The brief wizard (save/resume, agent scoping proposals) and versioned stage artifacts need deterministic server-side
rules before the F1 commands exist, so "the agent proposes, the system decides" is enforced in one testable place.

## Starting Point

F0 schemas, `flowRules.ts` (currency, gate, frozen profile) and the T041 entities exist; no intake/artifact rules yet.

## Desired End State

Two pure modules returning published flow codes, covered by fixture-driven unit tests.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Step moves | back any, forward by one | wizard resume without skipping the platform choice |
| Question merge | existing id wins | agent re-ask never erases a human answer |
| Content hash | stage, content, dependsOn, attachments | rebinding upstream = new version; source is provenance |
| Check order | replay → shape → foreign → approval → currency → profile → AC | replay never blocked; most actionable error first |
| unknown_ac | caller-supplied AC refs vs resolved scope | no AC refs in F0 design content; seam for L13 |

## Scope

**In:** `lib/intakeRules.ts`, `lib/stageArtifacts.ts`, two test suites. **Out:** commands, routes, attachments,
attempt checks, decision/status rules.

## Phases at a Glance

| Phase | Delivers | Risk |
|---|---|---|
| 1. Intake rules | transitions, submit, frozen profile, update, proposal merge | step policy vs future UI |
| 2. Artifact rules | version, hash, dependency checks, stale downstream | order of codes |

**Estimated effort:** ~1 session.

## Open Risks & Assumptions

- The UI wizard (Adam) must not skip steps forward by more than one; documented in the hand-over notes.
