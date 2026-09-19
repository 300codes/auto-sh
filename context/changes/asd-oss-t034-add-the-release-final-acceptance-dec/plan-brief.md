# OSS-05 (L9d): release decision and route R21 — Plan Brief

> Full plan: `context/changes/asd-oss-t034-add-the-release-final-acceptance-dec/plan.md`

## What & Why

Final acceptance (UA-17) is the last human decision of the delivery flow and must be separate from publish consent.
The system only lets a human approve a release when one revision is agreed on by the deploy consent, a verified
deployment and a releasable report.

## Starting Point

R20 (deploy decision) and R22 (report) exist; `release` is refused with `unsupported_evidence_kind`. Schema, error codes
and ACL feature for release are already frozen.

## Desired End State

`POST /projects/:id/release-decisions` records an append-only `release` decision bound to one deployment evidence row;
approve is refused with `deployment_unverified`, `revision_mismatch`, `deploy_decision_missing` or `report_not_green`.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Verified rule | `deriveDeploymentVerificationStatus` (payload.verification) | Same rule as the report — no disagreement |
| Missing / foreign evidence | 404 not_found; wrong kind 422 unsupported_evidence_kind; other baseline 422 baseline_not_active | Hides other scopes, consistent with R20 |
| Deploy consent | latest deploy decision per baseline hash on the evidence revision; approved elsewhere → revision_mismatch | Matches task codes; latest wins |
| Check order | unverified → consent → report gate, after project lock | Most specific code first; lock keeps report truthful |
| api/openapi.ts | not edited; route exports `openApi` | Same as every delivery_os route (T033) |

## Scope

**In scope:** command path, route R21, response schema, unit + route tests, spec changelog, hand-over.
**Out of scope:** migrations, UI/i18n, integration tests, publication side effects.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Command + route | Release decision end to end with tests | Report gate vs explicit checks drift |

**Estimated effort:** one session.

## Open Risks & Assumptions

- A newer failed deployment on the same revision makes the report non-releasable even if the named row is verified
  (`report_not_green`, blocker `deployment`) — accepted, it is truthful.
