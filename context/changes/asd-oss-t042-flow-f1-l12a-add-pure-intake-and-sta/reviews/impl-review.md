<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F1 L12a — Pure Intake and Stage-Artifact Rules

- **Plan**: context/changes/asd-oss-t042-flow-f1-l12a-add-pure-intake-and-sta/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 3 warnings (fixed), 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (W3 drift fixed) |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS — 5 suites / 173 tests green, scoped tsc and eslint clean |

## Findings

### F1 — Proposal ref already on the intake was silently overwritten

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/lib/intakeRules.ts (mergeScopingProposal)
- **Detail**: Replay only consulted `importedManifests`; an existing ref with the same `proposalId` was replaced (status reset to `proposed`).
- **Fix**: Replay also reads `intake.proposals[].contentHash`: same hash → duplicate, other → `idempotency_conflict`; refs are never replaced. Tests added.
- **Decision**: FIXED

### F2 — Merge into a submitted intake could leave it submitted with an unanswered blocking question; agent could pre-answer

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: intakeRules.ts (mergeScopingProposal / mergeQuestions)
- **Detail**: Violates the submit rule and "agent proposes, human answers".
- **Fix**: New agent questions arrive with `answer: null`; if the merged intake is no longer submittable, the step returns to `review`. Tests added.
- **Decision**: FIXED

### F3 — downstreamNowStale followed the fixed order, not the pinned template graph

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: packages/core/src/modules/delivery_os/lib/stageArtifacts.ts (downstreamStagesWithArtifacts)
- **Detail**: A non-linear template would report unrelated stages as stale.
- **Fix**: Transitive walk over the template `dependsOn`, restricted to approval stages that have an artifact. Branched-template test added.
- **Decision**: FIXED

### O1 — Newer unapproved upstream answers 422 stage_not_approved, not 409 stage_artifact_stale

- **Severity**: OBSERVATION
- **Dimension**: Plan Adherence
- **Detail**: Intended by plan decision 7 (approval before currency; the spec F7 row lists `stage_not_approved` for "upstream not approved/current"). Asserted in tests.
- **Decision**: DISMISSED — intended

### O2 — Scope content of a proposal is not stored by the pure merge; importedManifests uncapped; stored.projectId not cross-checked

- **Severity**: OBSERVATION
- **Detail**: Persistence of the proposal document and loading the row by path project are L13 command duties; the 50-proposal cap bounds importedManifests 1:1.
- **Decision**: DEFERRED to L13 (noted in hand-over)

### O3 — Approval stages chained only through non-approval stages are ignored

- **Severity**: OBSERVATION
- **Detail**: Same semantics as `computeStageCurrency`; the template schema only allows approval stages to depend on upstream approval stages.
- **Decision**: DISMISSED
