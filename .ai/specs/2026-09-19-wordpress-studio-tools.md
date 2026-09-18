# WordPress Studio tools

Status: **implemented locally; manual acceptance pending** · Created: 2026-09-19 · Owner: delivery-wordpress

## TLDR

Provide a private, standalone OM package that creates a new local WordPress Studio site, scaffolds and activates its theme, and captures real execution evidence. The package calls Studio CLI directly. The former WordPress orchestrator is neither a runtime dependency nor a source of execution reports.

## Overview

This implements the authorized independent portion of WP-M01 and the [Studio tools plan](../../context/changes/wordpress-studio-tools/plan.md). Total work, including prior analysis, reviews and validation, has a six-hour budget. This is not a promise to complete the later OM→WP integration within that budget. Readiness and live results belong in [the handoff](../../hackathon/delivery-demo/wordpress-reuse.md).

## Problem Statement

Reusing an existing orchestration server would couple the new OM workflow to its private sessions, database, queue and projects. The user instead requires OM-owned Studio capabilities and a completely new site. The delivery domain and enterprise call sites are not yet available; independent tools must remain useful and testable before those dependencies exist.

## Proposed Solution

Create `@open-mercato/delivery-wordpress`, a private workspace package with a typed tools factory and local CLI. Support create, status, start, stop and captureSnapshot for sites created by this package. Theme scaffolding, Git initialization and activation form part of create, rather than separate externally retryable mutations.

Out of scope: existing-site adoption, arbitrary WP/shell commands, AI inference, public preview, cloning, Apply/Rollback, production publication, new OM routes/entities/migrations and a second orchestration queue. Public upload requires a separate scope and target decision.

## Architecture

`createWordPressStudioTools(config, dependencies?)` receives trusted, disjoint `sitesRoot` and `stateRoot` directories and optionally an injected command runner. `tools.ts` coordinates `contracts.ts`, `ownership.ts`, `paths.ts`, `runner.ts`, `scaffold.ts` and `snapshot.ts`. The compiled CLI invokes the same public factory; it creates a site, captures a snapshot and performs a loopback HTTP smoke check.

Studio/Git run through bounded `execFile` calls without a shell. Inputs never select an executable or supply a filesystem path. The host, not the model, must derive tenant/organization/project scope. The future OSS and enterprise adapters remain responsible for authorization, mutation approval, task baseline and lifecycle. Local ownership is not a replacement for backend authentication or a delivery attempt claim.

## Data Models

No OM database schema is added. Private local state holds a versioned ownership record with strict CreateSiteRequest, requestHash, status `creating|ready`, and optional SiteResult. Site identity is SHA256 over tenant/organization/project IDs. A reservation precedes Studio create; a ready identical request can replay the result. Different effective request data conflicts. An incomplete reservation fails with reconciliation_required rather than blindly creating again. All mutations and captureSnapshot share an atomic site lock; stale locks are not automatically stolen.

SiteResult version 1 contains provenance `live|fixture`, siteId, scope, attemptId, toolExecutionId, studioSiteId, localUrl, themeSlug, themeCommit, createdAt and checks. Checks have checkId, status `passed|failed|not_run`, checkedAt and optional safe code. Fixtures must be labelled as synthetic in their wrapper/provenance and cannot certify a live outcome.

Snapshots contain SHA256 hashes of frozen allowed theme files and of SQLite backup bytes. contentHash covers the canonical versioned manifest of sorted theme file hashes plus databaseHash. It is not a logical SQL fingerprint. The backup includes committed WAL data. Raw database copies stay in private state, outside the repository; public evidence exposes hashes, not rows or absolute account paths.

## API Contracts

There are no HTTP API routes or backend UI paths in this package.

- `createSite(unknown): Promise<SiteResult>` validates a strict request: `scope` contains tenantId, organizationId and projectId UUIDs; attemptId is a UUID; idempotencyKey is 1–128 characters from `[A-Za-z0-9._:-]`; name and themeSlug are bounded validated strings. Unknown fields are rejected.
- `status(scope, { siteId })` returns siteId, studioSiteId, running and localUrl after ownership and Studio registration checks.
- `start/stop(scope, { siteId })` are idempotent state transitions for owned sites and verify the resulting state.
- `captureSnapshot(scope, { siteId })` returns version, provenance, siteId, toolExecutionId, creationAttemptId, `sourceRevision: { kind: 'snapshot', contentHash, externalWorkspaceId }`, themeFiles, databaseHash and capturedAt. It stops a running site, confirms the stop, captures private artifacts and restores the previous running state.

The CLI contract is `node dist/cli.js create --sites-root ABS --state-root ABS --request /path/request.json --output /path/report.json`. Request and report files are local operator artifacts. The CLI report must distinguish failed/not_run checks from passed checks and omit unknown internal create substeps after partial failure. HTTP readiness has one absolute 30-second budget, a 2 MiB response cap and no redirect following; Studio startup redirects may only retry the identical normalized URL. It is not the future delivery_os ResultManifest and does not grant verified or release status.

## Integration Coverage and Acceptance

All new callable paths ship with automated coverage: strict input validation; runner timeout/output/error redaction; path traversal/symlink rejection; create idempotency/concurrency/ownership/collision; scaffold and activation; status/start/stop; SQLite WAL backup and hash changes; snapshot state restoration; compiled CLI entry point and bounded HTTP smoke. Tests create their own temporary fixtures and clean them up. Fake Studio is not live evidence.

The live acceptance scenario uses the compiled package to create one new site and theme, verify activation/local HTTP, capture real hashes, and replay the same request without creating a second site. Automated tests deny all HTTP calls during tool execution; neither the former API nor database is used. No existing server is stopped merely for this test. No public preview is required. Human viewing of the new site is a separate pending check. There are no OM routes/UI requiring integration tests in this change; later delivery call sites require their own scoped end-to-end coverage.

Validation uses the package's `npm test`, `npm run typecheck` and `npm run build` with the documented local toolchain. A partial workspace install does not justify declaring the complete root gate passed.

## Risks & Impact Review

| Failure | Severity / area | Mitigation | Residual risk |
|---|---|---|---|
| Create succeeds before timeout/crash | High / external effects | Durable reservation; incomplete state requires reconciliation | Operator may need to inspect the new site; automatic rollback is absent |
| Cross-scope or symlink target | High / filesystem | Trusted scope, hashed identity, ownership and path checks | Trusted local host can still mutate files outside this API |
| Snapshot races with writes | High / evidence | Site lock, confirmed stop, backup API and frozen bytes | External filesystem writers must be excluded by the operator |
| CLI output contains credentials | High / confidentiality | Bounded subprocess output and safe error codes; no raw output in evidence | Private state and runtime access remain sensitive |
| Studio/Git unavailable or incompatible | Medium / availability | Explicit runtime, registration checks, tested tool versions | No fallback to the old runtime; report a blocker |
| Six-hour budget expires | Medium / delivery | Deliver actual state and remaining integration work | Full OM→WP PoC may remain incomplete |

## Migration & Backward Compatibility

Additive private package and documentation only. No existing API, entity, ACL, event, queue or DI contract changes. No OM migrations or module discovery files; `yarn generate` and database migration are unnecessary. Node 24 and the repository's Zod are used. Publishing the package is out of scope.

## Implementation Plan

1. Strict contracts, process execution and filesystem boundaries, with regression tests.
2. Ownership/create/lifecycle, theme scaffold and frozen snapshots, with fake-Studio coverage.
3. Compiled local caller, live trial, implementation review and documented handoff.

The detailed plan owns progress. This spec does not mark the parent PoC or any acceptance criterion complete.

## Open Questions

No blocking scope decisions remain for independent tools. Future delivery DTO mapping, authorized host wiring and enterprise lifecycle remain explicit integration dependencies, not hidden assumptions about existing code.

## Final Compliance Report

**Package verification passed; see handoff for live evidence and review.** Architecture is scoped to a private provider package with no new backend/API/schema surface. 29 native tests, typecheck/build and the final live create/replay/snapshot/HTTP scenario passed; evidence, toolchain deviations and remaining risks are recorded in the handoff. Implementation review findings were fixed. Full root validation and OM→WP end-to-end acceptance are not claimed.

## Changelog

- 2026-09-19: Added implementing specification for independent Studio tools, new-site ownership, snapshot evidence and the boundary to future delivery integration.

- 2026-09-19: Implemented and reviewed independent tools; live replay and HTTP passed. Human acceptance and domain integration remain pending.
