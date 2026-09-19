# OSS-05 (L9c): deploy decision and route R20 — Plan Brief

> Full plan: `context/changes/asd-oss-t033-add-the-deploy-publish-consent-decis/plan.md`

## What & Why

Publish consent (UA-16) is a human decision, but the system decides whether it may be given: an `approved`
deploy decision is accepted only if the R22 report says the active baseline is publishable on that revision.

## Starting Point

`delivery_os.decisions.record` handles requirements/design; deploy is refused. The report query, the frozen
`deployDecisionSchema`, error codes, ACL feature and the `source_revision` column all exist.

## Desired End State

`POST /api/delivery_os/projects/:id/deploy-decisions` answers 201 on a green report, `422 report_not_green`
listing blockers otherwise; the next report shows the decision `appliesToRevision` for that revision only.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Where | New `deploy` branch in the existing command | one atomic, lock-bound decision path (already decided) |
| Gate source | DI `deliveryOsReportQueries` (same as R22) | UI report and gate can never disagree |
| Blocker details | `{ path: kind:id, code: status, message }` | frozen error-detail schema has no kind/id/status fields |
| `sourceRevision: null` | 400 validation_failed (schema frozen, required) | consent must name a revision; a revision without results → report_not_green |
| Non-active baseline | 422 baseline_not_active for both verdicts | consent is only about the approved active scope |
| Reject | never gate-checked, reason required | spec: reject always allowed |
| Tests | real report query over the in-memory store | proves gate == report |

## Scope

**In:** command branch, route R20 + OpenAPI, response schema, tests, spec changelog, hand-over.
**Out:** release (R21), migrations, UI, events, new error codes.

## Phases at a Glance

| Phase | Deliverable | Key risk |
| --- | --- | --- |
| 1 | Command + route + tests + docs | report read outside the tx sees only committed evidence (accepted) |

## Success Criteria (Summary)

- delivery_os jest suite green; live 422 / 201 / appliesToRevision true/false on :3100.
