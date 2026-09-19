<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-03 (L7b) Design-Review Validation and Attachment Verification for Baselines

- **Plan**: context/changes/asd-oss-t020-oss-03-l7b-add-design-review-validat/plan.md
- **Scope**: Phases 1–2 of 2 (working tree; commits are made by the orchestrator)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria run: delivery_os jest scope 34 suites / 818 tests green; core typecheck green; eslint clean on touched
files; no ORM relation decorator in `delivery_os/data`; `designReview.ts` has no ORM/data import; live smoke 9/9.
Unplanned change: `commands/__tests__/attemptQueries.test.ts` pinned the DI key list and had to learn the additive key.
Manual row 2.5 stays unticked (human acceptance); the scripted smoke is reported as evidence only.

## Findings

### F1 — Bytes are read while the project row lock is held

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: commands/baselines.ts (transaction) + commands/attachments.ts
- **Detail**: up to 300 references × 10 MiB read sequentially inside `em.transactional` under the project lock.
- **Fix**: cap the sum of the stored sizes before any read (`MAX_BASELINE_TOTAL_ATTACHMENT_BYTES` = 64 MiB →
  `413 payload_too_large` / `attachments_total_too_large`, the spec's code for "attachment above limits"). Moving the reads
  out of the lock would need a second draft-hash comparison; not worth it at hackathon scale.
- **Decision**: FIXED (total cap); remaining lock-held I/O ACCEPTED and listed as a limitation.

### F2 — The pre-read size gate trusts `Attachment.fileSize`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Detail**: a row that under-reports its size is still buffered before the post-read check rejects it. The storage driver
  contract has no ranged read.
- **Decision**: ACCEPTED — `fileSize` is written by the attachments module from the uploaded buffer, not by the client; the
  post-read check still refuses the baseline.

### F3 — Messages echo stored type and size of any attachment in the organization

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Decision**: DISMISSED — the platform's own `GET /api/attachments/file/[id]` serves the whole file on the same
  tenant + organization filter, so type and size disclose nothing the caller cannot already fetch; the id is an unguessable
  UUID. Restricting references to attachments owned by the project (`entityId`/`recordId`) is noted as a possible hardening;
  it would bind the UI stream to one upload convention, so it is not done unasked.

### F4 — Oversize / wrong type of a non-screen attachment was untested at command level

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Location**: commands/__tests__/baselines.test.ts
- **Decision**: FIXED — new case with an attachments-only pdf (passes), oversize and `application/zip`
  (`422 attachment_hash_mismatch`, details `attachment_too_large` / `unsupported_mime_type`). The top-code mapping is a
  recorded decision (no new codes).

### F5 — Null `mimeType` / `fileSize` on a legacy row would throw

- **Severity**: ℹ️ OBSERVATION
- **Decision**: FIXED — `?? ''` / `?? 0`; an empty type answers `unsupported_mime_type`. A missing DI key stays a loud 500
  (misconfiguration, not user input).

### F6 — Claimed type of non-screen attachments was never compared with the bytes

- **Severity**: ℹ️ OBSERVATION
- **Decision**: FIXED — when the magic bytes are recognisable and differ from the stored type →
  `attachment_hash_mismatch` / `content_type_mismatch`.

### F7 — `null` token values pass draft save but fail at freeze

- **Severity**: ℹ️ OBSERVATION
- **Decision**: ACCEPTED — design rules run at freeze by decision; the message names the token. Documented in the spec.

### F8 — Scope test covered a foreign organization only

- **Severity**: ℹ️ OBSERVATION
- **Decision**: FIXED — foreign tenant, NULL organization and NULL tenant rows now answer the identical body and the
  inspector is asserted never called. `validateDesignManifest` has no production caller yet by plan (design import is the
  next L7 task).
