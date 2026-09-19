# OSS-03 (L7d) hand-over — plan-proposal import on R10

Task T022 · DTO/contract version: **v1, additive** · no migration, no generated file, no workspace change.

## What works

`POST /api/delivery_os/projects/:id/tasks` with `{ "source": "plan_proposal", "manifest": <PlanProposal v1> }`
(`delivery_os.results.import`, project optimistic-lock header, body ≤ 1 000 000 bytes):

| Case | Answer |
|---|---|
| valid plan for the ACTIVE baseline with requirements + design approved for its hash/version | `201 { baselineId, version, contentHash, duplicate: false, tasks: [{ id, proposalTaskKey, updatedAt }], projectUpdatedAt }` — one transaction: merged baseline n+1 (`source: plan_proposal`, `parentBaselineId`), draft tasks pinned to it (`dependsOn` keys → task ids), plan section copied into `draftSpec` |
| same `manifestId` + same content again (any / stale / no header, also after the merged baseline became active) | `200 { …, duplicate: true }` — same baseline, same live task ids, no write, no event |
| same `manifestId`, other content | `409 idempotency_conflict` |
| baseline not active / a decision missing or rejected | `422 baseline_not_approved` (`baseline_not_active`, `<kind>_decision_missing`, `<kind>_rejected`) |
| foreign baseline / project, plan made for another content hash | `422 foreign_reference` (`foreign_baseline`, `foreign_project`, `baseline_hash_mismatch`) |
| stored parent content altered after approval | `422 hash_mismatch` |
| hallucinated AC / test id, path escape, cycle, AC without tests | `422 unknown_ac` / `unknown_test_id` / `path_not_allowed` / `cycle` / `missing_required_tests` — nothing persisted |
| first import without / with a stale header | `428 optimistic_lock_required` / platform `409 optimistic_lock_conflict` |
| manage-only user | `403 forbidden` |
| body over the cap (both sources) | `413 payload_too_large` |

Precedence: 404 → manifest schema/project → replay (200/409) → 428 → platform 409 → baseline found → stored hash intact → approval → plan content.

- **The merged baseline is NOT activated.** It is a new version and needs its own requirements + design decisions
  (R8 with its `contentHash` and `version`). Until then its tasks answer `422 baseline_not_approved` on `→ ready`;
  after both approvals `activeBaselineId` flips (existing decision command) and the tasks can go `ready`.
- `projectUpdatedAt` is the next project lock value (the import bumps the project).
- Replay returns live tasks only; an archived imported task is neither returned nor re-created.
- Existing tasks pinned to the parent baseline are left untouched.
- Emits `delivery_os.task.updated` per created task (after commit); no new event ids.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 35 suites, 862 tests, all green
  (new: `commands/__tests__/planImport.test.ts`, R10 block in `api/__tests__/tasks.route.test.ts`, `lib/__tests__/proposals.test.ts`).
- Temporary tsconfig type-check of module + tests: no error in touched files; eslint clean on touched files.
- Live smoke on :3100 (`/tmp/t022/live.ts`, not in the repo): 21/21 — requirements import → both approvals → rejections
  (428, 409, path escape, false test, unknown AC, cycle, foreign baseline; zero tasks after) → 201 v2 + 2 tasks → replay 200
  same ids → 409 conflict → task `→ ready` 422 `baseline_not_approved` → approve merged → gate passes → replay still 200.
- Master-plan Progress rows with evidence: **3.3**, **3.6** (joint acceptance stays with humans).

## Patch requests to other streams

- **UI**: i18n key `delivery_os.audit.tasks.import_plan`; after a 201 show the merged baseline for review (it is
  inactive until both decisions) and use `projectUpdatedAt` as the next lock value; detail codes to translate:
  `baseline_not_active`, `<kind>_decision_missing`, `<kind>_rejected`, `baseline_hash_mismatch`, `idempotency_conflict`.
- **EXEC** (`plan-from-baseline` skill): read `baselineId` + `contentHash` of the ACTIVE baseline, generate a fresh
  `manifestId` per session, retry the same body on network errors (idempotent).
- **QA** (`TC-DELIVERY-004`): scenario = the live smoke above; fixtures must approve the parent baseline first.

## Limitations

- A plan can only target the active approved baseline; re-planning after the merged baseline is approved targets that one.
- The draft sync is a shallow copy of four sections (test mappings only for AC ids the draft still has); it never parses or validates the stored draft.
- Local environment: `yarn dev` (full) was SIGKILLed twice by the memory guard during the turbo core build and left a partial `packages/core/dist`; recovered with `yarn workspace @open-mercato/core build` and the server now runs as `yarn dev:app` (no package watchers) on :3100.
