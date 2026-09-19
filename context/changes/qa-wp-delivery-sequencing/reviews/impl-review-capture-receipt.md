<!-- IMPL-REVIEW-REPORT -->
# Review: receipt-backed WP capture

Plan: Phase 4 / WP-M02, internal preparation. Reviewed 2026-09-19.
Verdict: PASS for the bounded offline implementation; live acceptance remains not_run.

Reviewed `capture-owned-snapshot.ts` against ownership, snapshot reader and locking
implementations. The capture holds one operation lock, checks the registered owner,
confirms stopped state before SQLite/theme capture, restores and confirms the original
running state, then writes a private original receipt atomically. Failures retain the
lock; they cannot return a successful receipt. Original snapshot provenance, capture
identity and timestamp are bound by the receipt hash instead of reconstructed by callers.

The reader validates receipt hash/scope/site, refuses unsafe links/permissions and
observed file replacement, then verifies actual frozen bytes through the existing
snapshot reader. No public exports, OSS DTOs or snapshot-v1 hashing semantics changed.
This is cooperative private-filesystem ownership, not protection against privileged
host modification after verification. Existing historical snapshots cannot gain
original capture receipts retrospectively.

Independent root rerun: 11 tests passed, zero skipped. Tests use real temporary SQLite
and explicitly fixture-tagged fake Studio inventory; this is not live Studio evidence.
Agent package TypeScript also passed. No open blocking findings in this portion.
Actual manual roundtrip call site is a separate review item.
