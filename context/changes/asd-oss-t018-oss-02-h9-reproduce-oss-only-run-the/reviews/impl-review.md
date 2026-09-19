<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (H9) OSS-only Gate, Live Smoke and Hand-over

- **Plan**: context/changes/asd-oss-t018-oss-02-h9-reproduce-oss-only-run-the/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixing F1)
- **Findings**: 0 critical, 1 warning, 3 observations

Independent read-only verifier checked every gate number against `/tmp/t018/*.log`, every code claim (contract version,
54 codes, schema versions, profiles, 8 features, 4 events, DI key, spot, 10 command ids, 10 route files), the lock
column of the spec route map, the 10 missing i18n keys, the optimistic-lock patch (110 → 114 tests) and `git status`
(only the change folder + `OSS-02-H9.md`). All matched except F1.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Condensed transcript quoted ids/timestamps from the first (overwritten) smoke run

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/delivery-os-oss-domain/handover/OSS-02-H9.md — Live OSS-only smoke
- **Detail**: Statuses and codes were right, but `updatedAt`, `contentHash`, `attemptId`, `evidenceId` and task `updated_at` came from the first run (25/26, wrong 428 expectation), whose log was overwritten by the kept 27/27 run.
- **Fix**: Replace the values with the ones in `/tmp/t018/live.log`.
- **Decision**: FIXED

### F2 — "No errors in the dev-server log" had no cited source

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: OSS-02-H9.md — transcript footer
- **Fix**: Name `/tmp/omhack-dev.log` and the grep used.
- **Decision**: FIXED

### F3 — Exit codes not recorded inside the log files

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: OSS-02-H9.md — Gate table
- **Fix**: State that exit codes were captured with `echo "exit=$?"` in the shell (consistent with the scripts' exit rules).
- **Decision**: FIXED

### F4 — Throwaway live script has no try/finally cleanup

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: /tmp/t018/live.ts (outside the repo)
- **Detail**: A mid-run crash would leave smoke rows; the kept run completed and the residue check printed 0. Deletes are scoped to script-created ids; SQL interpolates only UUIDs.
- **Decision**: SKIPPED — local throwaway outside the repo; run succeeded and cleanup was verified.
