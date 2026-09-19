<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-05 L9a — pure delivery report rules

- **Plan**: context/changes/asd-oss-t031-oss-05-l9a-add-pure-delivery-report/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 1 critical, 3 warnings, 4 observations (independent reviewer sub-agent, read-only)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS (spec changelog + hand-over are the usual OSS deliverables) |
| Safety & Quality | PASS after F1 |
| Architecture | PASS (pure module, reuses acProof / traceability / projectStatus / evidenceRules) |
| Pattern Consistency | PASS |
| Success Criteria | PASS (lib 20 suites / 606 tests, module 47 suites, scoped tsc 0, eslint 0) |

## Findings

### F1 — Manual-check verdict depended on input order

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: lib/deliveryReport.ts (scoped rows), lib/acProof.ts#collectManualVerdicts (last write wins)
- **Detail**: rows were passed in caller order; `[changes_requested @10:00, approved @09:00]` (DB DESC order) made AC-003 `passed`.
- **Fix**: sort scoped rows by `createdAt` then `id` (`compareByCreation`) before proving; test with both orders.
- **Decision**: FIXED

### F2 — totalRows / truncated ignored a skeleton overflow

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: lib/deliveryReport.ts (buildDeliveryReport rows)
- **Fix**: `totalRows` starts at `skeleton.totalRows - skeleton.rows.length`; `truncated ||= skeleton.truncated`.
- **Decision**: FIXED

### F3 — Builder could emit arrays the schema caps reject

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: lib/contracts.ts caps for usage / decisions / issues / blocking / taskIds
- **Fix**: builder slices to exported `MAX_REPORT_*` constants matching the schema caps.
- **Decision**: FIXED

### F4 — Deploy decisions on a deployment subject skipped the hash / revision-row checks

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: lib/deliveryReport.ts#decisionApplies
- **Fix**: any `deployment_evidence` subject must name a deployment row on the revision; requirements/design apply only to baseline subjects; tests added.
- **Decision**: FIXED

### F5 — `manual_pending` does not block publish

- **Severity**: 💡 OBSERVATION
- **Dimension**: Plan Adherence
- **Detail**: intentional plan decision #1 (publish = automated proof; the human reviews the preview; release needs every AC passed). Documented in plan, spec changelog and hand-over.
- **Decision**: DISMISSED (documented decision)

### F6 — Timestamp ties resolve by input order

- **Severity**: 💡 OBSERVATION
- **Detail**: after F1 rows are ordered by createdAt then id, so ties are deterministic; decisions are monotonic in `commands/decisions.ts`.
- **Decision**: ACCEPTED

### F7 — Scan check path accepted checks without `sourceRevision`

- **Severity**: 💡 OBSERVATION
- **Fix**: `looseCheckSchema` now requires `sourceRevision`, aligned with acProof.
- **Decision**: FIXED

### F8 — Decisions were not project-scoped inside the builder

- **Severity**: 💡 OBSERVATION
- **Fix**: `DeliveryReportDecision.projectId` added and filtered like evidence; test added.
- **Decision**: FIXED

## Test gaps closed
Both verdict orders; deploy decision with `sourceRevision: null`; deploy decision on a foreign deployment row and from another project; deploy decision on the verified deployment row; `uploadStatus: 'failed'`; `failed` sticky across two manifests on one revision.
