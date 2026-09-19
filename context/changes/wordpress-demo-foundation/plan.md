# WordPress demo foundation — F0 execution plan

## Overview

Implement a reproducible, scoped operator probe around existing independent Studio
tools. Current package creates new owned sites and snapshots but has no plugin or
editor checks. User supplied ACF Pro and selected Polylang Free, deferring translations.
The next concrete deliverable is plugin/readiness evidence for a fresh site, without
claiming Tailwind, approved design, client approval, OM integration or public preview.
Budget on entry: 87/360 min consumed; record actual work plus conservative rounding.

## Design and contract boundary

Existing createSite/status/start/stop/captureSnapshot and public exports remain unchanged.
New internal `demo-plugins.ts` and local `demo-probe.ts` operator caller accept trusted
configuration (roots and pinned archive paths/hashes/versions), never model-supplied
shell or plugin IDs. Allowed plugin slugs are exactly advanced-custom-fields-pro,
polylang, wordpress-seo. All plugin mutations use the existing owned site's operation
lock; ownership record, scope, hashed handle and Studio inventory must agree before
any WP command. Same version already active is a no-op; mismatch stops rather than
updating/reinstalling. Missing plugin installs from verified local archive then activates;
no `--force`, deletion or setting reset. Failed mutation retains lock for reconciliation.
Preflight validates all archives before the first side effect. Raw CLI output, secrets,
archive content and paths do not enter public evidence. ZIPs remain ignored.

The trusted local caller creates a fresh site using v1, configures plugins, records
WP/PHP/plugin versions and noindex, repeats configuration and verifies preserved test
content/settings, captures snapshot and local HTTP. Native CLI checks do not impersonate
editor-browser acceptance. Any native edit probe creates only its own fixture post and
cleans it in finally, recording cleanup separately. Stop only this owned site at end.
Do not modify any prior demonstration site or old orchestrator. No public upload.

## Phase 1: Scoped plugin preparation

### Changes Required
- `packages/delivery-wordpress/src/demo-plugins.ts`: internal, bounded plugin provisioning
  with ownership/path/hash/version/lock checks and safe results.
- `packages/delivery-wordpress/src/__tests__/demo-plugins.test.ts`: fake Studio covers
  first install/replay, foreign scope, wrong registration, archive tampering, version
  mismatch, symlinks and ambiguous failure/retry.
- Extend existing WP spec/README with this operator-only boundary.

### Success Criteria
- Tests prove no mutation on preflight rejection, one install per missing pinned plugin,
  no reset on replay, retained lock after uncertain mutation, no secret output.
- Package tests, typecheck and build pass with recorded local toolchain.

## Phase 2: Operator caller and live readiness

### Changes Required
- `packages/delivery-wordpress/src/demo-probe.ts` and targeted tests: strict trusted
  request/config, new-site create through existing tools, plugin configuration/replay,
  native edit probe if supported, HTTP/snapshot and owned-site stop in finally.
- `context/changes/wordpress-demo-foundation/evidence/` sanitized fixture/live manifests.
- Update acceptance/index with partial WP-03 readiness and remaining editor/design checks.

### Success Criteria
- Fake runner tests verify caller cleanup/reporting and no calls to old orchestrator.
- Real new site reports actual WP/PHP/plugin versions, active plugins, noindex, replay,
  content persistence and hashes; unsupported checks remain not_run with cause.
- Own running site is stopped; no unrelated services started/stopped.

## Phase 3: Review loop and handoff

### Changes Required
- Two independent reviews: plan adherence and safety/patterns, saved to reviews/.
- Fix concrete findings and rerun affected checks; record budget and remaining blockers.

### Success Criteria
- No unresolved implementation blockers; evidence matches final source manifests.
- WP-01/02 design/Tailwind, browser editor WP-04, redeploy WP-05, OM→WP→OM and Studio
  Preview publication are not accidentally claimed by plugin/native CLI checks.

## Testing Strategy

Runner local unless a configured compose app is running. Native node:test fixtures use
fake Studio and temp directories; live external commands are a separate operator run.
`npm test`, `npm run typecheck`, `npm run build` in packages/delivery-wordpress, plus
compiled caller smoke and `git diff --check`. Do not start full OM/Docker for this package.
Record actual dependency versions; full monorepo gate remains separate.

## Migration & Backward Compatibility

No exports, existing CLI command semantics, entity/schema/API, generators or dependencies
changed. New internal modules and separate operator entrypoint are additive. Local
configuration is not a public API and cannot be accepted from untrusted model output.

## Progress

### Phase 1: Scoped plugin preparation
- [x] 1.1 Scoped provisioning and meaningful negative tests implemented.
- [x] 1.2 Package tests, typecheck and build pass.
### Phase 2: Operator caller and live readiness
- [x] 2.1 Caller and fixture reporting/cleanup tests pass.
- [x] 2.2 Live readiness completed or measured blockers documented, owned site stopped.
### Phase 3: Review loop and handoff
- [x] 3.1 Independent reviews completed and findings fixed/retested.
- [x] 3.2 Evidence, acceptance and budget updated without claiming downstream completion.
