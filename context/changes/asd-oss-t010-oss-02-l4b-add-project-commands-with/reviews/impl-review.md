<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L4b) project commands

- **Plan**: context/changes/asd-oss-t010-oss-02-l4b-add-project-commands-with/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 0 critical, 3 warnings, 5 observations

Reviewer: one independent read-only sub-agent (drift + safety + patterns in one pass, because of the machine's
memory rule) plus re-run of the automated criteria.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after F1, F2 |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-run after the fixes: `yarn workspace @open-mercato/core jest src/modules/delivery_os
--maxWorkers=2` → 14 suites, 427 tests passed; `tsc --noEmit -p packages/core/tsconfig.json` clean (a probe file with
a type error was reported, so the check is live); eslint on `commands/` and `lib/` clean; `yarn generate` →
3 `delivery_os.projects.*` ids in `command-loaders.generated.ts`; no `any` / inline comments. Manual row 2.6 stays open.

Confirmed fine by the reviewer: no input field reaches tenant/org; `prepare` errors propagate unchanged and
`snapshots.after` comes from `captureAfter` (`command-bus.ts:260-268`); MikroORM 7.1.14 `em.transactional` flushes
before commit and returns the callback value; `[internal]` message never reaches the client (`factory.ts:614` sends
`err.body`); `result_received` correctly does not block archive (spec line 127).

## Findings

### F1 — Organization check is a tautology when `organizationScope` is null

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: commands/shared.ts `resolveDeliveryScope`
- **Detail**: `ensureOrganizationScope` compares the target with `ctx.selectedOrganizationId ?? auth.orgId` — the same
  expression used to pick it — unless the caller filled `organizationScope`. A hand-built ctx could select any org of
  the tenant.
- **Fix**: Trust `selectedOrganizationId` only when a platform `organizationScope` is present; otherwise the account
  org is used and a differing selection answers 403. Workers keep working through `auth.orgId`.
- **Decision**: FIXED

### F2 — 403 from the scope helpers lacked the frozen body

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: commands/shared.ts `resolveDeliveryScope`
- **Detail**: `ensureTenantScope`/`ensureOrganizationScope` throw `{ error: 'Forbidden' }` with no `code`/`details`.
- **Fix**: Rethrow 403s as `forbidden` with detail `scope_not_allowed`; test pins the whole body.
- **Decision**: FIXED

### F3 — Commit-before-side-effects not proven by tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: commands/__tests__/projects.test.ts
- **Detail**: `transactional` was mocked as a pass-through, so ordering was never exercised.
- **Fix**: Added a deferred-commit test: no `markOrmEntityChange` while the transaction is pending.
- **Decision**: FIXED

### F4 — "Newest version" test could not fail (every profile has one version)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: lib/targetProfiles.ts, its test
- **Fix**: Extracted `pickLatestProfile(profiles, id)`; tested with three versions in two orders.
- **Decision**: FIXED

### F5 — Archive guard duplicates `isArchiveBlocked` without a tie

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: commands/projects.ts `checkProjectArchivable`
- **Fix**: Test asserts `checkProjectArchivable(...).ok === !isArchiveBlocked(register)` for every register state. The
  inline form stays because it yields per-attempt `details[]`.
- **Decision**: FIXED

### F6 — Audit entry without resource id if `prepare` missed the row

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: commands/projects.ts update/delete `buildLog`
- **Fix**: `buildLog` always returns metadata with `resourceId = result.projectId` and scope from before/after.
- **Decision**: FIXED

### F7 — Hand-rolled `CrudHttpError` for 404 deviates from the shared rule, undocumented

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Fix**: Documented in the hand-over: the frozen delivery body (spec § errors) needs `code` + `details[]`, which
  `notFound()` cannot carry.
- **Decision**: FIXED (documentation)

### F8 — Archive guard ignores soft-deleted tasks

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Fix**: Hand-over note: the task delete command must refuse a task with an active or unknown attempt.
- **Decision**: FIXED (hand-over)
