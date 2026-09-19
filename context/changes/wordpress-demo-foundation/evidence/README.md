# F0 evidence — 2026-09-19

This folder contains sanitized reports for the bounded **local** WordPress operator,
not full demo acceptance or a Preview deployment. The private archives, local DB,
operator config, credentials, runtime paths and transient transport URLs are excluded.

| Evidence | Result / interpretation |
|---|---|
| [package-gate.json](package-gate.json) | Local Node24: 65/65 tests, typecheck and build PASS; exact source hashes and toolchain deviation recorded. Full monorepo gate not run. |
| [plugin-packages.json](plugin-packages.json) | User-supplied ACF Pro 6.8.9; official Polylang Free 3.8.9 and Yoast SEO 28.5, archive SHA-256. License activation not verified. |
| [live-first-blocked.json](live-first-blocked.json) | Initial host-path transport failed: sandbox PHP cannot read private host archives. Reconciliation lock correctly blocked stop. |
| [live-first-reconciliation.json](live-first-reconciliation.json) | Operator confirmed owner, absent target plugins/unchanged setting and stopped exact site before releasing only its empty failed-operation lock. |
| [live-loopback-blocked.json](live-loopback-blocked.json) | WordPress safe-URL policy rejected initial loopback transport. No successful install claimed. |
| [live-loopback-reconciliation.json](live-loopback-reconciliation.json) | Same scoped reconciliation, target plugins absent, site confirmed stopped. |
| [live-readiness.json](live-readiness.json) | Corrected exact-URL transport: all seven stages PASS on one owned site. WP7.1.1/PHP8.4.23, all three plugins active, replay unchanged, noindex, native content/meta readback, owned draft cleanup, snapshot, HTTP200, owned site stopped. |

The first two failed attempts remain visible; the third is the successful implementation
verification, not a hidden test retry or an aggregate PASS over failed checks. The final
plugin transport is restricted to the exact internally minted loopback URL/host/port,
with redirects disabled and listener closed in finally. No remote install/build occurred.

Native post metadata is **not ACF field/editor coverage**. Plugin activation and noindex
are partial WP-03 readiness, not all plugin/SEO settings. WP-01 Tailwind integration,
WP-02 approved design fidelity, WP-04 browser editing/ACF/SEO, WP-05 real redeploy,
OM roundtrip, full system build and Studio Preview deployment remain separate gates.
Translations are deferred by user. Subsequent local work may change the site snapshot;
this report proves only its captured revision and listed source hashes.
