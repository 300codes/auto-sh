<!-- IMPL-REVIEW-REPORT -->
# Review: private frozen Preview staging

Plan: Phase5 preparation; reviewed2026-09-19. PASS for this internal portion only.

Root inspected `preview-staging.ts` against the saved-package verifier, ownership
lock and fixture. It consumes the expected package hash, copies verified saved bytes
rather than live site files, uses bounded streaming with nofollow/private/nlink checks,
verifies exact output inventory and source again, and hashes the parent binding.
Replay checks the existing output; mutation does not trigger silent repair/adoption.
Failures retain pending output and reconciliation lock. No public exports or API changes.

Root independent focused rerun:15passed,0failed,0skipped. Real temporary SQLite is
used; no Studio/OM runtime started. The original captured fixture inventory is the
source, and tests reject changed bytes, unsafe paths/links/permissions and bindings.

Limitations are explicit output fields: private staging bytes only; no registered
Studio binding, runtime/config completion, approval, transport or remote verification.
A private directory is not an immutable mount. Future host must retain ownership and
verify actual transport inputs; this helper alone does not close5.2/6.1. No blocking
finding remains in the reviewed portion.
