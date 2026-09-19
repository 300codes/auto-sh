# OSS-03 (L7d): Plan-Proposal Import — Plan Brief

> Full plan: `context/changes/asd-oss-t022-oss-03-l7d-add-plan-proposal-import/plan.md`
> Research: `context/changes/asd-oss-t022-oss-03-l7d-add-plan-proposal-import/research.md`

## What & Why

The planning agent proposes architecture, tasks, `allowedPaths`, dependencies and the AC→test map. The system decides:
`delivery_os.tasks.import_plan` validates the proposal against the approved baseline and, only if everything holds,
creates the merged baseline and the draft tasks atomically. A human then approves the merged baseline.

## Starting Point

Pure validation (`validatePlanProposal`), the requirements import pattern and the ready gate exist. R10 answers
`400 unsupported_source` for `plan_proposal`.

## Desired End State

One POST turns an agent plan into a reviewable merged baseline + task graph; retries are harmless
(`200 duplicate: true`, same ids); hallucinated ACs/tests, escaping paths, cycles, foreign or unapproved baselines
are refused with nothing persisted.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Merged baseline activation | new version, `activeBaselineId` untouched | human approves merged baseline | Breakdown §7 |
| Precedence | 404 → manifest → replay → 428 → 409 → baseline → approval → content | replay must not need a header or an approved parent | T019/T021 |
| Project write | plan sections copied to `draftSpec`, `projectUpdatedAt` returned | later manual freeze keeps the plan; agent continues without GET | Plan |
| Race recovery | unique violation → replay lookup → duplicate | one path for version/hash/task-key uniques | Plan |
| Body cap | 1 MB on R10 | bounded input | Plan |

## Scope

**In:** `lib/proposals.ts` identity + provenance, `commands/planImport.ts`, R10 wiring, schemas/openApi, unit + route tests, spec, hand-over.
**Out:** migrations, UI/i18n, design import, scope-change rules for old tasks, QA integration specs.

## Phases at a Glance

| Phase | Delivers | Key risk |
|---|---|---|
| 1. Domain | command + lib change + command tests | hash of merged content changes (additive `importedManifests`) |
| 2. API | R10 dispatch, schemas, route tests, docs | strict schema copies in other streams |

**Prerequisites:** T019–T021 landed. **Effort:** one session.

## Open Risks & Assumptions

- UI-03 proposal contract is assumed to be the frozen `PlanProposal v1`.
- Other streams' strict `BaselineContent` copies must already allow `importedManifests` (requested in T021).

## Success Criteria (Summary)

- Rejected plan → zero rows; success → 1 baseline + N tasks in one transaction; replay → same ids.
- Imported tasks cannot go `ready` before both decisions on the merged baseline.
