<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F3 L19 — report flow section and workflow seams

- **Plan**: context/changes/asd-oss-b-t058-flow-f3-l19-expose-the-flow-section/plan.md
- **Scope**: all phases  |  **Date**: 2026-09-19  |  **Reviewer**: one read-only unanchored sub-agent
- **Verdict (after fixes)**: APPROVED  |  **Findings**: 0 critical, 2 warnings, 6 observations

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after F1) |
| Architecture | PASS (after F3) |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated); manual pending |

| ID | Sev | Finding | Decision |
|---|---|---|---|
| F1 | WARNING | `decisionId`/`clientApproved` came from the latest decision on the current artifact while `approvedArtifact` is the last approved version → mixed rows | FIXED — `approvingDecisionOf` binds both to the approving decision (lib/flowStatus.ts); tests for v2-rejected and client-less approval |
| F2 | WARNING | Tests could not catch F1; "byte-identical" compared new code to itself | FIXED — 2 new tests; stored snapshot generated from the HEAD (pre-change) reportQueries/route |
| F3 | OBS | reportQueries imported flowQueries (pulls stages.ts) | FIXED — `readPinnedTemplate`/`readPinnedTemplateRef` exported from flowGate.ts; flowQueries untouched |
| F4 | OBS | flow section ignores `baselineId`/`revision` | FIXED — documented in openApi description and spec changelog |
| F5 | OBS | FLOW-F3.md error code wording for trusted execution | FIXED — `403 forbidden` + detail |
| F6 | OBS | FLOW-F3.md evidence pointer without numbers | FIXED — T058 result in FLOW-progress.md |
| F7 | OBS | DI override order claim unproven | FIXED — reworded with the check Marcin must do |
| F8 | OBS | fakes.ts comment overstated v2 | FIXED — comment reworded; report assertion in pin test not added (pin-test projects have no baseline → R22 404) |
