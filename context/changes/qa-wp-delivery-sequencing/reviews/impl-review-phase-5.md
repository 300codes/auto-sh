<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: independent deployment verification and Preview journal

- **Plan**: [QA/WP sequencing](../plan.md)
- **Scope**: Phase 5 of 6, independent saved-package verifier and durable read-only reconciliation only
- **Date**: 2026-09-19
- **Verdict**: APPROVED for the scoped implementation; phase 5 acceptance remains incomplete
- **Findings**: 0 open critical, 0 open warnings, 1 fixed finding

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS for the scoped checks below |

## Findings

### F1 — Extended input rejected by strict base schema

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `packages/delivery-wordpress/src/preview-journal.ts`, prepare and reconcile calls
- **Detail**: Projecting the extended request through the strict base schema rejected its targetHost or expectedJournalHash before verification.
- **Fix**: Strip the already-validated extension only at the internal projection; keep both external input schemas strict.
- **Decision**: FIXED. Both paths run against real captured SQLite fixtures in the passing suite.

## Independent verification

Reviewer reran both new test files using local Node24.13.1 and
`--test-isolation=none`: **29/29 passed**, zero skipped/cancelled/failures.
Reviewer then ran `npm run typecheck --prefix packages/delivery-wordpress`: **passed**
for the full package, in addition to the author's narrow check. No global build, runtime service,
upload or generated-output change was needed for these checks.

Reviewer also called the verifier against the real private package captured earlier:
**3725 files / 66951346 bytes passed**. The code hash was checked before and after
execution. [Safe evidence](../evidence/local-deployment-package-verify.json) binds
the original capture and explicit expected package hash. This is a technical package,
not the final release candidate.

The subsequent package build passed. The reviewer called the compiled verifier and
compiled journal prepare/read functions against that same real private package:
byte verification passed and the durable journal read back as `prepared`, with no
publication authorization. All previously built package modules remained byte-identical.
[Compiled call-site evidence](../evidence/preview-offline-compiled-verification.json)
records the new compiled hashes and build log hash. No WordPress service, remote
inventory or upload was started by this check.

Reviewed source hashes and detailed boundaries are in the
[implementation note](../preview-offline-implementation.md) and
[validation manifest](../evidence/preview-offline-verification.json). Inspection covered scope
and owner binding, exact inventory and streaming bytes, path/link rejection, private
atomic writes and CAS, retained locks, replay and inventory reconciliation. No path
issues upload commands or infers verified from account-wide Preview inventory.

## Acceptance still pending

The future trusted host must durably record its upload intent, authorize the exact
target/package, transport frozen bytes through Studio's registered-site interface,
and independently verify the remote revision. Tests simulate persisted host intent;
they do not implement that transport. The full ordered gate and phase 5 criteria 5.1
and 5.2 stay unchecked. Nothing here grants G4/G5 or completes phase 6.
