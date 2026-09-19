---
date: 2026-09-19T02:00:00+02:00
researcher: autodev (Claude)
git_commit: 9341d9a6d
branch: dev-mateusz
repository: open-mercato
topic: "Frozen v1 contract fields, enums and rules for delivery_os/lib/contracts.ts and hash.ts; repo conventions for zod, jest and hashing"
tags: [research, delivery_os, contracts, zod, hash]
status: complete
last_updated: 2026-09-19
last_updated_by: autodev (Claude)
---

# Research: v1 contracts, canonical hash and error catalogue (T004, OSS-02 L1a)

## Research Question

Which exact field names, enums and rules do the frozen v1 spec and the master plan define for the
delivery contracts, and which repo conventions (zod version, jest layout, hashing) apply?

## Summary

- The executable contract must match `.ai/specs/2026-09-18-delivery-os-hackathon.md` § *Contracts v1* and
  § *Error body and code catalogue* (frozen in T003, handed to UI/EXEC/QA). The master plan
  § *Kontrakty między stanowiskami* (plan.md:115-123) and § *Prawda o kosztach i dowodach* (plan.md:196-198) give the rules.
- `schemaVersion` is a **typed string per document** (`delivery.task-package/v1`, …), not a number
  (spec:167-179). `parseVersioned` therefore takes a map `schemaVersion string → zod schema`; a missing,
  non-string or unknown value, or a value of another document type, is rejected before shape validation.
- The rejection code in the frozen spec is **`unsupported_schema_version`** (422), while the T004 text
  (derived from the older breakdown) says `unknown_schema_version`. The spec changelog (spec:402) and the
  recorded T003 decision state that the spec catalogue is authoritative over breakdown names.
- zod is `^4.4.3` in `packages/core/package.json:253` (installed 4.4.3). `z.function()` is not a schema in
  zod 4; callbacks are modelled with `z.custom<T>((value) => typeof value === 'function')`
  (`packages/core/src/modules/staff/lib/time-tracking/componentContracts.ts:16`).
- Jest: `packages/core/jest.config.cjs`, tests live in `lib/__tests__/*.test.ts`
  (e.g. `packages/core/src/modules/customers/lib/__tests__/`). Run with
  `yarn workspace @open-mercato/core jest <path> --maxWorkers=2`; typecheck `yarn workspace @open-mercato/core typecheck`.
- No shared canonical-JSON helper exists; `createHash('sha256')` from `node:crypto` is used directly
  (`packages/shared/src/lib/encryption/kms.ts`). A local `lib/hash.ts` is the right place.
- `packages/core/src/modules/delivery_os/` does not exist yet; this task creates only `lib/`. No
  `index.ts` yet, so module auto-discovery and `yarn generate` are not involved.

## Detailed Findings

### Contract fields (spec:165-181, plan.md:117-123)

| Contract | schemaVersion | Rules |
|---|---|---|
| SourceRevision | — | `git {commitSha}` \| `snapshot {contentHash, externalWorkspaceId}`; strict, so a snapshot carrying `commitSha` is rejected |
| TaskPackage v1 | `delivery.task-package/v1` | `baseRevision` always; `baseCommit` required and equal to `commitSha` for git, absent for snapshot; `validationProfile {version, requiredTests{acId: testId[]}, checks[]}`; `limits`; `idempotencyKey` |
| ResultManifest v1 | `delivery.result-manifest/v1` | correlation fields; `baseRevision`/`resultRevision` always; `baseCommit`/`resultCommit` for git only; `checks[]` status `passed/failed/not_run` (runner `skipped` is not a status); `agentDeclaration` separate; `usage {source, values \| 'unknown'}` |
| BaselineContent v1 | `delivery.baseline-content/v1` | requirements + AC with stable ids, screens (`attachmentId, sha256, fileKey, nodeId, capturedAt, figmaVersion?`), tokens, plan summary, `acTestMap`, `manualChecks`, attachment refs with hashes, `importedManifestHashes[]` |
| RequirementsProposal v1 | `delivery.requirements-proposal/v1` | `projectId, manifestId, requirements[], acceptanceCriteria[], questions[], risks[], producedBy {tool, sessionRef}` |
| PlanProposal v1 | `delivery.plan-proposal/v1` | `projectId, baselineId, baselineHash, manifestId, architectureSummary, tasks[{proposalTaskKey,title,description,acIds,dependsOn,allowedPaths}], acTestMap, declaredTests[{testId,file}]` |
| DesignManifest v1 | `delivery.design-manifest/v1` | `screens[…], tokens` |
| ExecutionAttempt v1 | — (stored JSON) | fields and states from spec:126 |
| ExecutionWidgetContext v1 | `delivery_os.project.execution.v1` | spec:213 |

`DeliveryReport v1` is listed in the spec but belongs to OSS-05 (`lib/deliveryReport.ts`); it is outside T004.

### Rules that tests must derive from the plan text

- plan.md:123 — git needs commits, snapshot must not invent a commit SHA.
- plan.md:121 — PASS needs no failed/skipped/not_run; status enum is only `passed/failed/not_run`.
- plan.md:198 — `usage unknown` is not cost 0.
- plan.md:135 — tenant/org come from the session, never from a manifest → no scope fields in DTOs.
- plan.md:260 — "nieznana wersja manifestu jest odrzucana".

### Error catalogue

Spec:300-339 lists 47 codes with HTTP status. Mapping of T004/breakdown names to the frozen codes:
`unknown_schema_version → unsupported_schema_version`, `scope_not_found → not_found`,
`stale_record → optimistic_lock_conflict`, `active_attempt_exists → attempt_active`,
`attempt_terminal → attempt_not_active | attempt_closed | attempt_cancelled`,
`late_result → attempt_cancelled | attempt_closed`, `illegal_allowed_path → path_not_allowed`,
`dependency_cycle → cycle`, `not_ready → task_not_ready`. The remaining T004 names already match.

## Code References

- `.ai/specs/2026-09-18-delivery-os-hackathon.md:126` — ExecutionAttempt v1 fields
- `.ai/specs/2026-09-18-delivery-os-hackathon.md:165-181` — contracts table
- `.ai/specs/2026-09-18-delivery-os-hackathon.md:300-339` — error body and catalogue
- `context/changes/autonomous-software-delivery/plan.md:115-123,196-198` — contract rules
- `packages/core/src/modules/staff/lib/time-tracking/componentContracts.ts:16` — callback schema idiom
- `packages/core/jest.config.cjs` — jest config for core

## Architecture Insights

Contracts are pure data/zod with no DI, ORM or platform imports, so EXEC can import them from
`@open-mercato/core/modules/delivery_os/lib/contracts` and the decoupling test stays green.

## Historical Context

- `context/changes/asd-oss-t003-oss-01-write-the-oss-and-enterprise/` — froze names and codes.
- `context/changes/delivery-os-oss-domain/handover/OSS-01-api-and-tests.md` — hand-over to other streams.

## Open Questions

None blocking. Fixtures (`lib/fixtures/*.v1.json`) and `lib/targetProfiles.ts` are the next task (L1b).
