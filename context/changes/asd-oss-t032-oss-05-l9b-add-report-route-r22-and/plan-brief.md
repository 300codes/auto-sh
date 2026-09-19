# OSS-05 (L9b): report route R22 — Plan Brief

> Full plan: `context/changes/asd-oss-t032-oss-05-l9b-add-report-route-r22-and/plan.md`

## What & Why

The delivery lead needs one answer: "is each AC proven on this baseline, revision and profile?" The pure builder
exists (T031); this task exposes it as `GET /projects/:id/report` and as a DI query service reused by R20/R21 and EXEC.

## Starting Point

`buildDeliveryReport` + `DeliveryReport v1` schema/fixture; read-route and DI query-service patterns in the module.

## Desired End State

A read-only, tenant/org-scoped report endpoint answering the v1 DTO, with 404 for foreign scope/baseline, 422
`invalid_revision` for a bad or wrong-kind revision, and a `limit`/`truncated` bound.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Revision syntax | `git:<sha>` / `snapshot:<sha256>:<workspaceId>` | URL-friendly, maps 1:1 to `SourceRevision` |
| Bad revision | always `422 invalid_revision` | spec table lists only 404/422 |
| Profile | project's pinned profile | what the project is delivered against |
| No active baseline | `404 no_active_baseline` | nothing to report on; never a fake green |
| Stored baseline altered | `422 hash_mismatch` | never report on tampered scope |
| Tasks | archived included | history of what delivered an AC |
| DI | new `deliveryOsReportQueries` | additive; attempt queries unchanged |

## Scope

**In:** validator, loader, DI key, route + openApi, route/parser tests, spec changelog, hand-over.
**Out:** R20/R21, UI, integration specs, migrations, ACL/events.

## Phases at a Glance

| Phase | Delivers | Key risk |
|---|---|---|
| 1. Query, route, tests | R22 live + tests | test harness must not count reads as writes |

**Estimated effort:** one session.

## Open Risks & Assumptions

- Report loads all evidence rows of one baseline in one query; fine for demo scale.

## Success Criteria (Summary)

- delivery_os jest green; live GET parses with `deliveryReportV1Schema`; foreign org → 404; no writes on GET.
