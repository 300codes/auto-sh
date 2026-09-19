<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F4 L20c — route F14, fake deploy adapter, chain test

- **Plan**: context/changes/asd-oss-b-t061-flow-f4-l20c-add-route-f14-post-get/plan.md · **Scope**: all 3 phases · **Date**: 2026-09-19
- **Verdict**: APPROVED (0 critical, 1 warning fixed, 7 observations)
- Verdicts: Plan Adherence PASS · Scope PASS (scopeChange.test route list extended, justified) · Safety PASS · Architecture PASS · Patterns PASS · Success Criteria PASS

| ID | Sev | Finding | Decision |
|---|---|---|---|
| F1 | WARNING | GET answers `publishedAt` normalised to UTC (column is timestamptz), not the posted offset string | FIXED — documented in the GET openApi description |
| F2 | OBS | `requireIso` falls back to epoch on a bad date | DISMISSED — shared serializer idiom; columns are non-null |
| F3 | OBS | pageSize=100 case only asserted status | FIXED — asserts 3 items / total 3 |
| F4 | OBS | cross-scope list test lacked a foreign-tenant row | FIXED — foreign tenant row added |
| F5 | OBS | page-size cap duplicated as literal 100 | FIXED — `publicationListQuerySchema` uses `PUBLICATION_LIST_MAX_PAGE_SIZE` |
| F6 | OBS | `id desc` tie-break is arbitrary within one millisecond | ACCEPTED — matches Decision 5 |
| F7 | OBS | (pre-existing T060) verification evidence is only checked to belong to the project, not its kind/revision | DEFERRED — follow-up in hand-over |
| F8 | OBS | replay answers 200 without re-checking gates | FIXED — documented in POST description (by design, spec F14) |

Verification: delivery_os jest 96 suites / 1771 tests green (`--maxWorkers=2`); `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green.
