<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F4 L20a

- **Scope**: all phases (2 of 2) · **Date**: 2026-09-19 · **Verdict**: APPROVED (after fixes) · **Findings**: 0 critical, 2 warnings, 4 observations

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

| ID | Sev | Location | Finding | Decision |
|---|---|---|---|---|
| F1 | WARNING | lib/__tests__/publicationRules.test.ts | Verified-payload test compared buildId/observedBuildId against itself | FIXED — asserts fixture literals |
| F2 | WARNING | same | No proof the payload passes `recordEvidenceSchema` deployment rule / `isVerifiedDeploymentPayload` | FIXED — two assertions added |
| F3 | OBS | lib/publicationRules.ts:32 | Local payload type instead of importing from data (plan decision 6) | FIXED in plan — kept for layering, schema-parsed in tests |
| F4 | OBS | lib/publicationRules.ts:43 | `formatRevision` duplicated from commands/decisions.ts | SKIPPED — L20b may share it; not worth touching decisions.ts here |
| F5 | OBS | — | Consent codes differ from `checkDeployConsent` for unreadable/other-revision reject; L20b must fix check order | ACCEPTED — noted in FLOW-progress for L20b |
| F6 | OBS | data/entities.ts | `releaseDecisionId` hashed but not stored | DISMISSED — spec table lists exact columns; release decision is its own R21 record |
