<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L4d) manual baseline creation and atomic decisions

- **Plan**: context/changes/asd-oss-t012-oss-02-l4d-add-manual-baseline-creat/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-09-19
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes
- **Findings**: 0 critical, 2 warnings, 4 observations (one read-only sub-agent; RAM rule)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (D1–D11, D13, D14 MATCH; D12 benign drift, see F3) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after F1, F2 |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS — jest 17 suites / 496 tests, `tsc --noEmit` exit 0, eslint clean, append-only grep empty |

## Findings

### F1 — A malformed lock header passed the "required" gate and skipped the version check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/shared.ts `requireLockHeader`
- **Detail**: the platform compare returns silently for a token that is not a timestamp, so `x` as the header disabled
  the second-writer rule.
- **Fix**: normalize with `normalizeIsoToken`; an unparseable token → `400 validation_failed` / `optimistic_lock_invalid`.
- **Decision**: FIXED (tests added in both suites)

### F2 — `baseline.approved` could be lost when an index side effect throws after commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/decisions.ts (post-commit block)
- **Fix**: emit the domain event first, then the index side effects.
- **Decision**: FIXED (test added)

### F3 — `project.updatedAt = decidedAt` is replaced by `onUpdate` at flush

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Detail**: the assignment only makes the row dirty; the stored value is the flush-time clock and the entity is
  mutated in place, so the returned `projectUpdatedAt` equals the stored value. `nextDecidedAt` also takes
  `project.updatedAt + 1` so a skewed clock cannot produce a non-increasing value (D12 drift, benign).
- **Decision**: ACCEPTED — behaviour is correct; proven over HTTP once the routes task lands.

### F4 — Approving an older baseline moved the project backwards

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Detail**: with v2 active, two approvals of v1 made v1 active and re-fired the planning trigger.
- **Fix**: a baseline with a lower version than the active one is never promoted (the decision is still recorded).
- **Decision**: FIXED (two tests added; plan D11 amended)

### F5 — Version unique violation with another hash escapes as an error

- **Severity**: 💡 OBSERVATION
- **Dimension**: Safety & Quality
- **Decision**: DISMISSED — unreachable while every baseline writer holds the project row lock; hand-over tells OSS-03
  to use `lockProjectForWrite`.

### F6 — Test gaps

- **Decision**: FIXED for F1, F2, F4. The concurrent-writer test stays sequential with a mocked EM; a real two-connection
  race belongs to QA TC-DELIVERY-003.
