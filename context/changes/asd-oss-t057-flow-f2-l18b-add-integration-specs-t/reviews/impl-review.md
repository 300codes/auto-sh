<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F2 L18b

- **Plan**: context/changes/asd-oss-t057-flow-f2-l18b-add-integration-specs-t/plan.md · **Scope**: all 3 phases · **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes · **Findings**: 0 critical, 3 medium, 7 low (independent read-only reviewer sub-agent)

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | WARNING (one command fix outside the "specs only" plan, justified by F3) |
| Safety & Quality | PASS (cleanup scoped to own ids, constant table lists) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (4/4 specs, counts identical, jest 98/1829, typecheck, OSS-001 4/4) |

| ID | Sev | Finding | Decision |
|---|---|---|---|
| F1 | MEDIUM | Hand-over + F11 OpenAPI listed `duplicate_stable_id` as 400; it is 422 | FIXED (hand-over, route OpenAPI doc) |
| F2 | MEDIUM | Hand-over said "unconfirmed threads block every version"; only `artifactId: null` threads do | FIXED (reworded) |
| F3 | MEDIUM | `storeSyncCursor` overwrote the cursor unconditionally → an overlapping/slow delivery could rewind it | FIXED in code: re-check `stored.cursor === batch.cursor.after` under the project lock; unit test added; hand-over semantics rewritten |
| F4 | LOW | Done-move checks run before any async subscriber could react | DISMISSED — jest `staff status is never authority` asserts no delivery subscriber exists |
| F5 | LOW | Parallel page-2 may run sequentially | ACCEPTED — both orders are asserted consistent; race proven by unit tests |
| F6 | LOW | `staff_time_task_tags` deleted but not counted | FIXED |
| F7 | LOW | Rolled-back thread's staff audit row escapes cleanup | ACCEPTED — not exercised by these specs; listed in limitations |
| F8 | LOW | Divider line comment in kit | FIXED (removed) |
| F9 | LOW | FLOW-04 duplicated `createSiblingOrgUser` | FIXED (kit helper takes `features`) |
| F10 | LOW | FLOW-03 `pageOne` duplicates `commentBatch` | DISMISSED — typed wrapper keeps the spec free of casts |
