<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-05 (L9b) report route R22 and the report query

- **Plan**: context/changes/asd-oss-t032-oss-05-l9b-add-report-route-r22-and/plan.md
- **Scope**: Phase 1 of 1 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING → PASS (test gaps closed) |

Independent sub-agent review: scoping (project by id + tenant + org, baseline through `findProjectBaseline`, tasks /
evidence / decisions by projectId + tenant + org), zero writes, complete mapping into `DeliveryReportInput` and the plan's
error codes all confirmed. A foreign project answers 404 before the revision is judged.

## Findings

### F1 — Decisions path untested
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: packages/core/src/modules/delivery_os/api/__tests__/report.route.test.ts
- **Detail**: no test stored a decision, so a broken decision mapping would pass.
- **Fix**: route test with an approved deploy decision on the result revision → `appliesToRevision: true`, on another revision → `false`.
- **Decision**: FIXED

### F2 — Scope filters on the row queries not enforced by a test
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: packages/core/src/modules/delivery_os/commands/reportQueries.ts:103-112
- **Detail**: dropping `tenantId`/`organizationId` from the tasks/evidence/decisions `where` would not fail any test.
- **Fix**: the same route test asserts every `findWithDecryption` call carries projectId + tenant + org, and seeds a same-project evidence row and decision in a foreign org that must not appear.
- **Decision**: FIXED

### F3 — Empty or over-long revision answered 400 instead of 422
- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: packages/core/src/modules/delivery_os/data/validators.ts (reportQuerySchema)
- **Detail**: zod min/max on `revision` produced `400 validation_failed`; the plan says every unparsable revision → `422 invalid_revision`.
- **Fix**: `revision: z.string().optional()`; the parser (bounded by `sourceRevisionSchema`) rejects empty / long refs with 422; tests added; live check `?revision=` → 422.
- **Decision**: FIXED

### F4 — Evidence and decisions loaded without a query cap
- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/reportQueries.ts:105-112
- **Detail**: the builder needs every row of the baseline to decide AC status; capping the query would silently change results. Accepted in plan review F3 and recorded in the hand-over's known limits.
- **Fix**: none for the hackathon.
- **Decision**: ACCEPTED
