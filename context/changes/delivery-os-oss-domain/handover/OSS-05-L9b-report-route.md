# OSS-05 (L9b) hand-over — report route R22 and `deliveryOsReportQueries`

Task T032 · DTO version: **`DeliveryReport v1` unchanged** (`delivery.report/v1`, see `OSS-05-L9a-report-rules.md`) ·
additive: route R22, DI key `deliveryOsReportQueries`, validator `reportQuerySchema` · no migration, event, ACL feature,
error code, schema or fixture change.

## Route

`GET /api/delivery_os/projects/:id/report?baselineId=&revision=&limit=` — feature `delivery_os.projects.view`, read-only.

| Query | Meaning | Bad value |
|---|---|---|
| `baselineId` | baseline to report on; default `project.activeBaselineId` | not a uuid → `400 validation_failed`; other project / scope → `404 not_found` (`baselineId`) |
| `revision` | `git:<40 or 64 hex>` or `snapshot:<sha256>:<externalWorkspaceId>` (workspace id may contain `:`); default = newest accepted result (`revisionSource: latest_result`) | `422 invalid_revision` with detail `revision_unparsable` or `revision_kind_mismatch` (react-vite = git) |
| `limit` | max `rows[]`, 1–1000, default 1000; `truncated` + `totalRows` tell the rest | `400 validation_failed` |

Other answers: project of another tenant / organization or malformed id → `404 not_found`; no active baseline and no
`baselineId` → `404 not_found` / `no_active_baseline`; unknown pinned profile → `422 unknown_target_profile`; stored
baseline altered → `422 hash_mismatch`. Archived projects and archived tasks stay readable.

## DI (for R20 / R21 and EXEC)

```ts
const reports = container.resolve('deliveryOsReportQueries') as DeliveryOsReportQueries
const report = await reports.buildReport({ tenantId, organizationId }, projectId, { baselineId, revision, limit })
// revision: 'git:<sha>' | SourceRevision object | null; throws CrudHttpError 404 / 422 like the route
```

`deliveryOsAttemptQueries` is unchanged. R20 / R21 should read `report.gates.publishable` / `releasable` and use their
`blocking[]` as the `report_not_green` details.

## Patch requests

- **UI-05** (`components/DeliveryReport.tsx`): fetch with `apiCall` from R22; to switch revision send
  `revision=git:<commitSha>` (build it from `report.revision` or a manifest's `resultRevision`); show
  `revisionSource` (`latest_result` / `selected` / `none`) next to the revision; on `truncated` show "`rows.length` of
  `totalRows`" and offer `limit`; map `404 no_active_baseline` to an empty state ("no approved baseline yet"), `422
  invalid_revision` to a field error. Suggested i18n keys: `delivery_os.report.revisionSource.<value>`,
  `delivery_os.report.errors.no_active_baseline`, `delivery_os.report.errors.invalid_revision`,
  `delivery_os.report.truncated`. Render statuses verbatim (see L9a hand-over).
- **QA-05** (TC-DELIVERY-009): the recipe below through HTTP; also foreign org → 404, `revision=snapshot:…` on the
  react-vite profile → 422, `limit=1` → `truncated: true`.
- **EXEC**: after a result import, R22 with no `revision` reports the newest result; pass `revision` explicitly when
  reporting on the integration commit.

## Known limits

- Evidence of one baseline is read in one query (all rows with payloads) — fine for demo scale (plan review F3).
- Order: scope (404) → profile (422) → revision (422) → baseline (404) → stored hash (422); a foreign project always
  answers 404 whatever the query.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 49 suites, 1182 tests green
  (new: `api/__tests__/report.route.test.ts` 11 tests, `commands/__tests__/reportQueries.test.ts` 5 tests).
- Live on :3100 (`/tmp/t032/live.ts`, run with `./node_modules/.bin/tsx` from the repo root): project → draft →
  baseline → requirements + design approvals → ready task → reserve → package → result import → R22:
  default `AC-001=passed AC-002=missing AC-003=manual_pending source=latest_result`, selected result revision → same,
  `git:aaaa…` → `AC-001=missing`, `limit=1` → `rows=1/3 truncated=true`; every body parses with
  `deliveryReportV1Schema`; snapshot revision → `422 invalid_revision`; foreign baseline → 404; row counts and task
  `updated_at` identical before and after the GETs (no writes); smoke rows deleted afterwards.

## Master-plan Progress rows with OSS-side evidence (NOT ticked)

| Row | Evidence | Still needed |
|---|---|---|
| 5.1 report does not pass an AC without a test on the right commit/baseline; missing scan / preview verification blocks | route tests + live smoke above | R20/R21, QA-05 |
| 5.4 (manual) drill requirement → test → commit → URL | `rows[]` with `evidenceId` over HTTP | UI-05, human |
