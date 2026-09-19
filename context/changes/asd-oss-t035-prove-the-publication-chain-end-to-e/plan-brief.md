# OSS-05 (H26) publication chain proof — Plan Brief

> Full plan: `context/changes/asd-oss-t035-prove-the-publication-chain-end-to-e/plan.md`

## What & Why

Prove, through the real HTTP handlers, that the publication chain a user walks (report → deploy consent → deployment
→ verification → release) holds end-to-end, that a new revision voids old consent, and that a manual check blocks
release until a human verifies it. Hand the result to UI-05 and QA-05.

## Starting Point

R20/R21/R22 exist with slice-level tests on seeded rows (L9a–L9d); no test creates the data via the routes.

## Desired End State

A green `publicationFlow.test.ts`, a live smoke log from :3100, and `OSS-05-H26.md` with DTOs, errors and curl recipes.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Test level | Route handlers over routeTestKit store | Covers the HTTP contract UI-05 consumes |
| Revision B | Second attempt after agent `changes_requested` | Real correction loop, not a seeded row |
| Verification | Second deployment row with verification | Matches the stored model (append-only evidence) |
| Live smoke | tsx + fetch, cleans up the project | Evidence against Postgres without touching demo data |

## Scope

**In scope:** flow test, live smoke, hand-over, changelog. **Out of scope:** domain/contract/UI changes, master plan.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Flow test | publicationFlow.test.ts | kit store semantics (ordering by decidedAt) |
| 2. Smoke + hand-over | live log, OSS-05-H26.md | dev server compile time |

## Open Risks & Assumptions

- Deployment evidence is fixture-shaped; no real preview target.

## Success Criteria (Summary)

- Scoped jest green; live smoke codes recorded; hand-over present; master plan untouched.
