<!-- IMPL-REVIEW-REPORT -->
# Independent W2 review — controlled theme.json application

- Date: 2026-09-19
- Scope: `theme-design-apply.ts` and adjacent tests against Phase 2 W2 and the single-lock coordinator decision.
- Verdict: APPROVED for the internal local primitive. No critical findings or warnings.

| Dimension | Verdict |
|---|---|
| Plan adherence | PASS |
| Safety/data preservation | PASS |
| Pattern consistency | PASS |
| Integration/acceptance boundary | PASS |

The standalone wrapper takes the existing operation lock; the internal WithinLock path
requires the lock directory and repeats owned-site registration/path checks. Scope and
expected theme.json byte hash are mandatory. The mapper remains strict and only version3
JSON is accepted. Reads are bounded and reject symlinks/nonregular files/malformed UTF-8.

Merge behavior matches the planned ownership boundary: unrelated top-level keys, settings
and all styles survive; only prior journal-owned presets can be replaced or removed.
A pre-existing colliding slug is never adopted implicitly, even if values match. Changed,
missing or augmented managed entries cause a conflict instead of losing user changes.
Unrelated additions since the previous run survive if the caller supplies the current hash.

Prepared journal contains the private before-image and is persisted before theme mutation.
Atomic writes recheck the expected source hash and confirm output bytes. Partial write or
final-journal failure leaves prepared state plus retained lock, so blind retry is refused.
No DB command, Studio mutation, network call, global-style reset or public contract change
is introduced. Journal content is private and does not appear in the public result.

Replay keeps theme bytes unchanged; report hashes and approvalVerification distinguish
operator declarations/fixture from actual approval. This does not accept real design,
editor visuals, browser permissions, redeploy or Preview.

Tests inspected: 18 focused PASS reported by owner; concrete cases cover custom
settings/styles/content preservation, replay, replacing/removing managed presets, changed
managed fields, same-valued collision, stale hash, foreign scope/registration, symlinks,
malformed/oversized inputs, required lock and partial final-journal failure. Review is
read-only; root owns the combined package gate and source freeze.

A transient TypeScript test callback annotation issue seen while the file was being
written was corrected before this review; final callback parameters use fs.rename types.
No unresolved implementation blocker remains.

## Independent coordinator / builder plan-adherence addendum

Read `prepare-theme.ts`, `prepare-theme.test.ts` and the narrow `theme-build.ts` split.
The coordinator acquires one operation.lock and invokes the three validated WithinLock
work paths; standalone builder still owns its own lock. Scope/registration checks remain
at both entry and locked work boundaries. Private execution journal records the stage,
expected inputs and reconciliation status. Timeout after apply/enqueue is covered by a
regression that calls the actual snapshot entrypoint and observes lock refusal; retry
also refuses instead of starting again. Successful flow verifies compiled CSS bytes,
preserves theme styles/DB fixture and is replayed through the real compiler.

Plan adherence: PASS. No public exports, v1 create semantics or frozen snapshot meaning
changed. Report still says browserFrontend/browserEditor not_run; it cannot be used as
actual rendered frontend/editor acceptance. Three focused integration tests were reported
passed by root; root owns combined final checks and the separate safety review. This
review does not approve any public upload, real design decision or shared merge.
