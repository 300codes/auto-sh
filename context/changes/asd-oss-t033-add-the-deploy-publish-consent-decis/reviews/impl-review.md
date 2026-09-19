<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-05 (L9c): deploy (publish consent) decision and route R20

- **Plan**: context/changes/asd-oss-t033-add-the-deploy-publish-consent-decis/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-09-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Review done inline (small diff: 1 command, 1 new route, 1 schema, test kit option, tests, docs). Checked: scope 404 before
any write; lock header 428/409 path identical to requirements/design (header check before scope lookup, same as the
existing baseline path); report gate read after `lockProjectForWrite` (FOR UPDATE), so a concurrent evidence/result write
serializes behind the decision; reject never consults the report; append-only insert with `subjectType baseline`,
`subjectHash = contentHash`, `subjectVersion`, stored `sourceRevision`; `project.updatedAt` bumped inside the tx;
the baseline decisions route refuses deploy/release so `baselines.approve` cannot bypass `deploy.approve`.

`yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 50 suites / 1199 tests passed.

## Findings

### F1 — `sourceRevision: null` answers 400, not 422 report_not_green

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: packages/core/src/modules/delivery_os/data/validators.ts:491
- **Detail**: The task text lists "revision null → 422 report_not_green". The frozen `deployDecisionSchema` (DTO v1) requires a `sourceRevision`, so null is a 400 `validation_failed`; the plan chose this deliberately and covers the "revision with no results" case as 422 `report_not_green` naming the revision blocker.
- **Fix**: None — changing the frozen validator would break DTO v1; documented in the hand-over.
- **Decision**: DISMISSED — deliberate plan decision, frozen contract.

### F2 — No explicit entry in `api/openapi.ts`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: packages/core/src/modules/delivery_os/api/openapi.ts
- **Detail**: The task asked to "register it in api/openapi.ts", but that file holds only the tag and factories; every delivery_os route self-registers through its exported `openApi` doc picked up by `yarn generate`.
- **Fix**: None — follows the existing pattern.
- **Decision**: DISMISSED — pattern-consistent.

### F3 — Report built on a forked EM inside the write transaction

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/decisions.ts (recordDeployDecision)
- **Detail**: `buildReport` reads on a second connection while the tx holds the project row lock. Plain SELECTs do not wait on FOR UPDATE, so there is no deadlock; evidence/attempt writers take the same project lock, so the report cannot miss a concurrent commit. Relies on that ordering staying in place (recorded in plan Critical Implementation Details).
- **Fix**: None needed.
- **Decision**: ACCEPTED
