<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L2) five entities, reviewed migration, validators and module registration stub

- **Plan**: context/changes/asd-oss-t006-oss-02-l2-add-five-entities-reviewed/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 0 critical, 6 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after F1, F3, F4 |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (re-run after fixes: jest 237 passed, core typecheck 0 errors, core build ok, migration applied, SQL smoke ok) |

Two read-only sub-agents reviewed the change (plan drift; safety and patterns). Drift review: every spec column, index and request-body
field name matches; no scope creep; no files outside the owned paths.

## Findings

### F1 — `repositoryRef` credential check could be bypassed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: data/validators.ts `hasUrlCredentials`
- **Detail**: The regex needed a literal `://`; `https:/user:tok@host`, `https:\\user:tok@host` and `https:user:tok@host` passed although WHATWG URL parsing treats them as credentialed.
- **Fix**: Loosen the regex to any slash/backslash run and also parse with `new URL`; test the three bypass strings on create and update.
- **Decision**: FIXED

### F2 — `draftSpec` defaults turn a partial body into a full replacement

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: data/validators.ts `draftSpecV1Schema`, `projectUpdateSchema`
- **Detail**: Omitted sections parse as empty, so a command assigning the parsed draft replaces the stored one.
- **Fix**: Keep PUT semantics (the editor always sends the whole draft; optimistic locking protects concurrent edits) and make it explicit: a test documents it and the spec changelog states "full replacement".
- **Decision**: ACCEPTED — documented in the spec and pinned by a test; the UI stream is told in the hand-over notes.

### F3 — Unbounded manifest bodies and record sections

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: data/validators.ts `manifestBodySchema`, `tokens`, `acTestMap`, `manualChecks`
- **Fix**: Manifest bodies above 2 000 000 serialized characters → `413 payload_too_large`; record sections capped at 500 entries. Tests added.
- **Decision**: FIXED (the same unbounded records inside `baselineContentV1Schema` belong to L1 and are left for the OSS-06 hardening pass)

### F4 — Partial unique index on evidence ignores rows with NULL task/attempt

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: data/entities.ts `DeliveryEvidence`
- **Detail**: Postgres treats NULLs as distinct, so `result_manifest` rows without `attempt_id` would escape "one manifest per attempt".
- **Fix**: Add check constraint `delivery_evidence_result_manifest_attempt_chk`; the single migration was regenerated (not stacked), the local DB repaired and re-migrated, the constraint smoke-tested.
- **Decision**: FIXED

### F5 — `delivery_tasks_proposal_key_uq` does not exclude soft-deleted tasks

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Detail**: Reviewer feared an archived task blocks re-import of the same key.
- **Decision**: DISMISSED — the predicate is frozen in the spec, and every plan import creates a new merged baseline, so `baseline_id` differs; an identical re-import is answered as `duplicate` before any insert.

### F6 — Plain (code-less) refinement issues downgrade a catalogue code to `validation_failed`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Location**: data/validators.ts `recordEvidenceSchema`
- **Decision**: ACCEPTED as designed — the catalogue has no code for "attempt without task"; a shape-level problem winning is the same rule `deliveryErrorFromZod` applies everywhere. Tests now assert status and code, including one mixed case.

### F7 — Observations

- Missing test pairs (revision for review/scan, non-http deployment URL, `targetProfileVersion`, update `repositoryRef`): **FIXED**.
- Duplicate unique-id helper: **FIXED** (`checkUniqueIds` exported from contracts and reused).
- Task-status union duplicated between entity and zod: **FIXED** (entity type derives from `TaskStatus`).
- Redundant `(tenant, org, project, kind)` index, extra lookup indexes, baseline hash unique blocking "revert to old content": **DISMISSED** — all three are frozen spec decisions (identical content returns the existing row as `duplicate`).
- `taskUpdateSchema` accepts system statuses: **DISMISSED** — plan decision D4 (R12 must answer `409 invalid_transition`); the L3/L4 lifecycle carries the test.
- `optimistic-lock-editable-entities.test.ts` does not list `delivery_os`: **SKIPPED** — file outside OSS ownership; proposed patch in the task notes.
