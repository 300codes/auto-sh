# Local theme update independent safety review

2026-09-19. **PASS for the bounded internal file-update operation**, after the fixes below. Reviewer did not author theme-update.ts and did not run another compiler or mutate a live site.

Reviewed source hash: `9aac27ba579b3e7870f4dace9df903c0c51ade1751670e062b9b4460fc2b837f`.
Reviewed test hash: `0022af40905e08b64db68d384ffd013a4357c4f7bcec39f17fe08230a70737bb`.

The operation permits a bounded list of specific template/part HTML and assets CSS/JS paths, rejects duplicate paths, traversal/control characters and unsupported encodings, and checks expected hashes before writing and again at each mutation. Missing files use exclusive creation. Ownership/Studio registration and the single site lock cover mutation, compilation and verification. Database, theme.json, PHP source and unrelated files are outside its mutation scope.

An update ID binds the complete request; repeated IDs with different input conflict. Successful replay rechecks managed file hashes and compiled CSS. A new no-op does not masquerade as a redeploy. The private prepared journal includes bounded before-images; incomplete writes or compiler failure retain reconciliation state and the lock, preventing snapshot/blind retry. No whole database rollback occurs.

Review findings fixed and covered:

1. A rebuild without the previously applied design input could silently drop generated design utilities, while different input could diverge from theme.json. Existing design journals now require applied status, matching site/theme identity, exact mapper input/artifact hashes and current theme.json hash. Missing/different/prepared design inputs fail before source writes. Supplied design without a matching journal is also rejected.
2. Per-file limits now apply to UTF-8 bytes, not merely JavaScript character counts, so an accepted output does not exceed the next update's read bound.
3. Actual final CSS bytes are re-read and matched to the compiler result before the journal is marked applied; injected post-build mutation fails closed.
4. Managed paths explicitly reject control characters, including the trailing-newline regex edge.

Cross-operation correction: W2 refreshes its journal's afterHash when a safe replay preserves unrelated client changes. Otherwise a successfully re-prepared theme could still fail the new update design binding against an obsolete journal hash. That change has its own focused regression and independent W2 review.

The author reports 16 focused tests PASS with real compilation; this reviewer inspected tests/deltas and ran diff whitespace validation. `retention: not_verified` and `browser: not_run` remain correct: a file update/compiler test and untouched DB surrogate do not establish live ACF/SEO/Global Styles persistence or editor acceptance. Approval of a design or publication is not granted by this internal helper.
