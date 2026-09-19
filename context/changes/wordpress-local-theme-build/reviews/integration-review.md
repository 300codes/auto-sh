<!-- IMPL-REVIEW-REPORT -->
# WP-01 local builder — independent integration review

Date: 2026-09-19. Scope: initial local builder and tests, before final author validation. Verdict: NEEDS ATTENTION for the concrete corrections below; no public-contract or architecture blocker identified.

## Findings

### F1 — Decoded source hashes do not cover malformed original bytes

Severity: WARNING. Dimension: Success Criteria. Location: `theme-build.ts`, `collectSources` and report source hashes.

The collector decodes buffers using `toString('utf8')`, then hashes the resulting strings. Malformed bytes are replaced, so different source byte sequences can collapse to the same reported hash. The plan promises exact source-byte binding.

Fix: reject invalid UTF-8 before compiling (fatal decoding) and add a negative regression, or explicitly preserve raw-byte hashes alongside compilation text. Decision: sent to owner; pending correction.

### F2 — Mapper fixture violates its actual input contract

Severity: WARNING. Dimension: Success Criteria. Location: `theme-build.test.ts`, validated fixture design test.

The test supplies empty fonts, fontSizes and spacing arrays while the real mapper requires each category to contain at least one item. It will stop before exercising compilation.

Fix: use a valid complete bounded fixture and assert generated preset-variable utility behavior. Decision: sent to owner; pending correction.

### F3 — Toolchain root documentation differs from implementation

Severity: OBSERVATION. Dimension: Pattern Consistency. Location: plan Toolchain and integration.

The documented path ends in `node_modules`, while `inspectToolchain` appends that segment. Document the checkout root as `toolchainRoot`. Decision: sent to owner.

## Reviewed boundaries

Existing ownership/status checks precede compiler work and are repeated under the site lock. Frozen PHP/HTML/JS are scanned as data; theme config/scripts are not executed. The real child compiler is bounded, resolves only the trusted operator toolchain, and disallows theme-directed module/stylesheet loading. Existing lock retention and atomic generated-output replacement match package safety patterns. Existing public exports/createSite v1/dependencies are unchanged.

The generated CSS filename is included by the existing snapshot rules; `design-tokens.css` would not be. Provenance remains fixture when the owner/runner/design is fixture. Approval remains not evaluated. Preflight is omitted rather than applied blindly to core blocks/editor.

This bounded primitive intentionally does not enqueue CSS, apply theme.json fragments or prove browser/editor compatibility. Those are explicit remaining WP-01/WP-02 gates; real compilation alone must not be presented as complete theme implementation or Preview readiness.

Toolchain `entryHash` values cover the named entry files, not their complete transitive imports/native binary dependency graph. Treat them as entry-file diagnostics plus version pins, not a hermetic toolchain attestation.

No tests or live operations executed by this reviewer. Author validation and corrected-source review remain pending.

## Final correction review — 2026-09-19

Verdict: **APPROVED for the bounded local builder**, with F1–F3 closed. Re-read the final source and regressions:

- F1: fatal UTF-8 decoding rejects malformed bytes before lock/compiler work; `ignoreBOM: true` preserves an actual UTF-8 BOM in the decoded string. The fixture contains a BOM and compares the reported source hash to the original buffer hash. The malformed-byte regression verifies rejection before lock/output mutation.
- F2: the design fixture now includes all four required categories and exercises the real mapper/compiler callsite.
- F3: the plan documents the checkout-root convention and the separate private glibc-compatible Tailwind/oxide 4.3.3 installation used for validation. No production dependency change was introduced.

Author reports 11 focused tests and 93 package tests passing, plus typecheck/build, with a final gate being consolidated by the parent. This reviewer verified the final file hashes and clean `git diff --check`; it did not rerun the live site or package tests. Enqueue, editor/browser, approved design and Preview gates remain outside the primitive and explicitly pending.

Reviewed SHA-256:

- `theme-build.ts`: `f9c133a0aaca95a173108ebc10f7ca942ae5317e3e6b215cdfa45c5da9ae0bf2`
- `theme-build.test.ts`: `c53eaf35a077dd3b9194f06008573505dd0a4bc486499a6bfc114e1d92ec5f06`
