# FLOW-F0 contract delta — Plan Brief

> Full plan: `context/changes/asd-oss-t040-flow-f0-publish-the-versioned-contra/plan.md`
> Research: `context/changes/asd-oss-t040-flow-f0-publish-the-versioned-contra/research.md`

## What & Why

The product addendum moved the demo to Brief → Scope → UX → Key Visual → DS/UI → WordPress → QA → publish with
separate client approvals, Figma comments landing in the native staff Kanban, and a versioned process template.
Three owners are blocked on the domain contract. This task publishes that contract (schemas, fixtures, spec,
hand-over) additively on top of frozen v1 — without implementing it.

## Starting Point

delivery_os v1 is complete and frozen: five tables, R1–R22, decisions `requirements|design|deploy|release`,
fixtures and tests. Staff and workflows expose public command ids and DI resolvers the delta may reference by id.

## Desired End State

`lib/contracts.ts` exports the flow schemas under `DELIVERY_FLOW_CONTRACT_VERSION = 1`; `lib/fixtures/flow/`
parses positively and fails negatively in jest; the spec has a "Flow delta v1 (FLOW-F0)" section; the hand-over
tells Adam, Marcin and Michał what to call, with what, and what is still missing.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Draft storage | separate `delivery_intakes` table | separate lock + encryption | Plan |
| Platform in Scope | confirm-only; `422 target_profile_frozen` | frozen profile, no hidden edit | Addendum |
| Stage decisions | new table + enum + feature; legacy `design` untouched | frozen enum, no folded consents | Addendum |
| Gate applicability | only pinned projects | FLOW-08 regression | Plan |
| Currency | derived (`approved/stale/pending/rejected/missing`) | history never deleted | Addendum |
| Comment import | per-thread transaction, unique external keys, batch idempotency key | retry / parallel safety | Plan |
| Report | separate `flow` section schema | v1 report untouched | Plan |
| Publication | new `PublicationResult v1` + route recording deployment evidence | R19 untouched | Plan |

## Scope

**In scope:** schemas, error codes, fixtures, tests, spec section, hand-over, estimate, blockers.
**Out of scope:** routes, commands, entities, migrations, ACL/event registration, UI, providers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Contracts + fixtures + tests | executable delta | touching v1 by accident |
| 2. Spec section | authoritative contract text | drift from schema names |
| 3. Hand-over | one page for the three owners | missing an operation they need |

**Prerequisites:** none. **Estimated effort:** one session; F1–F4 domain implementation ≈ 26 h (reported in hand-over).

## Open Risks & Assumptions

- Figma comment read access unverified (Adam's probe) — payload marks `figmaVersion` optional.
- Marcin's template registry seam — OSS ships a built-in default template snapshot so OSS-only works.
- Publication target unknown (Michał) — `PublicationResult v1` carries target/verification; fixture never counts as live.

## Success Criteria (Summary)

- New suites and v1 suites pass with `--maxWorkers=2`; core typecheck passes.
- Spec + hand-over cover every operation of `01-mateusz-domain.md` step 1.
- `git diff` shows v1 fixtures/tests untouched.
