# Implementation review — T066 (integrator's diff review of the subagent work)

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | HIGH | `publications.test.ts` order test seeded the foreign-project row as kind `deployment`, tripping `expectNothingWritten` (test bug, not product) | fixed (seeded as `reference_material`) |
| 2 | LOW | `CrudHttpError` import moved an existing import line in `commands/publications.ts` | fixed (original line order kept) |
| 3 | LOW | `commands/flowQueries.ts` kept unused `flowTemplateV1Schema` / `FlowTemplateV1` imports after the dedupe | fixed |
| 4 | INFO | Hash normalisation also lowercases `publishedBy` and truncates sub-millisecond timestamps | accepted: both are the same fact; canonical payloads keep their hash |
| 5 | INFO | A `test` evidence with no checks is refused as not passed | accepted: fails closed on malformed rows |
| 6 | INFO | Kind check runs whenever `evidenceId` is non-null, also for an unverified record | accepted: stricter, no valid flow names evidence without claiming verification |

Verdict: PASS. Frozen v1 files untouched (`commands/decisions.ts`, v1 schemas); no migration, ACL, event or DI change.
