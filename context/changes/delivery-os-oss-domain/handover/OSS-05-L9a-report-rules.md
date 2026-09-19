# OSS-05 (L9a) hand-over — pure delivery report rules, `DeliveryReport v1`

Task T031 · DTO/contract version: **v1, additive** — new schema `delivery.report/v1` (`deliveryReportV1Schema`,
registered in `deliveryDocumentSchemas`), fixture `lib/fixtures/delivery-report.v1.json` (`loadDeliveryReportFixture`),
pure builder `lib/deliveryReport.ts` · no migration, route, command, event, ACL feature, DI key, error code or validator change.

## What it is

`buildDeliveryReport(input)` answers "is each AC proven on this baseline, revision and profile?" from stored rows only.
Route R22 (`GET /projects/:id/report?baselineId&revision`) and the deploy / release decision commands (R20 / R21)
are the next L9 tasks and call this function; UI-05 renders the DTO.

Input: `{ projectId, baseline: { id, projectId, contentHash, content }, tasks, evidence, decisions, profile, revision | null, limit }`.
Output: the DTO below. Default revision (`revision: null`): the newest `result_manifest` row of the baseline
(`revisionSource: 'latest_result'`); none → `revision: null`, `revisionSource: 'none'`, every AC `missing`, both gates
blocked by `{ kind: 'revision', id: 'revision', status: 'missing' }`.

## DTO (`DeliveryReportV1`)

| Field | Meaning |
|---|---|
| `acceptanceCriteria[]` | `acId, requirementId, description, status, taskIds[], tests[] { testId, status: passed/failed/not_run/missing, evidenceId, rawReportHash }, manualCheck { manualCheckId, status: approved/changes_requested/missing, evidenceId } \| null` |
| AC `status` | `failed` (a required test failed or a human `changes_requested`), `not_run` (a required test `not_run`; runner `skipped`/`todo`/`pending` count as `not_run`), `missing` (a required test has no result on the revision), `manual_pending` (only the human verdict is absent), `passed` |
| `rows[]` | requirement → AC → task → test or manual check → `evidenceId`, `rawReportHash`, `deploymentEvidenceId`; `totalRows`, `truncated`, `limit` (≤ 1000); `issues[]` = tasks naming an AC outside the baseline |
| `scans[]` | one per required profile scan: `present` (a `passed` result), `failed` (any failed result wins), `missing` (none or only `not_run`); `reportedStatus`, `evidenceId`, `rawReportHash` |
| `deployment` | newest `deployment` row on the revision: `verified` / `unverified` (+ `verificationStatus: unverified \| failed`) / `missing`; `url`, `environment`, `buildId`, `evidenceId` |
| `gates.publishable` | every AC `passed` or `manual_pending`, every required scan `present`, a revision selected |
| `gates.releasable` | publishable + every AC `passed` + latest applicable `deploy` decision `approved` + `deployment.status = verified`; `blocking[] { kind, id, status }` names each gap |
| `decisions[]` | every decision with `appliesToRevision`: `deploy` → `subjectHash = baselineHash` and same revision; `release` → same revision and `subjectId` is a deployment row on it; `requirements` / `design` → by hash |
| `progress` | `{ proven, total, unit: 'ac', percent }` — `total` is the baseline AC count, `percent: null` when 0 |
| `usage[]` | one per manifest on the revision, `values` copied through; `'unknown'` stays `'unknown'`, nothing is summed |

Rows of another project, baseline or revision never count: a task-commit result does not inherit to the integration commit.

## Decisions to know

- `manual_pending` does **not** block publish (the preview is what the human reviews) and **does** block release.
- A later `rejected` deploy decision voids an earlier `approved` one for the same hash and revision.
- The builder does not validate the revision kind against the profile; R22 answers `422 invalid_revision`.
- Rows are ordered by `createdAt` then `id` inside the builder, so the newest human verdict / deployment wins regardless of query order.
- Decisions carry `projectId` in the input and are filtered like evidence; a deploy decision whose subject is a deployment row must name a row on the selected revision.
- Array caps of the schema are enforced by the builder (`MAX_REPORT_USAGE_ENTRIES` 100, `MAX_REPORT_DECISIONS` 1000, `MAX_REPORT_ISSUES` 1000, `MAX_REPORT_BLOCKERS` 2000, `MAX_REPORT_TASK_IDS` 100).

## Tests — command and result

`yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2`

```
Test Suites: 20 passed, 20 total
Tests:       606 passed, 606 total
```

`lib/__tests__/deliveryReport.test.ts` (43 tests, wrong-vs-right pairs): no test on the revision → `missing`, not
publishable / on the revision → `passed`; `failed`, `skipped`, `not_run` each block; task-commit evidence not inherited;
foreign baseline / project earns nothing; manual AC `manual_pending` (agent approval ignored) / human approval → `passed`
/ human `changes_requested` → `failed`; missing, `not_run` and failed scans block, passed scan row or manifest scan check
is `present`; unverified deployment blocks release not publish, wrong observed build is not verified, newest deployment
row wins; decision for A → `appliesToRevision: false` on B and B not releasable / applies on A; other hash does not apply;
later reject voids; release / requirements applicability; default revision; usage passthrough; row drill-down; unknown AC
issue; truncation; fixture parses; unknown schema version → `unsupported_schema_version`; bad AC status rejected.

Scoped module suite: 47 suites, 1166 tests green. Scoped `tsc` (new files + generated) exit 0. `eslint` on the touched files exit 0.

## Patch requests

- **UI-05**: render `status` values verbatim (never map `not_run` / `missing` / `manual_pending` / `unverified` to success);
  drill from `rows[].evidenceId` and `scans[].evidenceId` / `deployment.evidenceId`; show `gates.*.blocking` as the reason list;
  `usage[].values === 'unknown'` renders as unknown, not 0. i18n keys suggested: `delivery_os.report.status.<status>`,
  `delivery_os.report.gate.<kind>`.
- **QA-05**: TC-DELIVERY-009 candidates = the pairs above, driven through R22 once it lands.
- **EXEC**: the runner may report the required scan inside the manifest `checks[]` (`checkId: dependency-audit`) or as a
  `scan` evidence row; both count, `failed` dominates on a revision.

## Master-plan Progress rows with OSS-side evidence (NOT ticked)

| Row | Evidence | Still needed |
|---|---|---|
| 5.1 report does not pass an AC without a test on the right commit/baseline; missing security check or preview verification blocks | `deliveryReport.test.ts` pairs | R22 route + R20/R21 (next L9 tasks), QA-05 |
| 5.4 (manual) operator drills requirement → test → commit → URL | DTO carries the links | UI-05, human |
