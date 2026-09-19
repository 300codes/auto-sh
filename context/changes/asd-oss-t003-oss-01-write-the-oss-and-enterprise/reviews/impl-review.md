<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-01 (T003) OSS and enterprise-boundary specs

- **Plan**: context/changes/asd-oss-t003-oss-01-write-the-oss-and-enterprise/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-19
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes
- **Findings**: 1 critical, 5 warnings, 6 observations (consolidated to 10 below)

Method: one sub-agent cross-checked the three documents against the master plan and BREAKDOWN. It covered plan drift, internal consistency, coverage and scope. The main session verified every cited `file:line` and re-ran the automated criteria. The code-safety and pattern dimensions do not apply, because this is a documentation-only change.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after F1 fix) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: 1.1–1.3 and 2.1–2.4 were re-run after the fixes and all pass. `yarn agents:check-budget` exits 0. `git status` shows only allowed paths. Manual rows 1.4 and 2.5 stay open for humans.

## Findings

### F1 — No transition to `verified` was defined

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: .ai/specs/2026-09-18-delivery-os-hackathon.md (UA-09, UA-13)
- **Detail**: R12 could only set `draft/ready/blocked/cancelled`, and UA-13 only moved a task to `changes_requested`. Nothing reached `verified`, so dependent tasks could never start. Plan: "`verified` wymaga dowodów dla bieżącego baseline i sourceRevision".
- **Fix**: `verified` is reachable only through review evidence with `verdict: approved`. The system checks the proof: an accepted result on the pinned baseline, all `requiredTestIds` passed on the result revision, and the manual checks approved. Otherwise it returns 422 `missing_required_tests`. R12 cannot set it.
- **Decision**: FIXED

### F2 — Proposal replay would hit the lock before the duplicate check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: OSS spec, API Contracts intro
- **Detail**: R7/R10 proposals require the project lock and bump `updatedAt`. A replay would therefore get a 409 instead of `duplicate: true`.
- **Fix**: A general "Replay before lock" rule now covers R7/R10 (keyed by `manifestId` + hash) and R14 (keyed by `Idempotency-Key`).
- **Decision**: FIXED

### F3 — UA-12 validation order not stated

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: OSS spec UA-12
- **Fix**: The order is now explicit: scope → schema → idempotency, which wins over `attempt_closed`/`attempt_cancelled` → correlation → paths → checks.
- **Decision**: FIXED

### F4 — `baseCommit`/`resultCommit` blurred into revision fields

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: OSS spec, Contracts v1 and ExecutionAttempt
- **Fix**: The explicit `baseCommit`/`resultCommit` are kept. They are required for git and absent for snapshot, while the revision fields are always required.
- **Decision**: FIXED

### F5 — `active_attempt` not in the catalogue

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: OSS spec UA-04
- **Fix**: Changed to `attempt_active`.
- **Decision**: FIXED

### F6 — Enterprise coverage missed pause/cancel and parked-before-enqueue

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: enterprise spec, Integration Coverage
- **Fix**: Added TC-DELIVERY-EXEC-005 and the `WAIT_FOR_SIGNAL`-before-enqueue assertion in EXEC-001. The hand-over was updated to match.
- **Decision**: FIXED

### F7 — Error-code renames vs the breakdown undocumented

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: OSS spec, Changelog; hand-over
- **Fix**: Recorded as deliberate renames. The spec is authoritative.
- **Decision**: FIXED

### F8 — `manualCheckId` missing; `skipped` not a check status

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: OSS spec, `delivery_baselines.content`, ResultManifest, TC-DELIVERY-009
- **Fix**: Added `manualChecks: { [acId]: manualCheckId }`. A review evidence entry carrying `manualCheckId` records the human verdict. A runner `skipped` is reported as `not_run`.
- **Decision**: FIXED

### F9 — Specs disagreed on when `pending` is written; `automatic` guard too implicit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: enterprise spec, `results.accept` and `reserve` rows; OSS spec, Commands
- **Fix**: `pending` is written only when `workflowRef` is set. `automatic` now also requires the typed `trustedExecution` option, not just the absence of `ctx.request`.
- **Decision**: FIXED

### F10 — Smaller gaps: UA-19 `not_started`/`stopped`, `results.test.ts` owner, scope-change coverage, unused `change` decision kind

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: OSS spec, UA-19, Commands, Integration Coverage, `delivery_decisions`
- **Fix**: Added the outcomes: the attempt closes and the task returns to `ready`/`changes_requested`. `results.accept` is placed in `commands/evidence.ts` (plan line 334). The baseline-immutability and old-baseline-result assertion was added to TC-DELIVERY-002. The `change` kind was dropped, because the master plan has no such decision and a scope change is a new baseline.
- **Decision**: FIXED
