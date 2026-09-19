<!-- IMPL-REVIEW-REPORT -->
# Implementation review: OSS / EXEC / UI merge

- Plan: ../plan.md
- Scope: integration preparation for phases2–6
- Date: 2026-09-19
- Verdict: APPROVED for source integration; runtime acceptance pending

## Sources

Local HEAD `67aa2d1f8` contains main `d403ca1f9`, dev-mateusz `a74cfe8ff`
and feature/design-ui `0b1cce284`. No push. Pre-merge local work restored;
emergency stash retained. Existing HTTP service still runs the older build.

## Review

Independent review found no critical semantic conflict in DI, report/candidate
context, publication or FLOW gates. Both service sets and guards survive the merge.
Updated unit fixtures now represent nominated candidates and current report
metadata. Refusal status/code, no-write assertions, scoped reads, append-only
checks, polling/race/history and UI permissions remain enforced.
The safe evidence projection now combines validated fields immutably; its
allowlist/schema and output behavior are unchanged.

### F1 — Candidate ordering in route harness

- Severity: WARNING
- Impact: LOW — deterministic test correctness
- Location: delivery_os/api/__tests__/routeTestKit.ts
- Detail: stage entities were sorted, but nominations were returned in insertion order.
- Decision: FIXED. Candidate ordering now follows the query; regression selects version2
  over version1 while excluding version3 belonging to another organization.
- Validation: ordering and candidate route suites5/5 PASS.

## Validation boundaries

Local runner, cached dependencies, serial Jest. The initial full run exposed31
failures among2043 tests; these are retained as pre-fix evidence. Backend targeted
190/190, FLOW7/7, UI49/49 PASS after fixture updates. Final aggregate is recorded
in ../evidence/team-merge-unit.json once the complete run finishes.
No new build, generation, migration or HTTP/E2E result is claimed by this review.
The release-candidate migration remains unapplied; old HTTP evidence cannot be
reused as acceptance for the merged source.
