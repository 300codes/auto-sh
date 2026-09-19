<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L4a): ACL, setup, events and the execution extension point

- **Plan**: context/changes/asd-oss-t009-oss-02-l4a-add-acl-setup-events-and/plan.md
- **Scope**: Phase 1 of 1 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (one justified drift, recorded as plan addendum Q8a) |
| Scope Discipline | PASS (extra: hand-over addendum in the OSS-owned note, harmless) |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS: automated 1.1–1.4 green; manual 1.5 left open for a human |

## Success criteria evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes: 12 suites, 384 tests.
- `yarn generate` exited 0 with only the known OpenAPI noise. No tracked file changed. The gitignored registries under `apps/mercato/.mercato/generated/` now import `delivery_os/{acl,setup,events}`.
- `yarn workspace @open-mercato/core jest src/__tests__/module-decoupling.test.ts --maxWorkers=2` passes: 12 tests.
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` passes.
- The test file was also type-checked with a temporary tsconfig, because core tsc excludes `__tests__`. It passes.
- eslint on the new files is clean.

## Findings

### F1 — `evidence.recorded.taskId` optional, plan said required

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: packages/core/src/modules/delivery_os/events.ts:40
- **Detail**: `delivery_evidence.task_id` is nullable, so optional is correct. The spec was already updated.
- **Fix**: Add plan addendum Q8a.
- **Decision**: FIXED

### F2 — Boundary regex false negatives

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/__tests__/module-registration.test.ts:63
- **Detail**: The regex missed relative `../enterprise/` imports, template-literal specifiers and `require.resolve`.
- **Fix**: Extend the regex and add cases for each form.
- **Decision**: FIXED

### F3 — Regex could flag the specifier text inside comments or strings

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: module-registration.test.ts:63
- **Detail**: This fails closed, and no module file does this today.
- **Decision**: DISMISSED — failing closed is the desired direction for a boundary guard

### F4 — `completionDelivery` typed `text` although it is an enum

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: events.ts:45
- **Fix**: Type it as `select`.
- **Decision**: FIXED

### F5 — `project.created` uses category `crud`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: events.ts:55
- **Detail**: The explicit schema prevents the default CRUD payload. The spec now says: emit from commands only, and no `makeCrudRoute` `events`.
- **Decision**: DISMISSED — already documented

### F6 — Existing tenants need an ACL sync

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: setup.ts
- **Detail**: `yarn mercato auth sync-role-acls` was run locally. A live `feature-check` confirmed the split: the employee got 3 of 7 checked features, and admin got all.
- **Decision**: DISMISSED — done; manual 1.5 stays for a human

### F7 — Employees can reach `verified` indirectly via `projects.manage` + `results.import`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: acl.ts / spec
- **Detail**: This follows the spec. The `→ verified` gates (review evidence with proof, `lib/taskLifecycle.ts`) must be enforced server-side in the L4/L5 commands.
- **Decision**: ACCEPTED — carried to the L4 notes
