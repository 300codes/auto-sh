# OSS-03 (L7a) allowedPaths Rules and Pure Proposal Import Validation — Plan Brief

> Full plan: `context/changes/asd-oss-t019-oss-03-l7a-add-allowedpaths-rules-an/plan.md`

## What & Why

Two agent sessions produce the requirements proposal and the plan proposal (tasks, `allowedPaths`, dependencies,
AC→test map). BN-07 says these proposals are validated, not trusted. This change adds the pure rules that decide:
`lib/allowedPaths.ts` and `lib/proposals.ts`. Import commands and routes call them in the next task (L7b).

## Starting Point

The frozen zod schemas already reject malformed shapes, duplicate ids, self-dependencies, unknown `dependsOn` and
absolute or `..` paths. Nothing checks proposals against the project, the baseline or the profile. Nothing catches
multi-node cycles in a proposal, AC→test mappings to tests that don't exist, or globs such as `src/*/x`.

## Desired End State

Given a proposal and its context, the validators return one frozen error body (`{ error, code, details[] }`) listing
every problem, or the normalized data to persist: the merged draft (requirements), or the merged baseline content + hash,
the task drafts in dependency order and the frozen AC→test map (plan). Both also return a stable `manifestHash`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Path grammar | exact file or `dir/**`; any other glob rejected | One predictable rule for the agent and for result checks; nothing can match more than intended |
| Requirements merge | proposal replaces requirements/AC/questions/risks, other draft sections kept, orphan AC maps pruned and reported | The proposal is a complete document; pruning avoids a later `unknown_ac` on data the user never touched |
| Test catalogue | manifest ∪ baseline declared tests ∪ profile catalogue; conflicting definitions and test files outside roots rejected | A mapping to a test that cannot exist in the delivered repo is a false mapping |
| AC coverage | every task AC needs ≥1 required test or a baseline manual check | Stops tasks from reaching `ready` with an unprovable AC |
| Error shape | correlation and profile errors stop early; content problems are collected into one body with a fixed-priority top code | The operator fixes the proposal in one round |
| Error codes | no new codes; per-rule detail codes | Contract v1 is frozen; existing codes cover every case |
| Task cap | named constant = frozen schema value 100 | No contract tightening |
| Fixtures | new additive stage `proposal` + hash-consistent context loader | QA/UI get labelled negatives for foreign baseline, path escape, false test mapping |

## Scope

**In scope:** `lib/allowedPaths.ts`, `lib/proposals.ts`, `MAX_PLAN_PROPOSAL_TASKS`, fixture context + 3 negatives,
paired unit tests, spec changelog.

**Out of scope:** commands, routes, dedupe/replay, the approval check, rewiring manual tasks to the new path rule,
result `changedPaths` enforcement.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. allowedPaths rules | grammar + roots + `isPathAllowed` with paired tests | directory vs file root subtleties |
| 2. Proposal validation | both validators, fixtures, tests, spec | stricter-than-schema rules rejecting the positive fixture |

**Prerequisites:** OSS-02 done (contracts, dag, baseline, fixtures). **Estimated effort:** one session.

## Open Risks & Assumptions

- UI-03 proposal contract not available: OSS keeps the frozen v1 shapes (assumption A5).
- Manual tasks still use the older prefix rule until L7b rewires them.

## Success Criteria (Summary)

- A plan with a foreign baseline, a path escape or a false test mapping is rejected with a clear code and details.
- The shipped positive plan fixture validates against a real, hash-consistent baseline context.
- The lib jest suite is green and `lib/` has no ORM import.
