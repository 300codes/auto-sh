# TC-DELIVERY-OSS-001 — Plan Brief

> Full plan: `context/changes/asd-oss-t050-oss-06-add-a-self-contained-api-inte/plan.md`

## What & Why

A Playwright API spec that runs the frozen v1 manual flow against the real app and Postgres, because every existing
delivery_os route test uses an in-memory store and SQL behaviour (scoping, unique indexes, locks, JSONB) was unproven at runtime.

## Starting Point

56 jest suites over an in-memory store; live smokes only as out-of-repo scripts; no `delivery_os/__integration__/`.

## Desired End State

One spec, four independent tests, green twice on :3100, zero rows left behind, and demonstrably red when a scope filter is removed.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Runner | `npx playwright test --config .ai/qa/tests/playwright.config.ts` with `BASE_URL=http://localhost:3100` | Task mandates the real local stack; ephemeral would start a second app on a 16 GB machine |
| Cleanup | SQL hard-delete by project id via `withClient`; API deletes for attachments/users/roles | v1 tables are append-only with no delete route |
| Foreign scope | Both a second org (same tenant) and a second tenant | Covers both scope columns of the filter |
| Claimed attempt | SQL flip of the attempt register entry | Claim is trusted-only, no HTTP route |
| Unique index | Sequential replay + two parallel identical freezes | Only parallelism reaches the constraint path |

## Phases at a Glance

| Phase | Delivers | Key risk |
|---|---|---|
| 1. Spec | Spec green twice, cleanup, mutation proof | Payload drift / real defects |
| 2. Regression + hand-over | jest + typecheck, evidence recorded | none |

## Open Risks & Assumptions

- Superadmin can create a user in a DB-created tenant; if not, fall back to an org-only foreign user and document it.
- Dev server `watch-packages` rebuild picks up the mutation within a minute.
