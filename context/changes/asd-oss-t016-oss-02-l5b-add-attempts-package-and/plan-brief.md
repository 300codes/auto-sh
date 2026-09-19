# OSS-02 (L5b): attempts, package, results routes + DI query service — Plan Brief

> Full plan: `context/changes/asd-oss-t016-oss-02-l5b-add-attempts-package-and/plan.md`
> Research: `context/changes/asd-oss-t016-oss-02-l5b-add-attempts-package-and/research.md`

## What & Why

Add routes R14–R16 and the DI service `deliveryOsAttemptQueries`. They complete the manual flow "reserve → export
package → import result" that gate H10 needs, and give the enterprise executor a read-only door into OSS.

## Starting Point

Commands for reservation and result acceptance, the pure package builder, route plumbing and a route test kit exist.
There is no HTTP surface for them and no `di.ts`.

## Desired End State

Three routes answer per the frozen spec; GET package never writes; the DI service shares the GET route's loader.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Missing key / `automatic` status | 400 (catalogue), not 422 | Frozen, test-pinned catalogue | Research |
| R16 status | 201 new / 200 replay | Spec UA-12, T014 notes | Research |
| Loader location | `commands/attemptQueries.ts`, reused by `results.accept` | `lib/` stays pure; one loader | Plan |
| Service failures | throw the same `CrudHttpError`; `[internal]` Error for missing scope | One validation path | Plan |
| Pending deliveries | scoped tasks, registers filtered in memory, limit ≤ 100 | JSONB register, tiny volumes | Plan |
| Size limit | Content-Length precheck + schema → 413 `payload_too_large` | Catalogue code | Plan |

## Scope

**In scope:** `di.ts`, query service, three routes, schemas, tests, `yarn generate`, live run, spec changelog + hand-over.

**Out of scope:** claim/cancel/reconcile/mark_delivery (OSS-04), evidence routes, UI, i18n, integration specs.

## Phases at a Glance

| Phase | Delivers | Key risk |
|---|---|---|
| 1. Service, DI, routes, tests | Code + jest + typecheck | Test kit EM needs spies without breaking T015 tests |
| 2. Live verification + docs | Transcript, cleanup, hand-over | Dev server must pick up the new routes/DI (restart if needed) |

**Prerequisites:** T013–T015 landed. **Estimated effort:** one session.

## Open Risks & Assumptions

- `taskUpdatedAt` from the ORM hook is verified live only.
- OSS-only never sets `workflowRef`, so `listPendingDeliveries` is empty live; covered by unit test.

## Success Criteria (Summary)

- Jest suite and typecheck green.
- Live: 201→200 on one key, GET package writes nothing, result import then duplicate with one evidence row.
