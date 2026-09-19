---
date: 2026-09-19T06:40:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 6a2447c2a
branch: dev-mateusz
repository: open-mercato
topic: "How to add delivery_os.baselines.import_requirements and wire it on R7"
tags: [research, codebase, delivery_os, baselines, proposals]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: requirements-proposal import on the baselines route

**Date**: 2026-09-19T06:40:00+02:00 · **Git Commit**: 6a2447c2a · **Branch**: dev-mateusz · **Repository**: open-mercato

## Research Question

How should `delivery_os.baselines.import_requirements` be added to `commands/baselines.ts` and wired on R7
(`source: 'requirements_proposal'`), reusing the manual path, the pure validator, the per-source feature check,
the capped body reader and the existing test kits?

## Summary

Everything the import needs already exists except three things: (1) the command itself, (2) a place to remember
the `manifestId` of an import (the frozen contract only stores `importedManifestHashes[]`, so "same `manifestId`,
different hash → 409" cannot be answered today), and (3) the route dispatch (R7 always calls
`delivery_os.baselines.create`, which answers `400 unsupported_source`). No migration is needed: `source`
already allows `requirements_proposal` and the unique `(project_id, content_hash)` index exists.

## Detailed Findings

### Manual command (the path to share)
- `commands/baselines.ts:103-194` — `delivery_os.baselines.create`: scope → input → `requireLockHeader` →
  `requireScopedProject` (404) → `em.transactional` { `lockProjectForWrite(..., { force: true })` (PESSIMISTIC_WRITE +
  optimistic lock even when `OM_OPTIMISTIC_LOCK=off`) → `checkRawScreenRenders` → `draftSpecV1Schema` →
  `checkDraftFreezable` → `checkDesignReview` → `verifyDraftAttachments` → `buildBaselineContent(applyAttachmentSnapshot())`
  → all baselines of the project → identical hash ⇒ duplicate → `tx.create` + `tx.persist` as the LAST statement }.
  A unique violation is recovered with `isUniqueViolation` + `findProjectBaselineByHash`.
- `commands/__tests__/baselines.test.ts` pins "no query after the row is persisted" — the import must keep all reads
  before the first mutation (core AGENTS rule on find-between-mutation-and-flush).
- `commands/index.ts` already imports `./baselines`, so a second `registerCommand` in that file is registered.

### Validator
- `lib/proposals.ts:158-195` — `validateRequirementsProposal(manifest, { projectId, draftSpec })`: `parseVersioned`
  (unknown version → `422 unsupported_schema_version`), foreign `projectId` → `422 foreign_reference`/`foreign_project`,
  replaces requirements/AC/questions/risks, prunes `acTestMap`/`manualChecks`, returns `manifestId`, `manifestHash`
  (`hashCanonical` of the parsed manifest) and the merged `draftSpec`.
- `lib/baseline.ts:106` — `buildBaselineContent(draft, { importedManifestHashes })` is the shared builder;
  `baselineContentV1Schema` (`lib/contracts.ts:478`) requires ≥1 AC and is a non-strict `z.object`.

### Idempotency
- Spec R-table preamble (`.ai/specs/2026-09-18-delivery-os-hackathon.md:260`): "Replay before lock … R7/R10 proposals by
  `manifestId` + hash … identical replay returns `200 duplicate: true` even when the lock header is stale or missing";
  row UA-06 (line 300): `409 idempotency_conflict` (same `manifestId`, different hash). `idempotency_conflict: 409`
  exists in the frozen catalogue.
- The first import copies the merged draft into the project, which bumps `updatedAt` — so a retry of the same request
  always carries a stale header. Replay detection therefore has to run before the optimistic-lock check.
- Nothing stores `manifestId` today (`grep manifestId` → only the two proposal schemas).

### Route
- `api/projects/[id]/baselines/route.ts:30-87` — `FEATURE_BY_SOURCE` + `requireDeliveryFeatures` already gate
  `requirements_proposal` behind `delivery_os.results.import`; body read with the uncapped `readRouteBody`.
- `api/routeSupport.ts` — `readCappedRouteBody(request, maxBytes)` (413 `payload_too_large`), used by the results route
  with 8 000 000 bytes; `manifestBodySchema` additionally caps the manifest at 2 000 000 chars.

### Test kits
- `commands/__tests__/baselineTestKit.ts` — in-memory store + EM mock (`persist` pushes baselines), `makeProject`,
  `makeDraft`, `draftAttachmentRows`, `makeAttachmentInspector`.
- `api/__tests__/routeTestKit.ts` — `routeState.writes`, `EM_WRITE_METHODS`, `signInAs({ features })`,
  `EMPLOYEE_FEATURES` contains `results.import`; `baselines.route.test.ts` has one test that pins the old
  `unsupported_source` answer and must be replaced.
- `loadRequirementsProposalFixture()` has `projectId 1111…`; tests override it with the kit's `PROJECT_ID`.

## Architecture Insights
- Requirements arrive before the design in FROM_BRIEF (master plan phase 3: the design agent works from accepted
  requirements), so an imported baseline may legitimately have no screens; readiness (`collectReadinessReasons`)
  still blocks `ready` with `missing_render`. All design/attachment checks are no-ops for zero screens.
- `manifestId` has to live inside baseline content (no sixth table, no migration): an optional additive field keeps
  every existing hash and fixture unchanged because manual baselines never carry it.

## Historical Context
- T019 notes: replay lookup must precede validation for plans; requirements import builds with
  `buildBaselineContent(result.draftSpec, { importedManifestHashes })` and copies `draftSpec` in the same transaction.
- T020: `verifyDraftAttachments` / `applyAttachmentSnapshot` are ready for import commands; contract v1 is additive-only.

## Open Questions
- None blocking. Whether a later manual baseline should carry forward import provenance is left to L7d.
