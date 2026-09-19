# OSS-04 (L8b) hand-over — real result acceptance rules

Task T025 · DTO/contract version: **v1, unchanged** · no migration, no generated file, no workspace change, no new
route / event / ACL feature / DI key / error code. New **detail** codes and one new negative-fixture stage (additive).

## What works

`delivery_os.results.accept` (R16 `POST /api/delivery_os/tasks/:id/results` with `source: manual`, and the in-process
`source: adapter` call) now decides with real rules. Order:

scope → schema → **idempotency** → attempt gate → package / profile / revision kind → correlation →
**size limits → changed paths → checks → stored artifacts** → one transaction.

The identical replay returns before every new rule: `duplicate: true` also after the task's `allowedPaths` were
narrowed, and a replay never reads storage. Every rejection persists nothing (no evidence row, task untouched, no event).

| Rule | Answer | `details[]` |
|---|---|---|
| > 500 `changedPaths`, > 500 `checks`, > 50 `artifacts` | `413 payload_too_large` | `too_many_changed_paths` / `too_many_checks` / `too_many_artifacts` |
| declared `artifacts[].sizeBytes` > 10 MiB, or > 64 MiB in total | `413 payload_too_large` | `artifact_too_large` (`artifacts.<i>.sizeBytes`) / `artifacts_total_too_large` |
| `changedPaths[i]` outside the task's `allowedPaths` (exact file or `dir/**`) | `422 path_not_allowed` | one per path: `changedPaths.<i>` / `outside_allowed_paths` |
| `checks[i].acIds[j]` is not an AC of this task on the pinned baseline | `422 unknown_ac` | `checks.<i>.acIds.<j>` / `unknown_ac` |
| test check with a `testId` outside `requiredTests` ∪ baseline `declaredTests` ∪ profile `testCatalogue` | `422 unknown_test_id` | `checks.<i>.testId` / `unknown_test_id` |
| check lists an AC whose frozen `requiredTests[acId]` does not contain its `testId` | `422 unknown_test_id` | `checks.<i>.acIds.<j>` / `test_not_mapped_to_ac` |
| `commandProfileId` is not a check of the validation profile | `422 unknown_test_id` | `checks.<i>.commandProfileId` / `unknown_command_profile` |
| non-test check whose `testId` differs from the profile `checkId` | `422 unknown_test_id` | `checks.<i>.testId` / `check_id_mismatch` |
| `validationProfileVersion` differs from the package | `422 correlation_mismatch` | `checks.<i>.validationProfileVersion` / `validation_profile_version_mismatch` |
| check `sourceRevision` differs from `resultRevision` | `422 revision_mismatch` at the schema stage (unchanged); the helper alone answers `422 correlation_mismatch` / `source_revision_mismatch` | |
| stored artifact files above 64 MiB together (checked on stored sizes, before any read) | `413 payload_too_large` | `artifacts` / `artifacts_total_too_large` |
| artifact `attachmentId` missing or from another tenant / organization | `422 foreign_reference` | `artifacts.<i>.attachmentId` / `attachment_scope_mismatch` |
| stored bytes differ from the declared `sha256` / `sizeBytes`, unreadable, wrong type | `422 attachment_hash_mismatch` | `sha256_mismatch`, `size_mismatch`, `attachment_unreadable`, `unsupported_mime_type`, `content_type_mismatch`, `empty_attachment`, `attachment_too_large` |

Several failing checks are listed in one body; the top code is `unknown_ac` > `unknown_test_id` > `correlation_mismatch`.
Verified artifact ids are stored in `DeliveryEvidence.attachmentIds`. An artifact without `attachmentId` keeps only its
declared sha256 (nothing to verify against). `artifacts[].path` is not a changed path. A task that cannot move to
`awaiting_review` answers `409 invalid_transition` before any stored file is read.

New exports: `lib/resultChecks.ts` (`checkReportedChecks`, `mapRunnerStatus`), `lib/resultAcceptance.ts`
(`RESULT_ACCEPTANCE_CHECKS` — renamed from `RESULT_ACCEPTANCE_PENDING_CHECKS`, `checkResultSizeLimits`,
`checkChangedPathsAllowed`, `checkResultChecks`, `collectArtifactReferences`, `MAX_RESULT_*`),
`commands/attachments.ts` (`verifyAttachmentReferences`, `verifyResultArtifacts`). `buildTaskPackageV1` returns
`declaredTestIds` next to `taskPackage`.

Fixtures: negative stage `acceptance`; `result-manifest.path-escape` (`path_not_allowed`),
`result-manifest.unknown-test` (`unknown_test_id`), both `correlatesWith: 'task-package'`.

## Test evidence

`yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 38 suites, 973 tests passed
(`manualFlow.route.test.ts` included). Scoped `tsc` over the touched production and test files: no new errors.

## Patch requests

**EXEC (adapter / Cezar bridge)**

1. Report as `checks[]` only tests that are declared (package `validationProfile.requiredTests`, baseline
   `declaredTests`, profile `testCatalogue`). A test the agent wrote but nobody declared goes to `findings[]`, otherwise
   the whole result is refused with `unknown_test_id`. The raw report hash still covers the full run.
2. `acIds` of a check: only ACs of this task, and only those the frozen map links to that `testId`. Tests of other tasks
   are fine with `acIds: []`.
3. Test checks use the `commandProfileId` of the profile's `test` check; every other check uses
   `testId === checkId` of its profile check (exactly what `buildResultManifest` does).
4. Map runner statuses with the semantics of `mapRunnerStatus`: only `passed` and `failed` survive, everything else is `not_run`.
5. `changedPaths` must come from the real diff (`git diff --name-only base..result`); a lockfile or CI change outside
   `allowedPaths` refuses the result — that is intended. Do not filter the list to make it pass.
6. Upload artifacts first (attachments API), then send `attachmentId` + `sha256` (+ `sizeBytes`); allowed stored types:
   png, jpeg, webp, pdf, text, markdown, json; ≤ 10 MiB each.

**UI** — show `details[]` of `path_not_allowed` as a list of paths; new detail codes above need no i18n key unless
they are rendered as text.

**QA** — TC-DELIVERY-006 candidates: path outside scope → 422 and task stays `executing`; replay after narrowing
`allowedPaths` → 200 duplicate; artifact with wrong sha → 422; artifact of another organization → 422 `foreign_reference`.

## Limitations

- Artifacts without `attachmentId` are not byte-verified.
- The rules follow the fake-executor convention because the EXEC adapter does not exist yet (assumption A6).
