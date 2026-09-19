---
date: 2026-09-19T08:20:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 47ca5acbf
branch: dev-mateusz
repository: open-mercato
topic: "How result acceptance runs its pending checks and what must change to make them real (T025, OSS-04 L8b)"
tags: [research, codebase, delivery_os, result-acceptance, allowed-paths, attachments]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: real result acceptance checks (T025, OSS-04 L8b)

## Research Question

How does `lib/resultAcceptance.ts` run its three stub checks, what data do `results.accept`, `isPathAllowed`,
the attachment verifier, the frozen test maps and the ResultManifest contract provide, and which tests and
fixtures must change to implement the real rules in the frozen order
scope → schema → idempotency → correlation → allowedPaths → checks and hashes?

## Summary

- `evaluateResultAcceptance` is a pure, synchronous function. Order today: schema → canonical hash → attempt exists →
  **idempotency** → attempt gate → package failure → profile → revision kind → correlation → loop over
  `RESULT_ACCEPTANCE_PENDING_CHECKS` (three `() => ({ ok: true })` stubs). The replay already wins over everything
  that follows, so real checks placed in that loop keep the "duplicate beats a now-invalid path list" rule for free.
- Attachment verification is asynchronous (scoped `findWithDecryption(Attachment)` + DI inspector reading stored bytes).
  It cannot live in the pure function. It has to run in the command, after the pure evaluation answers `accept`,
  inside the same transaction. That is still "checks and hashes last".
- The task package does not carry `declaredTests`; it carries `validationProfile.requiredTests` (the frozen `acTestMap`
  filtered to the task's ACs) and `validationProfile.checks` (profile check definitions). `declaredTests` lives in the
  baseline content that `buildTaskPackageV1` already parses, so it can be returned next to the package additively.
- The manifest schema already rejects a check whose `sourceRevision` differs from `resultRevision`
  (`422 revision_mismatch`, schema stage) and a runner status `skipped` (`400 validation_failed`, fixture
  `result-manifest.status-skipped`). No helper maps a runner status to `not_run` yet.
- Published fixtures already satisfy the planned rules: changed paths are under `src/**`, test checks use mapped test
  ids, non-test checks use `testId === checkId` of the profile definition, the single artifact has no `attachmentId`.
  Route tests use tasks with `allowedPaths: []` and manifests with `changedPaths: []`, so they stay green.

## Detailed Findings

### Acceptance pipeline

- `lib/resultAcceptance.ts:80-90` — three stubs and the list; `:140-143` — the loop; context is
  `{ manifest, task: { id, allowedPaths }, taskPackage }`.
- `lib/resultAcceptance.ts:114-124` — idempotency: equal `payloadHash` → `duplicate`, other hash → `409 result_conflict`.
- `commands/evidence.ts:114-170` — one transaction: lock task, load project, register, package
  (`loadTaskPackage(..., { attemptGate: 'none' })`), existing evidence, evaluate, then write. `task` passed to the
  evaluation is the locked DB row, so `task.allowedPaths` is the current value. Evidence is written with
  `attachmentIds: []`.
- Only `lib/__tests__/resultAcceptance.test.ts:215-219` references `RESULT_ACCEPTANCE_PENDING_CHECKS`
  (asserts three pass-through seams with `allowedPaths: []`). No reference in `packages/enterprise` or `hackathon/`.

### Path rule

- `lib/allowedPaths.ts:130` `isPathAllowed(changedPath, allowedPaths)` — exact file or directory `/**` prefix,
  rejects bad shapes and globs; `isPathAllowed('src/App.tsx', [])` is `false`.
- `changedPaths` entries already pass `repoRelativePathSchema` at the schema stage, so `../` never reaches the rule.
  A "path escape" negative fixture therefore uses well-formed paths outside the task scope (`package.json`,
  `.github/workflows/deploy.yml`).

### Checks rule inputs

- `lib/contracts.ts:373-385` `resultCheckSchema`: `checkId, testId, acIds[], commandProfileId,
  validationProfileVersion, testDefinitionHash, status (passed|failed|not_run), exitCode, durationMs, sourceRevision,
  rawReportHash`.
- `lib/taskPackage.ts:133-155` — `requiredTests` = baseline `acTestMap` filtered to task ACs; `validationProfile.version`
  = profile version; `checks` = profile check definitions (`checkId, commandProfileId, kind, required`).
- `lib/targetProfiles.ts` — `testCatalogue` per profile (react-vite has one entry).
- `lib/fixtures/builders.ts:29-81` — the fake executor: one check per mapped test (`commandProfileId` of the `test`
  definition, `acIds` from the map) and one per non-test definition with `testId = checkId = definition.checkId`.
- T028/R19 (test evidence) is planned to reuse "the same check-mapping helper built in L8b", so the helper must be
  exported and independent of the manifest wrapper.

### Attachment verification

- `commands/attachments.ts:75-123` `verifyDraftAttachments` — scoped lookup, per-file record check, DI inspector
  (`deliveryOsAttachmentInspector`), byte facts, priority `attachment_scope_mismatch > missing_render >
  attachment_hash_mismatch`, total bytes `413`. It returns early (no DI resolve) when nothing is referenced.
- `lib/designReview.ts:35-40,255-336` — `AttachmentReference { path, role, attachmentId, declared }`, role
  `attachment` uses the MIME allow-list (images, pdf, text, markdown, json) and 10 MiB per file.
- `resultArtifactSchema` = `{ path, sha256, attachmentId?, sizeBytes? }`. Only artifacts with `attachmentId` can be
  verified against stored bytes.
- Test harness: `api/__tests__/routeTestKit.ts:159` registers the inspector and an `attachments` store;
  `commands/__tests__/results.test.ts:177-207` does not (container throws for unknown keys) — it needs an
  `attachments` store and the inspector from `baselineTestKit.ts:209 makeAttachmentInspector`.

### Limits and codes

- Schema caps (400 at schema stage): `changedPaths` 2000, `artifacts` 200, `checks` 1000. Route: body 8 000 000 bytes,
  manifest 2 000 000 chars → `413`. Lib precedent for a domain `413`: `checkTotalAttachmentBytes`.
- Existing codes to use: `path_not_allowed`, `unknown_ac`, `unknown_test_id`, `correlation_mismatch`,
  `attachment_hash_mismatch`, `foreign_reference`, `payload_too_large`. The set is frozen; detail codes are additive.

### Fixtures and their tests

- `lib/fixtures/index.ts:139` `negativeFixtureStages = schema | profile | correlation | dag | idempotency | proposal`;
  `:156-173` name → JSON map. `lib/__tests__/fixtures.test.ts:202` fails when a JSON file is not registered; `:207`
  pins required `stage:code` classes; `:104-124` `runLabelledStage` throws on an unknown stage; `:257` positive twins.
- Spec `.ai/specs/2026-09-18-delivery-os-hackathon.md:195` lists the stages; `:306` UA-12 order; changelog entries are
  prepended at `:419`.

## Code References

- `packages/core/src/modules/delivery_os/lib/resultAcceptance.ts:72-145`
- `packages/core/src/modules/delivery_os/commands/evidence.ts:102-186`
- `packages/core/src/modules/delivery_os/commands/attachments.ts:75-123`
- `packages/core/src/modules/delivery_os/lib/allowedPaths.ts:130-137`
- `packages/core/src/modules/delivery_os/lib/taskPackage.ts:96-165`
- `packages/core/src/modules/delivery_os/lib/fixtures/index.ts:139-182`
- `packages/core/src/modules/delivery_os/lib/__tests__/fixtures.test.ts:104-124,202-260`

## Architecture Insights

- Pure rules in `lib/`, I/O in `commands/`; every failure is a `DeliveryCheckResult` built with `buildDeliveryError`.
- One command serves `manual` and `adapter`; the source only gates who may call it.
- Negative fixtures state the result of their labelled stage in isolation and must have a positive twin.

## Historical Context (from prior changes)

- `context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md:224-227` — the three seams were left for OSS-04.
- `context/changes/delivery-os-oss-domain/handover/OSS-02-H4-contracts.md:85-89,147-148` — labelled stage semantics;
  matching of `changedPaths` against `allowedPaths` deferred to this task.
- `.ai/specs/2026-09-18-delivery-os-hackathon.md:424` — L7b attachment verification contract being reused.

## Open Questions

- None blocking. The EXEC adapter does not exist yet, so the check rules are aligned with the fake executor in
  `lib/fixtures/builders.ts` and handed over as a contract note.
