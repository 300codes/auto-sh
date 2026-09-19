<!-- IMPL-REVIEW-REPORT -->
# Browser editor integration review

- **Date**: 2026-09-19
- **Scope**: WordPress browser fixture helper, opt-in metadata, and TC-DELIVERY-WP-EDITOR-001.
- **Verdict**: APPROVED for current code; runtime acceptance pending, including explicit source-version boundary below.
- **Findings**: 0 open code blockers; checkpoint lifecycle warning fixed. Live Success Criteria not yet established by this review.
- **Method**: Independent read-only review. No WordPress process, browser, tests, or build started by reviewer. Author owns the one active live run.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS for browser test implementation |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PENDING — await actual native runner result and cleanup evidence |

## Closed review findings

1. **Explicit template approval and bounded read.** Private configuration requires expectedPageTemplateHash, including null for an absent file. The helper compares the current template bytes before calling the guarded operator and advances the expected hash only following its own successful update. The template read is limited to 128 KiB through an O_NOFOLLOW file descriptor, checks regular-file type and before/after size and timestamps. It does not silently adopt a changed template on rerun. Root explicitly authorized a persistent local demo update; its status is retained_intentionally, separately from native fixture cleanup.
2. **Scoped CLI execution policy.** Before creating any fixture, the spec requires effective timeout >= 900000 ms and zero retries. The agreed command uses --timeout=900000 --retries=0. This addresses the repository defaults without adding per-test timeout overrides forbidden by the integration-test skill. Running under the defaults fails before mutation rather than beginning a partial run.
3. **Cleanup lifecycle.** The helper tracks active operator promises; settle closes further mutation admission and awaits active operations. afterEach closes the browser context before native cleanup, then settles operators. If context closure fails and pages remain, cleanup is not run and its reason is attached. A close failure with zero pages still makes the test fail after cleanup, rather than concealing the error. The underlying operation lock continues to prevent unsafe cleanup after an uncertain subprocess failure; there is no automatic lock stealing.
4. **Direct login.** Authentication redirects to the exact owned page editor, avoiding a dashboard visit and its unrelated Quick Draft creation. This does not weaken the actor cleanup refusal for untracked posts. Trace/video remain off for the credential-bearing flow.
5. **Canonical policy.** The spec now asserts canonical is null for the observed local Yoast noindex policy, rather than accepting any collected value. The author grounded this expectation in live observation and the installed Yoast noindex guard. Sitemap child URLs must share the owned origin; child response status and fixture presence are checked separately. The report explicitly avoids treating noindex as sitemap privacy.

## Evidence checks in the test

- A dedicated fixture actor performs browser mutations; plugin and user admin pages must reject it with HTTP 403.
- Replacement media is selected from the owned marker-specific attachment and reflected in saved content; visible frontend image loading is awaited. Native fields, ACF, SEO, header/footer/navigation, Global Styles and section changes are read back.
- Two actual local theme updates require different file and CSS hashes. The complete selected native state before/after the second update must be equal. This is distinct from a replay of plugin installation.
- Computed padding is checked inside the editor iframe and on the frontend. SEO output, noindex, canonical policy and sitemap responses have assertions. Desktop/mobile screenshots support later human visual review; they do not establish approved design equivalence.
- The retention attachment says nativeFixtureCleanup is pending_afterEach. A separate cleanup attachment records the actual outcome. Runner pass/fail must be evaluated together with both attachments; an earlier retention attachment alone cannot establish complete acceptance.
- Private configuration and fixture journals are not attached. Operator errors omit raw subprocess output. The metadata gate requires OM_WP_EDITOR_CONFIG and exposes no public API or production integration dependency.

## Runtime boundary

The author's fresh native test was in progress when this report was written. Its result, source identity and cleanup remain to be recorded. No live PASS is inferred from code review, previous exploratory observations, or package unit tests. Real design approval, full monorepo gate, snapshot correlation and Preview remain separate gates. Root will update Success Criteria from the completed native runner evidence.

## Source identity at review

- `packages/core/src/helpers/integration/wordpressBrowserFixtures.ts`: `b509257f777d8b2e52b0777d6272fc67500a2dcb87c99d80b65663d4245cd87c`
- `packages/core/src/modules/delivery_os/__integration__/wordpress/meta.ts`: `7fac9544656cb5efd310e1bf72208ed6d25d688a9ef5d069246703f2e2d6d5ce`
- `packages/core/src/modules/delivery_os/__integration__/wordpress/TC-DELIVERY-WP-EDITOR-001.spec.ts`: `c88fdf9f3a1fe6ce81ff5319565159f8f539c8e0ea9a04fbb5bae3417597ca4c`

## Interrupted run 1 and narrow follow-up review

`evidence/browser-editor-run-1.json` records an interrupted run at the image block pointer target intercepted by its toolbar, with browserClosed true and nativeFixtureCleanup cleaned. This is not a browser acceptance PASS. The revised test focuses the observed image block, then requires Replace to be visible and enabled before clicking; it does not force a click or weaken its outcome assertions. The first-build attachment adds early build evidence. Checkpoint output contains only phase and observedAt, uses the test output directory, and requests mode 0600.

### F1 — Diagnostic checkpoint failure can skip native cleanup

- **Severity**: WARNING
- **Impact**: LOW — narrow ordering correction
- **Dimension**: Safety & Quality
- **Location**: spec afterEach, checkpoint(native_cleanup) before fixture.cleanup()
- **Detail**: If checkpoint mkdir/writeFile fails, control jumps to the outer finally and clears fixture without calling native cleanup. Diagnostic output must not prevent cleanup of the actual owned WP resources.
- **Fix**: Make checkpoint recording best-effort with deferred error reporting, or guarantee fixture.cleanup() through an independent try/finally. Continue to fail/report diagnostic errors after cleanup; do not suppress the test outcome.
- **Decision**: FIXED — focused re-review confirms both checkpoint writes catch and record failure; native cleanup executes regardless of diagnostic write failure. The cleanup attachment includes cleanupDiagnosticFailed, and the hook throws after cleanup when the flag is set. The test cannot report PASS after this diagnostic failure. Root reports narrow TypeScript check PASS; reviewer ran no runtime.

### Run 2 source-version boundary

Run 2 loaded the spec before the checkpoint cleanup correction. Its preserved source hash must remain attached to its own execution result. The current source hash below identifies the reviewed correction; it is **not** represented as executed by run 2. This delta changes diagnostic/cleanup failure handling only, and does not change browser actions or acceptance assertions. Current-code review plus narrow TypeScript PASS do not substitute for claiming a full run of that source version.
