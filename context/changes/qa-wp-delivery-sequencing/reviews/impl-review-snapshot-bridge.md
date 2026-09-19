<!-- IMPL-REVIEW-REPORT -->
# Review wewnętrznego czytnika snapshotu i callera QA

- Plan: ../plan.md, przygotowanie fazy4
- Date: 2026-09-19
- Verdict: APPROVED for scoped offline preparation; live acceptance pending

Reader checks owner/scope/site/creationAttempt/provenance, exact manifest and byte
hashes, inventory, path safety/private permissions, bounds and an active site lock.
QA caller loads the explicitly configured local operator and passes its two verified
snapshots to the canonical mapper. No public API, production dependency or export changed.

### F1 — Limit artefaktów zbyt późno

- Severity: WARNING
- Location: core/helpers/integration/wordpressResultFixtures.ts
- Decision: FIXED. Caller rejects over200 unique artifact paths before loading the
  operator or reading either DB. Regression uses a nonexistent operator path and
  proves the artifact-limit refusal happens first. Caller tests9/9 PASS.

### F2 — Capture-event binding is not stored in the legacy manifest

- Severity: OBSERVATION
- Decision: DOCUMENTED boundary. Reader proves owned content, not an original
  toolExecutionId/capturedAt event. The trusted caller must retain the original
  capture response and its directory association. No reconstructed receipt is
  presented as historical proof. This keeps live4.2 pending.

Validation: reader17tests, caller9tests, WP package TypeScript and narrow bridge
TypeScript PASS. Compiled golden uses real frozen SQLite/theme bytes with explicitly
simulated owner metadata; no live HTTP/WordPress/EXEC success claimed.
