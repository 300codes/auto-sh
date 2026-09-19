<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: TC-DELIVERY-OSS-001 — v1 manual flow on the real database

- **Plan**: context/changes/asd-oss-t050-oss-06-add-a-self-contained-api-inte/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after F1/F2 |
| Architecture | PASS |
| Pattern Consistency | PASS after F5 |
| Success Criteria | PASS (spec green 7×, jest 66/1477, core typecheck, eslint 0) |

Evidence: one independent read-only reviewer (plan drift + safety + patterns in one pass; memory rule), automated criteria re-run by the author.

## Findings

### F1 — Teardown gap when seeding fails midway
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: spec `seedReadyTask` / `finally`
- **Detail**: `seed` is assigned only after `seedReadyTask` returns; a failure after project creation left rows and the attachment behind.
- **Fix**: module-level `createdAttachmentIds`; `afterAll` deletes every created project and attachment, then asserts zero rows (incl. attachments).
- **Decision**: FIXED

### F2 — Vacuous stale-write assertion
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: spec, stale-lock test
- **Detail**: `brief ?? 'first writer'` passed on a missing row / null brief.
- **Fix**: `expect(brief).toBe('first writer')` (project `brief` is not in `encryption.ts`).
- **Decision**: FIXED

### F3 — Race assertion tighter than plan (exactly one 201, three racers)
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence · **Location**: spec, stale-lock test
- **Detail**: plan said "at most one 201", spec asserts exactly one.
- **Decision**: DISMISSED — the first racer to take the project row lock always holds a fresh header and new content, so zero 201s would itself be a defect; the stricter check is intended (recorded in the hand-over).

### F4 — Audit rows not in the leftover count
- **Severity**: 💡 OBSERVATION · **Location**: `deliveryRowCounts`
- **Fix**: counts `action_logs` of `delivery_os%` whose resource or parent is a created project.
- **Decision**: FIXED

### F5 — Inline comments
- **Severity**: 💡 OBSERVATION · **Location**: foreign-scope and cancel tests
- **Fix**: moved both explanations into the header JSDoc.
- **Decision**: FIXED

### F6 — Foreign fixture cleanup swallows errors
- **Severity**: 💡 OBSERVATION · **Location**: `deleteForeignFixtures(...).catch`
- **Decision**: ACCEPTED — same fail-soft style as the shared `delete*IfExists` helpers; the before/after count over users/orgs/tenants/user_acls in the hand-over proves nothing leaked today.

### F7 — Org B user created without a role
- **Severity**: 💡 OBSERVATION · **Location**: `createForeignUser`
- **Decision**: ACCEPTED — ACL via `setUserAclInDb` before first login is deterministic (RBAC cache) and gives the same `delivery_os.*` grant; plan wording drift only.

### F8 (independent review) — orphan entity_indexes / search_tokens rows after SQL teardown
- **Severity**: major · **Decision**: FIXED — teardown deletes index/token rows of owned delivery_os ids and created users; `afterAll` counts them; historical orphans purged from the local DB; re-verified twice (counts identical incl. index tables).
