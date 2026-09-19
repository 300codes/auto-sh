<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: T053 FLOW-F2 L16

- **Plan**: plan.md · **Scope**: all phases · **Date**: 2026-09-19
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes · **Findings**: 0 critical, 5 warnings, 5 observations

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS (F6 doc drift) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1–F4) |
| Architecture | PASS (no `modules/staff` import, FK ids only) |
| Pattern Consistency | PASS |
| Success Criteria | PASS (module jest, core typecheck, migration applied on :5442) |

| ID | Sev | Finding | Decision |
|---|---|---|---|
| F1 | WARNING | `editedAt` / `sourceUpdatedAt` compared as raw strings → endless new revisions once rows come back as `toISOString()` or a mapper yields `undefined` | FIXED — `sameInstant`, test with offset / no-ms / undefined |
| F2 | WARNING | Deterministic `stage_mismatch` skip held the cursor forever (file sync blocked) | FIXED — skip advances, `lastError` names the keys; plan D2 + spec changelog updated |
| F3 | WARNING | Per-thread write failure (D6) not expressible; cursor would advance | FIXED — `failedThreadKeys` on `advanceSyncCursor` / `summarizeCommentImport` / `buildCommentImportResult`; unlisted when no card yet (frozen result needs ids) |
| F4 | WARNING | Truncation could split a surrogate pair | FIXED — drops a trailing high surrogate; test |
| F5 | WARNING | Test overrode the fixture's `lastBatchKey/Hash`, so the literals were never asserted | FIXED — asserts `fixtureCursor()` unchanged |
| F6 | OBS | Spec changelog said "tables exactly as the rows"; four columns are nullable, `created_at` added | FIXED — changelog wording |
| F7 | OBS | `existingThreads.find` per batch thread | FIXED — keyed map |
| F8 | OBS | Stale `deferral` after triage reset; replay only vs last key of the file | DEFERRED to L17 command — noted in FLOW-progress |
| F9 | OBS | English labels in staff card text / `lastError` (pure lib, format fixed by spec) | ACCEPTED — L18 may pass labels via `resolveTranslations`; allowlist if the i18n checker flags it |
| F10 | OBS | Comment author/body copied in plaintext into staff task text (spec-mandated; staff has no encryption map for tasks) | ACCEPTED — reported as a risk in the hand-over |
