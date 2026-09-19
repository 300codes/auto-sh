<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-04 (L8e): generic evidence recording (R19)

- **Plan**: context/changes/asd-oss-t028-oss-04-l8e-add-generic-evidence-reco/plan.md
- **Scope**: Phases 1–2 of 2 (working tree, uncommitted by team rule)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 3 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (D1–D17 MATCH; one helper placed in the command instead of `lib/`) |
| Scope Discipline | PASS |
| Safety & Quality | PASS (no tenancy or security finding) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS — 44 suites / 1074 tests, typecheck, eslint, `yarn generate`, live smoke on the final build |

Success-criteria note: plan step 2.4 names `yarn turbo run lint --filter=@open-mercato/core`; the core package has no
`lint` task (turbo ran 0 tasks), so eslint was run directly on every touched file (0 errors, 0 warnings).

## Findings

### F1 — Replay test assertion could not fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/evidence.test.ts ("answers a replay before any domain check and without reading storage")
- **Detail**: The test emptied the attachment store, so a wrong order would fail at the scope lookup and the inspector assertion was vacuous.
- **Fix**: Keep the file row and change its stored hash before the replay; a storage read would now answer `hash_mismatch` and call the inspector.
- **Decision**: FIXED

### F2 — Planned test cases missing (derived field not hashed, recorder without a user id)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: commands/__tests__/evidence.test.ts
- **Detail**: No test proved that a client-sent `verificationStatus` is neither stored nor hashed, nor that `recordedBy` is null for a non-uuid session subject.
- **Fix**: Added one test covering both.
- **Decision**: FIXED

### F3 — Project row lock is held while one screenshot file is read

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: commands/evidence.ts (`recordEvidenceInTransaction`), commands/attachments.ts (`verifyEvidenceAttachments`)
- **Detail**: A slow storage driver would stall other writers of the same project for the duration of one read.
- **Fix A ⭐ Recommended**: Keep as is and document.
  - Strength: One file, capped at 10 MiB, local storage; keeps "replay never reads storage" and one simple transaction; already accepted in the plan review (F4).
  - Tradeoff: A hung remote driver would pin the project lock.
  - Confidence: HIGH for the hackathon setup (local disk).
  - Blind spot: Remote storage latency in a production deployment.
- **Fix B**: Verify before the lock with an unlocked replay pre-check, then lock → lookup → insert.
  - Strength: No I/O under the lock.
  - Tradeoff: Two lookups, checks outside the transaction, more code to get wrong the night before the demo.
  - Confidence: MEDIUM.
  - Blind spot: Check-then-insert windows for the task pin.
- **Decision**: ACCEPTED via Fix A — documented in the hand-over as a limitation

### F4 — Id letter case bypassed the replay

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lib/evidenceRules.ts (`hashEvidenceIdentity`, `normalizeAttachmentIds`), commands/attachments.ts
- **Detail**: `z.uuid()` accepts uppercase; the hash used ids verbatim, so the same body in another case created a second row, and an uppercase extra attachment id got a false `foreign_reference`.
- **Fix**: Lowercase ids in the identity hash and in the attachment id comparison; unit test added.
- **Decision**: FIXED

### F5 — `test` rule failed open when `sourceRevision` was absent

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/evidence.ts (`assertKindRules`)
- **Detail**: Unreachable today (the schema requires the revision), but a relaxed schema would have stored unchecked test evidence.
- **Fix**: Throw `400 validation_failed` on `sourceRevision` instead of returning.
- **Decision**: FIXED

### F6 — Duplicate dedupe logic and unneeded exports

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: commands/attachments.ts, lib/evidenceRules.ts
- **Fix**: `verifyEvidenceAttachments` reuses `normalizeAttachmentIds`; `TEST_EVIDENCE_CHECKS_PATH_PREFIX` and `EvidenceAttachmentInput` are no longer exported.
- **Decision**: FIXED

### F7 — Failure of a post-commit emit is not repaired by the retry

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: commands/evidence.ts (`recordEvidenceCommand.execute`)
- **Detail**: Same pattern as the reviewed `delivery_os.results.accept` (`emitResultAccepted`); the row exists, the retry answers `duplicate: true` and re-emits the event, but the index side effect and audit entry of the first call are lost.
- **Fix**: Change both commands together in OSS-06 stabilisation if it shows up; not changed here to keep one pattern.
- **Decision**: SKIPPED — inherited module pattern, noted in the hand-over

### F8 — Storage outage reads as `hash_mismatch`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/attachments.ts (`verifyEvidenceAttachments`)
- **Detail**: Intentional (plan D7, spec R19 lists only `hash_mismatch`); the detail code `attachment_unreadable` is preserved so a client can tell.
- **Decision**: DISMISSED — by design, documented

### F9 — `toStoredEvidence` lives in the command, response schema carries L8f fields

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Detail**: The stored-payload selection needs the typed discriminated input, so it stayed next to the command and is covered by the command tests; the optional `taskStatus` / `taskUpdatedAt` are the spec's R19 response and are filled by L8f.
- **Decision**: DISMISSED — adaptation recorded here
