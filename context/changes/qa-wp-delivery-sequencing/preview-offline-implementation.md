# Phase 5 — independent saved-package verification and Preview journal

Implemented only the two newly authorized internal seams. Existing preview.ts,
deployment-manifest.ts, public exports, capture v1 semantics and shared build outputs
remain unchanged. No upload, approval enforcement substitute, remote install, or runtime
service was introduced or executed.

## Saved package verification

`verifyOwnedDeploymentPackage` reads the existing private capture format offline. Input
binds scope, siteId, packageId and an explicit expectedPackageHash. It checks the owner
record, private disjoint roots, manifest hash/schema, source-manifest relation, owned
theme and database presence, complete staged inventory and streamed byte hashes.
Unknown files/directories, missing entries, traversal, case/normalization collisions,
file-directory collisions, symlinks, hardlinks, public file modes and size limits refuse.
Reads are bounded and reject observed changes during verification. No persistent files
or locks are created by the verifier. This is a read-time verification of a cooperative
private filesystem, not an immutable mount or a defense against a privileged host racing
after return. Future transport must hold ownership/freeze and verify its actual inputs.

The report says saved_package_bytes_only, not_authorized and remoteRevision:not_verified.
Runtime strings remain operator-declared; content, database secrets and licensing stay
not_evaluated. This does not fill the pending host-configuration or approval contracts.

## Durable local journal and read-only reconcile

A single per-package journal binds scope/site/Studio ID/package hash, declared target,
revision and previous hash. Atomic private writes fsync file and directory, compare the
expected previous journal hash, and verify readback. Replay never resets uploading or
uncertain to prepared. The same existing operation.lock prevents concurrent mutation;
crash/failure retains it. Read-only diagnosis can report effectiveState:uncertain for
persisted uploading, but cannot steal the lock or conclude the old process has stopped.
An operator must first establish process termination and reconcile the owned lock before
calling the mutating journal reconciliation path.

`reconcileOwnedPreviewJournal` is a concrete caller of existing read-only Preview inventory.
It verifies the saved package, checks journal CAS/identity, and can persist uncertain or
uploaded_unverified. An absent or expired listing cannot reset the operation for retry;
a prepared candidate cannot adopt an already-existing host as proof of its upload.
Inventory never produces verified. The helper does not expose a begin/transport/approval
writer: that still belongs to the future authenticated host, which must durably record
its intent under the same ownership/locking protocol before starting a real upload.
Tests construct a persisted future-host intent explicitly; they do not pretend to run
that missing transport or approval integration.

## Verification

- Local Node v24.13.1; no services started.
- `node --test --test-isolation=none --test-reporter=spec src/__tests__/deployment-verify.test.ts src/__tests__/preview-journal.test.ts`: **29/29 passed**, no failures/skips.
- Narrow `tsc --noEmit` using a temporary config including the two new implementations
  and their tests: **passed**. No build or dist write.
- Real temporary SQLite and existing capture code feed these tests; verifier is not mocked.
- Test coverage includes post-capture mutation and inventory rejection, package scope/hash,
  manifest collision/limit errors, private durable replay, retained crash lock, absent and
  expired inventory, host observation without verification, stale CAS, corrupt journal,
  changed package and atomic-write failure retaining lock and removing temporary output.
- Initial strict-input projection bug was corrected before the successful gate; the public
  inputs remain strict while the internal verifier receives only their shared base fields.

## Reviewed-source candidates

- `packages/delivery-wordpress/src/deployment-verify.ts`: `6b1659e912bfbe942cbaca50ad7362b23449ab2290a0ccad36d5ca4ac581560d`
- `packages/delivery-wordpress/src/preview-journal.ts`: `9ab155b9ee39b521032d50dc62773ad2ea193e3ba7d8af1602794ab5be2bbb24`
- `packages/delivery-wordpress/src/__tests__/deployment-verify.test.ts`: `02ec86920d98f6cc01d0578437ad75300cca853a0957ea310b1c2e5cac82734c`
- `packages/delivery-wordpress/src/__tests__/preview-journal.test.ts`: `a8c03823632e5fa98c02f9b9ffebc4f15b77d75cd0b7351d1bf91f9ec44c073e`
- `packages/delivery-wordpress/src/__tests__/fixtures/saved-deployment.ts`: `0d2ec1a22053d9554029ade6b2df74f9f1b589b94e8cdaec5420f767ce2c679a`

## Private frozen staging (offline continuation)

Internal `preview-staging.ts` prepares a separate private copy of the verified saved
package's wp-content inventory. It binds the stage hash to the exact parent package
hash and site, streams copies with byte/hash/identity checks, re-verifies source and
output, and verifies an existing stage on replay instead of repairing or adopting it.
A failed or uncertain operation retains the site lock and private pending files for
reconciliation. This is read-time verified private storage, not an immutable mount.

The stage is deliberately NOT a registered Studio site or a complete host runtime.
No local runtime install, Studio registration, upload or remote modification occurs.
The result explicitly retains not_authorized/not_verified/requires_host_integration,
configuration and content/secret/licensing requirements. The host still must bind
prepared configuration/core runtime, approved candidate and actual upload bytes to
Studio's registered-site interface. Passing staging tests does not close5.2 or6.1.
