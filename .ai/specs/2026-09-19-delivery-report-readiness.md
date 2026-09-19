# Delivery report — evidence, flow gates and release candidate

## TLDR / Overview

Backend and report integration implemented. The user explicitly extended UI-06 to implement the missing
D1–D3 backend dependencies and connect them to the report. This supersedes the earlier
UI-only ownership restriction for these dependencies. It does not authorize a live
deployment or application of database migrations.

## Problem Statement

The report exposes evidence identifiers without a source reader, evaluates v1 gates
without the pinned project's stage approvals, and defaults to the newest task result.
A later task result must not silently become the integration revision a human approves.

## Proposed Solution

1. D1: scoped, paginated evidence reads, a safe detail projection, and authorized bytes
   through the attachments service. Baseline evidence without a revision is a separate
   group; it is never labelled proof of the selected build.
2. D2: extend the report response additively with explicit legacy/flow mode and the
   existing stage projection. Check the same current stage state on the server at
   deploy/release and deployment evidence recording. Keep v1 gates distinct.
3. D3: persist explicit immutable release-candidate nominations. Each nomination binds
   the active baseline/hash, sourceRevision and integration evidence. Reports use the
   current nomination; new task results do not replace it. Nomination is an authenticated
   API operation for the delivery lead/QA, not an arbitrary revision selector in the UI.
4. The UI opens evidence sources and uses separate deploy/release forms. Fresh reads,
   project optimistic locking and a server decision-context fingerprint detect changes
   in evidence, candidate and stages even when the project timestamp did not change.

## Architecture / Data Models

All delivery data remain tenant/organization/project scoped. A new candidate table is
append-only, with per-project nomination versions and evidence identifiers. No ORM
relationship crosses module boundaries. Mutations go through commands and mutation guards;
the project lock serializes nominations and decisions. Task locks serialize accepted
results while deciding on the report. Attachment bytes use the module's public service.

Client islands stay within the existing report server route. Shared CrudForm, DataTable,
apiCall, guarded mutations, conflict handling, semantic DS tokens and five locales apply.
No new client page root, global SDK or production dependency is planned.

## API Contracts

Additive endpoints under `/api/delivery_os/projects/:id`:

| Operation | Endpoint | Permission |
|---|---|---|
| List sources | `GET /evidence` | `delivery_os.projects.view` |
| Read source | `GET /evidence/:evidenceId` | `delivery_os.projects.view` |
| Read bound file | `GET /evidence/:evidenceId/attachments/:attachmentId` | `delivery_os.projects.view` plus scoped attachment access |
| Read explicit candidate | `GET /release-candidate` | `delivery_os.projects.view` |
| Nominate candidate | `POST /release-candidate` | `delivery_os.deploy.approve`, project optimistic lock |

Existing report/deploy/release endpoints remain. Exact versioned schemas live in
`lib/evidenceReadContracts.ts` and `lib/reportContracts.ts`; the legacy report parser
remains exported. The new client fails closed if an old server supplies no trustworthy
mode/candidate extension. History and archived projects remain read-only in the client.

Reads are bounded; file content is never reconstructed from a hash. Missing/foreign
records answer 404 without existence leakage. Detail projection strips unknown fields,
actors/PII and server storage paths; unsafe HTML never renders inline. Mutation conflicts
answer 409, incomplete evidence/gates 422 and missing lock 428. Ambiguous POST outcomes
trigger history/version reconciliation, never automatic append-only retry.

## Migration & Backward Compatibility

The candidate table and nullable decision candidate ID/version/context hash columns are additive; migrations and the module snapshot ship without applying
them locally. Existing v1 values, URLs, signatures, decision meanings and import paths
remain. Legacy clients without a nomination retain legacy behavior. Pinned-flow projects
and explicit nominations enforce current candidate and flow constraints; these new
subjects cannot bypass the gate by calling the legacy decision endpoint.

The report's v1 gate does not certify full FLOW-01…09/WP-01…05. Those requirements remain
subject to actual QA profiles and live evidence; the frontend never invents full PASS.

## Integration Coverage

New tests cover scoped evidence list/detail/files, missing and foreign references,
revisionless screenshots, bounded pagination, explicit legacy/flow, stale stages,
candidate B surviving later task C, git/snapshot, evidence changes without updatedAt,
optimistic lock and separate deploy/verify/release. Client tests cover scope changes,
late responses, separate/wildcard ACL, conflicts, invalid responses and uncertain POST.
Executable API integration coverage uses its own projects/attachments/evidence and cleanup.
It is not proof of external Figma/WP publication.

## Risks & Impact Review

| Severity | Failure | Mitigation / residual risk |
|---|---|---|
| High | Read another tenant's file | Project/evidence membership and scope checked again on byte read |
| High | Approve stale evidence with unchanged project timestamp | Server context fingerprint under locks; fresh UI preflight |
| High | Task C displaces integration B | Explicit versioned nomination independent of newest-result selection |
| High | Bypass stage approvals through v1 endpoint | Shared server gates on decision and deployment recording |
| High | Retry uncertain POST duplicates decision | Read history and require explicit reconciliation before another submission |
| Medium | Missing migration in local runtime | Do not apply without authorization; report runtime verification limits |
| Medium | Old profile confused with full WP compliance | Separate labelled profile/stage state; no full FLOW/WP PASS claim |

## Final Compliance Report

Implemented D1–D3 and UI integration. New Jest suites and new-file TypeScript checks pass; see the [handoff](../../context/changes/autonomous-software-delivery/workstreams/ui-06/handoff.md) for exact counts and limitations. Generation completes with an OpenAPI static-fallback warning under Node 26. The optional attachment service `describeScoped` method is additive; custom providers must implement it to enable evidence byte reads. The user's validation restriction remains in force:
only directly new tests or TypeScript limited to new entry files were run. Registries were generated
after discovery changes. Broad tests/build/lint and live acceptance remain not_run unless
separately authorized; no manual criterion is checked by code delivery alone.

## Changelog

- 2026-09-19 — Implemented the user-authorized D1–D3 backend and report integration expansion.
