<!-- IMPL-REVIEW-REPORT -->
# Independent implementation review: manual WordPress roundtrip

Date: 2026-09-19. Reviewer: independent `plan_deep_review` agent.
Verdict: **APPROVED for the bounded opt-in QA implementation. Live acceptance remains not_run.**

## Scope and method

Read-only review of `packages/core/src/modules/delivery_os/__integration__/wordpress_manual/`, cross-checked against current OSS contracts, evidence validators, target profiles, integration discovery/shared runner configuration, provider site ownership and stop behavior. This reviewer ran no Studio, browser, Docker, app build or integration scenario. The review covers the manual technical slice of plan Phase 4; it does not close its live acceptance or the automated EXEC/Preview dependencies.

## Findings and resolution

| Finding | Initial impact | Final evidence | Status |
| --- | --- | --- | --- |
| Shared `wordpress/meta.ts` required the unrelated editor configuration, filtering out the manual scenario. | Intended opt-in configuration could not discover the spec. | Scenario and helpers now live in sibling `wordpress_manual`; its `meta.ts` requires only `OM_WP_MANUAL_ROUNDTRIP_CONFIG` and module `delivery_os`. Existing editor metadata is unchanged. | Fixed |
| Shared 20-second timeout and one retry were unsafe for slow native operations; cleanup did not settle active operations first. | A normal invocation could start native work with inadequate time and duplicate it on retry; cleanup could race native work. | Spec checks `testInfo.timeout >= 1800000` and `project.retries === 0` before creating API resources. Helper tracks create/capture/read/update promises, rejects new work after closing, and awaits all active operations before confirmed native stop. Anonymous browser page closes before stop; close failure remains a reported failure. README records scoped CLI options without modifying shared configuration. | Fixed |

No unresolved blocker found in the reviewed final source. Abrupt process/host termination still requires the private ledger and retained lock reconciliation; no automatic recovery claim is made.

## Contract, scope and evidence checks

- Result import retains the actual `{ attemptId, manifest }` API envelope, retrieves each authoritative TaskPackage before work, and asserts `awaiting_review`, correction and `verified` transitions. Review attribution is explicitly an agent technical harness, not a human sign-off.
- New API project scope binds the new Studio site. The provider site ID computation matches the ownership implementation. Capture receipts drive the reader, and the existing mapper validates original snapshot metadata, frozen byte hashes, workspace/correlation, changed paths and check reports.
- Checks execute real bounded processes against copied frozen theme bytes: marker presence and PHP syntax. Exact test identities, two passing test results, process exit codes and unchanged theme bytes are checked. Definitions and reports are stored as actual bytes and hashed. These checks do not establish rendering or visual design quality.
- Cleanup verifies the API-created project by exact ID, tenant, organization and random name before scoped transactional deletion. Its table set matches current delivery entities. Attachment deletion follows successful project cleanup. Audit history and the stopped physical site are explicitly retained for disposal; cleanup failures fail the scenario.
- Private configuration requires an absolute canonical file, single link, bounded size and private permissions. Configured roots must be real directories; writable site/state/evidence roots must be private. Compiled operator and check toolchains are trusted operator inputs, not an untrusted plugin interface.
- README uses repository-native discovery and execution, private output and a line reporter. Public provider exports/contracts remain unchanged; the scenario does not impersonate an executor or remote Preview host.

## Acceptance boundary

This is source-review approval only. Real OM HTTP → owned Studio capture/update → real checks → OSS result/review has **not been executed by this review**. The live scenario, environment disposal and any destination-machine full gate need separate results. Fixture/offline check results cannot be substituted for that live evidence. Approved customer design, visual/human acceptance, automated execution/recovery, FLOW completion and Preview upload are outside this technical scenario.

## Reviewed source hashes

| File | SHA-256 |
| --- | --- |
| `README.md` | `4488046aa630b2312e29dee59d5df8a2ab8f678c63095979f2662c3ff6b0d7f4` |
| `TC-DELIVERY-WP-MANUAL-001.spec.ts` | `3f6b5559b5898967e447b99ae28399162a19de4a6226eee38ad52a15e5e3d97f` |
| `frozen-lint.cjs` | `d3965fe817946acd5487b3695ee092d42105673ff9bc12ce61134f2a4f825826` |
| `frozen-smoke.cjs` | `14bd35760256565577f70ca284f01b72aad3f99bb925bea7de3d60ae959fcbb7` |
| `manualRoundtrip.ts` | `9fa737362c9fa002034f722d2ab720fc45207c0e8fbeb12abe1ea84f426340cd` |
| `meta.ts` | `b5d0f6ba7a7325535672d74cde2a687a29f95b9972929916926d810b2607667b` |
