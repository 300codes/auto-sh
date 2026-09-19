<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-04 (L8e): generic evidence recording (R19)

- **Plan**: context/changes/asd-oss-t028-oss-04-l8e-add-generic-evidence-reco/plan.md
- **Mode**: Deep (claims verified directly against the code by the reviewer; no sub-agent needed for five targeted checks)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Grounding: 6/6 paths ✓ (`commands/evidence.ts`, `commands/attachments.ts`, `lib/resultChecks.ts`, `api/schemas.ts`, `commands/__tests__/scopeChange.test.ts`, `lib/__tests__/projectStatus.test.ts`), 6/6 symbols ✓ (`lockScopedProject`, `findProjectBaseline`, `readBaselineContent`, `requireTaskProfile`, `verifyAttachmentReferences`, `parseRecordEvidenceBody`), brief↔plan ✓, Progress↔Phase ✓.

Verified claims: `attachmentIssue` yields `missing_render` for a non-image or empty file with role `screen` and `attachment_hash_mismatch` for sha/size (`lib/designReview.ts:280-330`), so the D7 mapping is needed and complete; `lockScopedProject` is a scoped `PESSIMISTIC_WRITE` read that answers 404 (`commands/shared.ts:181`); zod objects strip unknown keys, so `projectId` in the body never reaches the hash.

## Findings

### F1 — Unreadable attempt register is not covered

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decisions D5
- **Detail**: With `attemptId` the command must parse `task.executionAttempts`. The plan names `attempt_not_found` but not the unreadable-register case; every other command fails closed with `409 reconciliation_required` / `unreadable_attempt_register`.
- **Fix**: Reuse `unreadableRegisterError` from `commands/attempts.ts`.
- **Decision**: FIXED

### F2 — Soft-deleted task as evidence target

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decisions D5
- **Detail**: The plan does not say whether a deleted task can receive evidence. The scoped finders filter `deletedAt: null`.
- **Fix**: Look the task up with `{ id, projectId, deletedAt: null }` in scope; missing → `422 foreign_reference` / `foreign_task`.
- **Decision**: FIXED

### F3 — Baseline approval is an unstated assumption

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Decisions table (only the brief mentions it)
- **Detail**: Evidence may name a baseline of the project that was never approved. The plan neither refuses nor documents it.
- **Fix A ⭐ Recommended**: Accept any baseline of the project and document it as D17.
  - Strength: Evidence of an old or rejected baseline stays truthful history; proof is always computed per baseline, and only an approved active baseline drives tasks and the report.
  - Tradeoff: A row can exist for a baseline nobody approved.
  - Confidence: HIGH — `scopeChange.test.ts` already proves old-baseline evidence is kept out of the active baseline.
  - Blind spot: None significant.
- **Fix B**: Refuse evidence for a baseline without approvals.
  - Strength: Fewer useless rows.
  - Tradeoff: Needs decision loading in R19 and blocks historical WP material (UA-27) recorded before approval.
  - Confidence: MEDIUM.
  - Blind spot: Interaction with rejected-then-superseded baselines.
- **Decision**: FIXED via Fix A

### F4 — Storage read under the project lock

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Performance Considerations
- **Detail**: The plan says "≤ 64 MiB total"; for R19 exactly one file is read and the per-file cap is 10 MiB (`MAX_BASELINE_ATTACHMENT_BYTES`). Reading before the lock would make a replay read storage.
- **Fix**: State the real bound (one file ≤ 10 MiB) and keep the read inside the lock; accepted.
- **Decision**: FIXED

### F5 — Success criteria do not name the stored-file replay rule for the route

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 route tests
- **Detail**: The route test list omits the response-key freeze for the duplicate answer. Already implied by "frozen response keys"; no plan change.
- **Decision**: DISMISSED — covered by the existing bullet
