<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-03 (L7e) prove scope-change and immutability rules

- **Plan**: context/changes/asd-oss-t023-oss-03-l7e-prove-scope-change-and-im/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 1 critical, 2 warnings, 10 observations (independent reviewer sub-agent + own checks)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS (no production file touched; spec changelog line as in T021/T022) |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS (mirrors planImport/results suites; no comments, no `any`) |
| Success Criteria | PASS (module jest 36/875, core typecheck, scoped test tsc, eslint, live 14/14, 7/7 mutations red) |

## Findings

### F1 — Hand-over states the wrong R8 response shape
- **Severity**: ❌ CRITICAL · **Impact**: 🏃 LOW · **Dimension**: Success Criteria (hand-over accuracy)
- **Location**: context/changes/delivery-os-oss-domain/handover/OSS-03-H14.md (R8 row)
- **Detail**: Route returns only `{ decisionId, activeBaselineId, projectUpdatedAt }` (`api/baselines/[id]/decisions/route.ts:37-38`); the doc listed command-result fields.
- **Fix**: State the 3-field shape.
- **Decision**: FIXED

### F2 — Hand-over claims R10 manual needs the task version header
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Location**: OSS-03-H14.md header rules
- **Detail**: `tasks.create` checks no lock header.
- **Fix**: "R10 manual needs no lock header; task updates use the task updatedAt."
- **Decision**: FIXED

### F3 — Rule 1 did not exclude `undo` handlers on append-only commands
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: scopeChange.test.ts rule (1)
- **Fix**: Assert no append-only command has `undo`.
- **Decision**: FIXED

### F4–F13 — Observations
- F4 `→ ready` top code is `baseline_not_approved` (detail `baseline_not_active`) — doc wording FIXED.
- F5 "every write creates a new version" too broad — FIXED (R7 and R10 plan_proposal only).
- F6 R7/R10 also need `projects.view` — FIXED in doc.
- F7 half-approved v2 must not move the pointer; decisions prefix unchanged after v2 approvals — assertions ADDED.
- F8 decision-writer scan widened (`insert/nativeInsert/upsert…`) and `activeBaselineId =` assignment scan added — FIXED.
- F9 `api/<method>/` folder routes could bypass the scan — test ADDED (none exist).
- F10 `em.persist` not-called was vacuous for reserve — replaced by an untouched-`updatedAt` check.
- F11 `every` on empty task list — length assertion ADDED.
- F12 relabelled manifest detail codes pinned (`baseline_mismatch` ×2) — ADDED.
- F13 concurrent 409 comes from the project lock and the fake-timer check is decorative — DISMISSED: accurate per master plan ("drugi sprzeczny zapis dostaje konflikt" via the lock) and harmless; hand-over wording clarified.
