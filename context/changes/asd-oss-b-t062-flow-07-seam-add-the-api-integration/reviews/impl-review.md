<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: TC-DELIVERY-FLOW-07-publications

- **Plan**: context/changes/asd-oss-b-t062-flow-07-seam-add-the-api-integration/plan.md · **Scope**: all phases · **Date**: 2026-09-19
- **Verdict**: APPROVED (after fix) · **Findings**: 1 critical (fixed), 1 warning, 1 observation

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING (F1 fix touches a command, unplanned but required) |
| Safety & Quality | PASS after F1 |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (1.3 manual pending) |

| ID | Sev | Finding | Decision |
|----|-----|---------|----------|
| F1 | CRITICAL | `commands/publications.ts` created `DeliveryPublication` without an `id` (DB default `gen_random_uuid()`), so `publicationId` was `undefined` when the response was built → ZodError → 500 after commit on a real DB; the jest kit hid it by assigning ids in `em.create`. The spec's 201 assertions would have failed. | FIXED — `id: randomUUID()` (same as `evidence.ts`); `publications.test.ts` no longer fakes the publication id (9 cases fail without the fix, 21/21 with it). |
| F2 | WARNING | Spec cannot run here (lane A owns :3100). | ACCEPTED — human blocker, run after merge + restart. |
| F3 | OBS | Persistent event/queue rows and attachment audit rows are not cleaned up; OSS-001 leaves them too. | DISMISSED — same as the existing pattern. |
