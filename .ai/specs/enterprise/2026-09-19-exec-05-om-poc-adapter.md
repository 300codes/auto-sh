# EXEC-05: OM PoC — Open Mercato module adapter

**Status:** Draft — 2026-09-19
**Refs:** EXEC-04 (`2026-09-19-exec-04-execute-api-and-workflow.md`), EXEC-05 delivery-completion (`2026-09-19-exec-05-delivery-completion.md`)

---

## TLDR

The `openMercatoModuleV1` target profile already exists in `targetProfiles.ts` but has an empty `testCatalogue` and has never been exercised end-to-end. This spec proves the TaskPackage v1 / ResultManifest v1 contracts work for an OM module target — not just React. The deliverable is a completed export → run → import cycle on a chosen OM module, with a fresh `ResultManifest v1` correlated with a real attempt and baseline. No new engine, no new contract surfaces; additive changes to the existing profile only.

---

## Problem Statement

1. `openMercatoModuleV1.testCatalogue` is `[]` — there are no declared test IDs, so the `requiredTests` validator has nothing to map ACs against. Any OM task result would fail with `missing_required_tests` on the first check.
2. `openMercatoModuleV1.allowedPathRoots` is `['src/modules/**']`. The `auto-sh` monorepo places modules at `packages/core/src/modules/`, so any task `allowedPaths` rooted there would be rejected by `checkAllowedPathsForProfile` with `outside_profile_roots`. The root must be updated to match the actual repo layout before the PoC can be run.
3. No fixture task-package or result-manifest fixture for `open-mercato-module` exists; the existing fixtures all use `react-vite`.
4. The PoC has never been run: the `delivery-cezar` runner has only been tested against the React demo repo. The OM toolchain differs (`yarn jest --maxWorkers=2`, `yarn typecheck`, `yarn npm audit --severity high`) and the path scope must match the corrected profile root.
5. The plan criterion 5.3 (DTO does not force React) and 5.5 (real validation result correlated with attempt + baseline) have no evidence.

---

## Scope

| # | Item | Owner | Phase |
|---|------|-------|-------|
| 1 | Select OM target module + map ACs to real test IDs | Marcin | 1 |
| 2 | Fix `openMercatoModuleV1.allowedPathRoots` to `['packages/core/src/modules/**']` | Marcin | 1 |
| 3 | Populate `openMercatoModuleV1.testCatalogue` with declared test IDs | Marcin | 1 |
| 4 | Add `task-package.open-mercato.v1.json` fixture | Marcin | 1 |
| 5 | Add `result-manifest.open-mercato.v1.json` fixture | Marcin | 1 |
| 6 | Add contract test `targetProfiles.open-mercato.test.ts` | Marcin | 1 |
| 7 | Run the PoC: export → Cezar (or manual) → import | Marcin | 2 |
| 8 | Deliver evidence to QA (attempt ID, baseline hash, manifest hash, evidence ID) | Marcin | 2 |
| 9 | Write TC-DELIVERY-009 integration spec (OSS) | Marcin | 2 |

Out of scope: changes to the `delivery-cezar` runner internals, new OSS API routes, modifications to OSS command logic, Faza 2 live executor (EXEC-05 delivery-completion covers that).

---

## Proposed Solution

### Profile root fix

Before any PoC run, `openMercatoModuleV1.allowedPathRoots` must be updated in `targetProfiles.ts`:

```typescript
// before
allowedPathRoots: ['src/modules/**'],

// after
allowedPathRoots: ['packages/core/src/modules/**'],
```

This is a one-line change to the constant. It is additive: the profile version stays at `1` because the old root was unusable against `auto-sh` — no existing passing test or fixture relied on tasks with `src/modules/**` paths. If a future OM target is a standalone app with a `src/modules/` layout, a second profile entry (`open-mercato-module@2`) can extend coverage; this change does not close that door.

### Target module selection

Use the `auto-sh` repository as the delivery target. The chosen module for the PoC is the `example` module (`packages/core/src/modules/example/`) or, if that module has insufficient test coverage, the `delivery_os` lib tests (`packages/core/src/modules/delivery_os/lib/__tests__/`). The implementer (Marcin) picks the concrete module before Phase 1 and records the choice in the spec progress table.

**Selection criteria:**
- Module has ≥ 2 passing Jest tests with stable, predictable full names (the `testId` is the Jest `fullName` string)
- Tests complete in under 60 s on a cold `yarn jest --testPathPattern=packages/core/src/modules/<module>` invocation
- Module passes `yarn typecheck` with zero errors
- `yarn npm audit --severity high` exits 0 on its dependency tree

**Fallback:** if the chosen module fails the audit check, note the finding in evidence and mark the `yarn-audit` check as `not_run` in the hand-authored manifest. The other two checks (`jest-module`, `typecheck`) must still pass.

### Test catalogue entries

The implementer lists the chosen test IDs here before writing any code. Example shape (replace with real Jest `fullName` strings from the chosen module):

```json
[
  {
    "testId": "<module> AC-OM-001: <test description>",
    "file": "packages/core/src/modules/<module>/__tests__/<file>.test.ts"
  },
  {
    "testId": "<module> AC-OM-002: <test description>",
    "file": "packages/core/src/modules/<module>/__tests__/<file>.test.ts"
  }
]
```

These entries are added to `openMercatoModuleV1.testCatalogue` in `packages/core/src/modules/delivery_os/lib/targetProfiles.ts`.

### TaskPackage v1 fixture for OM

New file: `packages/core/src/modules/delivery_os/lib/fixtures/task-package.open-mercato.v1.json`

Key differences from the React fixture:
- `targetProfileId: "open-mercato-module"`, `targetProfileVersion: 1`
- `repositoryRef: "auto-sh"` (or the real repo ref used during the run)
- `baseRevision: { "kind": "git", "commitSha": "<head-commit-of-the-run>" }`
- `allowedPaths: ["packages/core/src/modules/<chosen-module>/**"]`
- `validationProfile.checks` matches the `open-mercato-module` profile: `jest-module`, `typecheck`, `yarn-audit`
- `validationProfile.requiredTests` maps each AC to its declared `testId`s from the catalogue
- No `designArtifactRefs` (OM PoC is code-only, no Figma)

The fixture is written after the test catalogue is settled and before the PoC run.

### ResultManifest v1 fixture for OM

New file: `packages/core/src/modules/delivery_os/lib/fixtures/result-manifest.open-mercato.v1.json`

Shape mirrors the existing `result-manifest.v1.json` but:
- `targetProfileId: "open-mercato-module"`
- `sourceRevision: { "kind": "git", "commitSha": "<result-commit>" }`
- `checks[]` entries use `commandProfileId` values from the OM profile (`jest-module`, `typecheck`, `yarn-audit`)
- `checks[].testId` values drawn from the declared catalogue
- `rawReportHash` is the SHA-256 of the real `jest --json` output from the run

The manifest is produced by `delivery-cezar` during the PoC run (Phase 2). A stub version is created in Phase 1 for contract testing.

### Contract tests

New file: `packages/core/src/modules/delivery_os/lib/__tests__/targetProfiles.open-mercato.test.ts`

Cases:
1. `openMercatoModuleV1` parses without error through `targetProfileSchema` (validates the populated catalogue)
2. `buildTaskPackageV1` with `open-mercato-module` inputs produces a valid `TaskPackageV1` that passes `taskPackageV1Schema`
3. `assertRevisionKind(openMercatoModuleV1, { kind: 'git', ... })` returns `ok: true`
4. `assertRevisionKind(openMercatoModuleV1, { kind: 'snapshot', ... })` returns `ok: false` with `revision_kind_mismatch`
5. `checkAllowedPathsForProfile` rejects a path outside `src/modules/**`
6. The OM result-manifest stub passes the `resultManifestV1Schema` validation

### PoC run (Phase 2)

**How the runner works:** `runCezarTask` (from `@open-mercato/delivery-cezar`) spawns `npx cezar-cli run <taskDescription> --no-open` in a `baseDir` worktree. The `taskDescription` is the task's title + description text from the TaskPackage — not a file path. After the run, `mapCezarRunToResultManifest` converts `CezarRunResult` + the original `TaskPackage` into a `ResultManifest v1`. The `checks[]` array in the manifest is initialized to `[]` by the mapper and must be populated by the caller (the enterprise `execute-task` worker, or manually for a `manual_handoff` run) before the manifest is submitted to `POST /tasks/:id/results`.

**Steps:**

1. Create a `DeliveryProject` + `DeliveryBaseline` (via the OSS API) for the chosen module. Ensure the task carries `targetProfileId: "open-mercato-module"` and `allowedPaths: ["packages/core/src/modules/<chosen-module>/**"]`.
2. `POST /api/delivery_os/tasks/:id/attempts` with `mode: manual_handoff` → obtain `attemptId` + `packageUrl`.
3. `GET /api/delivery_os/tasks/:id/package?attemptId=<attemptId>` → download the `TaskPackage v1`.
4. In a clean checkout of `auto-sh` (not the running instance), run from a Node.js script:
   ```typescript
   import { runCezarTask, mapCezarRunToResultManifest } from '@open-mercato/delivery-cezar'
   const runResult = await runCezarTask({ task: pkg.title + '\n' + (pkg.description ?? ''), baseDir: '/path/to/auto-sh-checkout' })
   const manifest = mapCezarRunToResultManifest({ pkg, runResult, resultCommit: <git-head-after-run>, changedPaths: [] })
   ```
5. After the run, execute `yarn jest --testPathPattern=packages/core/src/modules/<module> --json > vitest-report.json` and `yarn typecheck` and `yarn npm audit --severity high` in the checkout. Parse the JSON outputs to populate `manifest.checks[]` with real `checkId`/`status`/`testId` entries matching the profile.
6. Set `manifest.rawReportHash` to `sha256(vitest-report.json content)`.
7. `POST /api/delivery_os/tasks/:id/results` with the complete manifest → obtain `evidenceId`.
8. Verify `GET /api/delivery_os/tasks/:id` returns a task in `awaiting_review` state.
9. Record: `attemptId`, `baselineHash`, `manifest.rawReportHash`, `evidenceId` — these are the QA evidence package.

**Manual fallback (if Cezar is unavailable):** skip steps 4–5; hand-author the manifest JSON directly from the `yarn jest --json` and `yarn typecheck` outputs, populating `checks[]` manually. Submit via step 7. This path still satisfies AC-POC-001 through AC-POC-005 because the contract validation is independent of who produced the manifest.

### TC-DELIVERY-009 integration spec (OSS)

New file: `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-009.spec.ts`

The file goes in the OSS directory because all five cases test `delivery_os` routes, not `delivery_agents`-owned routes. This follows the existing split: `TC-DELIVERY-EXEC-NNN` tests live in the enterprise directory for `delivery_agents`-specific behaviour (e.g. `POST /api/delivery_agents/tasks/:id/execute`); OM target profile contract tests belong in OSS.

Cases (follow the fixture-only pattern from `TC-DELIVERY-OSS-001.spec.ts` — pure API, `beforeAll`/`afterAll`, `finally` cleanup, no browser):

1. **Profile contract**: `GET /api/delivery_os/tasks/:id/package?attemptId=<id>` for a task with `targetProfileId: "open-mercato-module"` returns a valid `TaskPackageV1` — `targetProfileId` is `"open-mercato-module"`, `validationProfile.checks` contains `jest-module`, `typecheck`, and `yarn-audit`, `baseRevision.kind` is `"git"`.
2. **DTO does not force React**: `POST /api/delivery_os/tasks/:id/results` accepts a manifest with OM check entries; a manifest referencing `vite-build` for an OM task returns 422 (unknown commandProfileId in the profile).
3. **Snapshot revision rejected**: a manifest with `sourceRevision: { kind: "snapshot", ... }` for an `open-mercato-module` task returns 422 with code `revision_kind_mismatch`.
4. **Successful import**: a well-formed OM result-manifest (from `result-manifest.open-mercato.v1.json` fixture) is accepted, returns 200 with `evidenceId`, and the task transitions to `awaiting_review`.
5. **Missing required tests**: a manifest that omits a declared `requiredTest` entry for one of the ACs returns 422 with `missing_required_tests`.

Fixtures for cases 2–5 are constructed from `task-package.open-mercato.v1.json` and `result-manifest.open-mercato.v1.json` with targeted mutations per case.

---

## Architecture

No new packages, modules, routes, or DI keys. Changes are additive to existing files:

```
packages/core/src/modules/delivery_os/lib/
  targetProfiles.ts                           ← fix allowedPathRoots + add testCatalogue entries
  fixtures/
    task-package.open-mercato.v1.json         ← new fixture
    result-manifest.open-mercato.v1.json      ← new fixture
  __tests__/
    targetProfiles.open-mercato.test.ts       ← new contract tests
  __integration__/
    TC-DELIVERY-009.spec.ts                   ← new OSS integration spec

packages/delivery-cezar/                      ← no changes required
packages/enterprise/src/modules/delivery_agents/  ← no changes required
```

**Runner behaviour summary:** `runCezarTask` spawns `npx cezar-cli run <taskText> --no-open` in a `baseDir` worktree (no `--package` flag). `mapCezarRunToResultManifest` produces the shell of a `ResultManifest v1` with `checks: []`; the caller must populate `checks[]` from real command outputs before submitting. Neither function needs modification for the OM profile. The runner must be invoked against a clean checkout (not the running `auto-sh` instance) to avoid polluting the dev database.

---

## Data Model

No migrations, no new columns, no new entities. All changes are to:
- A TypeScript constant (`testCatalogue` array)
- JSON fixture files
- Test files

---

## API Contracts

No new routes. The PoC exercises existing routes:
- `POST /api/delivery_os/tasks/:id/attempts` (R14 — reserve)
- `GET /api/delivery_os/tasks/:id/package` (R15 — export)
- `POST /api/delivery_os/tasks/:id/results` (R16 — import)
- `GET /api/delivery_os/tasks/:id` (detail)

---

## Acceptance Criteria

| # | Criterion | Evidence |
|---|-----------|---------|
| AC-POC-001 | `TaskPackage v1` exported for an OM task carries `targetProfileId: "open-mercato-module"` and no `vite-build` check | Package JSON file |
| AC-POC-002 | `delivery-cezar` (or manual) run produces `ResultManifest v1` with `jest-module`, `typecheck`, `yarn-audit` check entries | Manifest JSON file |
| AC-POC-003 | Manifest `sourceRevision.kind` is `"git"` (not `"snapshot"`) | Manifest JSON field |
| AC-POC-004 | `POST /api/delivery_os/tasks/:id/results` returns 200 with `evidenceId` and no validation error | HTTP response |
| AC-POC-005 | Task transitions to `awaiting_review` after import | `GET /api/delivery_os/tasks/:id` response |
| AC-POC-006 | TC-DELIVERY-009 cases 1–5 pass against the real test DB | CI output |

---

## Backward Compatibility

- `openMercatoModuleV1.allowedPathRoots` changes from `['src/modules/**']` to `['packages/core/src/modules/**']`. The old root was unusable against `auto-sh` — no task with `src/modules/**` paths passes `checkAllowedPathsForProfile` against the `auto-sh` monorepo — so no caller's passing behaviour is broken. Profile version stays at `1`.
- `openMercatoModuleV1.testCatalogue` grows from `[]` to ≥ 2 entries. Callers that previously created OM tasks with no declared tests will now receive `requiredTests` entries in the exported package — this is a behavior improvement, not a breaking change.
- No existing test references `'open-mercato-module'` with a testCatalogue expectation (`grep -r 'open-mercato-module' packages/core/src --include='*.test.ts'` confirms no hits).
- New fixtures are purely additive; existing fixture consumers are unaffected.
- `DELIVERY_CONTRACT_VERSION` is unchanged.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Chosen module has flaky tests | Medium | Pre-verify with 3 consecutive local `yarn jest` runs before recording test IDs |
| `yarn npm audit --severity high` flags a real vulnerability in the chosen module | Low | Mark the `yarn-audit` check as `not_run` in the manifest and note the finding in QA evidence; the other two checks must still pass |
| Cezar cannot locate `yarn` in the OM worktree | Low | Confirm `yarn` is on PATH in the Cezar execution environment before the run; use the manual fallback path if not |
| `checks[]` populated incorrectly in the manifest | Medium | Verify each `checkId` matches the profile exactly (`jest-module`, `typecheck`, `yarn-audit`); a wrong `checkId` causes 422 on import |
| `auto-sh` repo size makes a fresh Cezar worktree slow | Low | Pre-clone once; the runner reuses the worktree on retry via the existing `baseDir` contract |

---

## Resolved assumptions (autonomous defaults)

| # | Assumption | Default applied | Confidence |
|---|-----------|----------------|------------|
| 1 | Target module is `example` or `delivery_os` lib tests in `auto-sh` | Implementer decides before Phase 1 and records the choice in the Progress table | Medium — ⚠ NEEDS HUMAN CONFIRMATION |
| 2 | `openMercatoModuleV1.allowedPathRoots` change to `packages/core/src/modules/**` is non-breaking | Confirmed: no test or fixture references the old root; grep returns zero hits | High |
| 3 | `yarn npm audit --severity high` exits 0 for the chosen module | Assumed green; if not, mark `yarn-audit` as `not_run` and note in evidence | Medium |
| 4 | `runCezarTask` passes the task description text (not a file path) as the Cezar `task` argument | Confirmed from `runner.ts` line 74: `[...CEZAR_ARGS_PREFIX, task, ...CEZAR_FLAGS]` | High |
| 5 | `checks[]` must be populated by the caller after `mapCezarRunToResultManifest` | Confirmed: mapper returns `checks: []`; the enterprise worker fills it from command outputs | High |
| 6 | The PoC run uses `manual_handoff` mode (not `automatic`) | Chosen to avoid the `DELIVERY_EXECUTOR=cezar` env flag dependency; EXEC-05 delivery-completion covers the live flip | High |
| 7 | No new `DELIVERY_CONTRACT_VERSION` bump is required | All changes are additive within v1 | High |

---

## Implementation breakdown

| Phase | Work | Estimated |
|-------|------|-----------|
| Phase 1 | Target selection + `allowedPathRoots` fix + test catalogue + fixtures + contract tests | H1 |
| Phase 2 | PoC run + `checks[]` population + evidence package + TC-DELIVERY-009 | H1 |

Total: ~2 h (matches EXEC-05 workstream window H20–H22).

---

## Progress

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — target selection | Done | 2026-09-19 | Target: `delivery_os` lib tests (AC-OM-001, AC-OM-002) |
| Phase 1 — `allowedPathRoots` fix | Done | 2026-09-19 | `packages/core/src/modules/**`; allowedPaths.test.ts updated |
| Phase 1 — testCatalogue | Done | 2026-09-19 | 2 entries in openMercatoModuleV1 |
| Phase 1 — fixtures | Done | 2026-09-19 | task-package.open-mercato.v1.json + result-manifest.open-mercato.v1.json registered in positiveDeliveryFixtures |
| Phase 1 — contract tests | Done | 2026-09-19 | targetProfiles.open-mercato.test.ts — 11 tests all passing |
| Phase 2 — PoC run + `checks[]` | Not started | — | Operational step; requires running app + Cezar or manual manifest |
| Phase 2 — QA evidence | Not started | — | Gated on PoC run |
| Phase 2 — TC-DELIVERY-009 | Done | 2026-09-19 | 5 integration test cases; typecheck clean; pre-existing unit failures are unrelated |
