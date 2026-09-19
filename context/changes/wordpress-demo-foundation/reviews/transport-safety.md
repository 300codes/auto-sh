# Internal archive transport safety review

Date: 2026-09-19. Independent review of `demo-plugins.ts`, its tests, the existing runner/ownership helpers, and `implementation-notes.md`. Native probe implementation is outside this review.

## Verdict

PASS for the reviewed local-operator safety boundary; no blocking finding, including the final scoped WP-CLI HTTP policy hooks. This is a source review, not proof that Studio/WordPress accepts the download URL. Live installation and replay remain separate verification gates. No runtime switch, public API change, global download-host exception, or paid archive staging in the served site is introduced.

Reviewed SHA-256:

- `packages/delivery-wordpress/src/demo-plugins.ts`: `3c74e8dfab2ae425a901e3d52bd440c5782bf78f9412e19508f1fa1972e8fa1f`
- `packages/delivery-wordpress/src/__tests__/demo-plugins.test.ts`: `95430115fb7c1629f033bedfcdf431a1d6cc68efafc7ca9117747a4a5655b092`

## Findings and bounds

- Ownership is checked before preflight and again under the existing exclusive site lock before mutations. An uncertain installation retains that lock, preventing an unreviewed retry. The transport does not remove or take over reconciliation locks.
- All three archives are validated before installation. Private permissions, safe paths, bounded size, opened-file identity, SHA-256 and ZIP signature are checked. Installation serves the frozen verified bytes, even if the source archive subsequently changes.
- The listener binds only `127.0.0.1` on a random port. A fresh 256-bit capability path accepts exact GET requests only; no directory listing, redirects, alternate paths or URL-controlled filesystem reads exist. There are at most three accepted downloads, one active response and four connections. Responses disable caching and close connections.
- The final `archiveHttpPolicyPhp` change narrowly permits that internally minted URL in the current install process. Its validated alphabet cannot inject PHP quoting/code. Host and safe-port filters require both exact URL equality and the loopback host; unrelated requests retain their incoming policy. The request-arguments filter sets redirects to zero only for the exact URL. Hooks are registered after WordPress loads and are not persisted to files, options, or other processes. This is an explicit scoped exception to WordPress's default loopback rejection, not a general HTTP safety disable.
- An absolute listener deadline is capped at 180 seconds. `finally` closes both the listener and existing connections after success or failure; expiry also closes them and cannot produce success. The real command runner independently bounds the install subprocess with the same timeout and SIGKILL. An injected runner is trusted test infrastructure and marks the result as fixture; the transport does not promise to settle an arbitrary never-resolving injected callback.
- The capability URL is passed in local Studio process arguments. Therefore this mechanism does **not** isolate the archive from a host principal able to inspect those arguments during installation. Its boundary is the trusted operator host, not hostile local OS users. The URL and command output are excluded from the returned report and sanitized errors. Capturing raw subprocess arguments/output externally would require the same care as private operator logs.
- Installation success requires subsequent inventory confirmation of the pinned version, activation confirmation, and a verified `blog_public=0` value. A successful download or subprocess exit alone cannot yield PASS. Fixture provenance is explicit. Existing matching plugins are verified by version/state; their reported configured archive hash is not a claim that installed files were re-hashed.

## Test coverage inspected

The tests exercise exact served-byte hashes, wrong path/method rejection, three-download cap, listener unavailability after success and command failure, expired listener plus failed result, retained failure lock, original-file changes after preflight, foreign scope and changed Studio registration, and preflight refusal without mutations. Execution results are recorded by the implementation validation owner; this reviewer did not start a concurrent runner.

Final validation reported by the implementation owner: `node --test --test-isolation=none packages/delivery-wordpress/src/__tests__/demo-plugins.test.ts` passed 16/16; package typecheck and build passed. The reviewer also inspected the separate PHP 7.4 behavioral harness (nine assertions reported PASS), which executes the closures against matching and nonmatching URL/host/port arguments and checks preservation of unrelated request settings. These isolated assertions do not replace the ongoing live installation gate.

The final implementation notes match the user's local-first constraint: installation, configuration, build and verification occur locally; this operator performs no Preview upload. Future publication must deploy the complete verified snapshot without remote installation/build or repair. This review does not certify that future adapter behavior as implemented.

The first real host-path installation failure remains a failed historical attempt. This review does not convert that failure, a fixture run, or an unexecuted safe-download check into live proof.
