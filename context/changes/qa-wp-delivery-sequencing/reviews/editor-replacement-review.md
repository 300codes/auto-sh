<!-- IMPL-REVIEW-REPORT -->
# Editor replacement fixture and browser helper review

- **Date**: 2026-09-19
- **Scope**: Additive editor fixture definition v2 and the approved template-precondition correction in the browser helper.
- **Verdict**: APPROVED for the reviewed implementation; browser replacement acceptance remains `not_run`.
- **Findings**: No open implementation blockers.
- **Method**: Independent read-only code and test review; reviewer did not start WordPress, build, or execute tests.

## Verified boundaries

- New fixtures use definitionVersion 2 and create a separate `replacement` attachment, with its own slug, upload path and distinct valid PNG bytes. Both media resources retain fixture marker and actor ownership.
- Reverse cleanup deletes both attachments before the actor. Upload failure uses the same guarded orphan cleanup: attached, changed or symlinked files are retained for reconciliation.
- Version 1 journals remain readable and cleanable. Replaying them does not create a missing replacement resource or silently upgrade their definition.
- Reviewed regressions cover v1 compatibility, both PNG checksums, separate media paths, attachment cleanup, and uncertain replacement creation with retained reconciliation lock.
- Browser helper now requires explicit `expectedPageTemplateHash` in its private configuration; it no longer automatically approves existing template bytes. Null requires absence. Reads use a bounded 128 KiB buffer, O_NOFOLLOW and before/after fd metadata checks. The expected hash advances only after its own successful update.
- Root confirmed that this is an authorized persistent local update to the owned demo, not a disposable theme fixture. Evidence must distinguish `themeUpdate: retained_intentionally` from `nativeFixtureCleanup`. A rerun with the old precondition refuses the changed template. No rollback or public API change is introduced.
- Credentials remain in private configuration/journals and are not returned by subprocess stdout or errors. Browser trace/video must remain disabled for the credential-bearing login flow.

## Verification limits

Root reports **18/18 focused tests PASS** using the host runner. This is the parent's execution result, not a second reviewer run. The code review and focused tests do not prove actual browser media replacement, editor rendering, content retention, or completed Phase 3 acceptance. `browserReplace` is still `not_run` at this review checkpoint. The previous v1 safety report remains preserved separately.

## Source identity at review

- `packages/delivery-wordpress/src/editor-fixtures.ts`: `8e38ec2193f63d102f9278ef35bd88ae3596c38b2b457950f04abfa75b6635af`
- `packages/delivery-wordpress/src/__tests__/editor-fixtures.test.ts`: `f166c883e0f4a0d440d2f58a7dc8d2aef0fc1e4a4d3227e376e65230a817bff0`
- `packages/core/src/helpers/integration/wordpressBrowserFixtures.ts`: `4027a3fa0b949a318884ec15022446328ab422d44952395b6b9d49250aac5e9a`
- `packages/core/src/modules/delivery_os/__integration__/wordpress/meta.ts`: `7fac9544656cb5efd310e1bf72208ed6d25d688a9ef5d069246703f2e2d6d5ce`
