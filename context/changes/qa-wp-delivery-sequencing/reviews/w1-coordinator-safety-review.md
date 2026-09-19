# W1 and coordinator independent safety review

2026-09-19. Verdict: **PASS**, no unresolved blocker for this bounded local preparation operation. Reviewer authored W2, not W1/coordinator; W2 itself is covered by separate independent review.

Reviewed source SHA-256:

- theme-assets.ts: `a01cd27f2e6873baf7fa982d7dfb0433caa808b9c38da14c07c7b8c009a780f2`
- prepare-theme.ts: `e9480d651a3a102a648352f1a9c3d1d1234a57fc901664f193f31622bb766d48`
- theme-build.ts lock-held refactor: `1d044e0bd11c61b3b92084bb1ce0287da4737c889a8faca3bbfee2d371b319ab`
- theme-assets.test.ts: `d7c12af4d61f24af8ed4369cd8c0ff30f11a72df8f3c6454c787e84ec52d0d6b`
- prepare-theme.test.ts: `4cdc91bbe160e8006cee229859d692fed8bf9097b2cdfc8e04d0d17339594a0c`

The coordinator owns one operation.lock across preconditions, design apply, asset installation, compilation and final verification. Lock-held primitives revalidate ownership/registration and require the lock directory; standalone wrappers acquire it separately. They are internal trusted callsites, not an authentication or external API capability. Failure retains the lock and reconciliation journal, which prevents the existing captureSnapshot operation from accepting a partial preparation. The real snapshot-entrypoint negative test covers this boundary.

W1 touches only functions.php and its owned inc/assets.php, with expected byte hashes, no silent adoption of existing assets, before-image journal, atomic writes and conflict checks. It preserves inc/setup.php and DB. The generated PHP uses native enqueue_block_assets and a runtime CSS SHA-256 version, avoiding CDN and arbitrary execution supplied by input. Browser rendering remains explicitly unverified; PHP fixture checks do not establish actual editor iframe compatibility.

Findings closed during the loop:

1. Appending the include could place it after an early return or inside a comment. The include now has a fixed position immediately after the PHP opening line; replay requires that exact prefix and one occurrence. Unsupported namespace/declare constructs fail before mutation instead of receiving an unsafe generic rewrite. Regressions cover early return and commented-out include.
2. Unchanged replay now rechecks both final file hashes before PASS.
3. Base64 before-images could exceed the old 512 KiB journal read cap even for accepted source input. A separate 1 MiB journal bound and source/output bounds now permit replay of the tested 400 KiB source.
4. Coordinator final verification now compares theme.json, functions.php, assets.php and compiled CSS against their returned hashes, rather than checking CSS alone.
5. Coordinator journal temporary files are cleaned in finally, and errors from the whole callable operation are mapped to safe codes, including failures preceding the inner mutation block.

Owner-reported gates: W1 17 focused tests and package typecheck PASS; coordinator integration tests include real compilation, replay, stale preconditions and partial failure denying snapshot. This reviewer inspected code/tests and correction deltas without duplicating a concurrent compiler or mutating the live site. Full browser acceptance, approved design and publication remain separate gates.
