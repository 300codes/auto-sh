<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L5a): project, baseline, decision and task API routes

- **Plan**: context/changes/asd-oss-t015-oss-02-l5a-add-project-baseline-deci/plan.md
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 0 critical, 5 warnings, 4 observations
- **Method**: one read-only sub-agent (hard RAM rule); automated criteria re-run in the main context.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → fixed |
| Architecture | PASS |
| Pattern Consistency | WARNING → fixed |
| Success Criteria | PASS |

Success criteria re-run after the fixes: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
→ 25 suites, 653 tests green; `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` → 1 successful
(not cached); eslint of `delivery_os/api` clean; live smoke on :3100 green. Manual row 3.5 stays `[ ]`.

The reviewer confirmed: no cross-tenant or cross-organization read/write path (every where-clause takes tenant and
organization from `resolveDeliveryScope`), no fail-open authZ path on R7/R10, `withDeleted` cannot be injected, audit
entries carry tenant/org from `buildLog`, response shapes match the UA table.

## Findings

### F1 — List export parameters skip `buildFilters`, dropping the organization pin

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/api/projects/route.ts (list config)
- **Detail**: `?format=csv&exportScope=full` makes the factory skip `buildFilters` (`factory.ts:1843-1849`). Tenant scope and the caller's visible organizations still apply, but a caller who sees several organizations would list projects that R5 answers 404 for; rows would also bypass `transformItem`.
- **Fix**: `export: { enabled: false }` + a test that the export parameters still answer JSON with the pin.
- **Decision**: FIXED (verified live: the request answers JSON)

### F2 — Custom routes resolved the organization differently from the CRUD factory

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/api/routeSupport.ts `resolveDeliveryRouteContext`
- **Detail**: The factory uses `scope.selectedId` without a home-org fallback, rewrites `auth.orgId`/`tenantId` from the scope, swallows a scope-resolution throw and answers 422 `organization_selection_invalid` for a rejected selection. The custom routes fell back to the home org and ignored `selectionRejected`, so R1–R4/R12/R13 and R5–R11 could act on different organizations for the same session.
- **Fix**: Mirror the factory's context building and answer the same 422 body. · Strength: one organization per session across all routes; a write never lands on a fallback org · Tradeoff: "all organizations" sessions get `403 scope_required` everywhere (T010 decision) · Confidence: HIGH.
- **Decision**: FIXED (+ test)

### F3 — 500 fallback used a code outside the frozen catalogue

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/core/src/modules/delivery_os/api/routeSupport.ts `deliveryErrorResponse`
- **Detail**: `code: 'internal_error'` fails `deliveryErrorBodySchema`; the catalogue is pinned by `lib/__tests__/contracts.test.ts`.
- **Fix**: Answer the platform body `{ error: 'Internal server error' }` and document platform bodies as outside the frozen shape.
- **Decision**: FIXED

### F4 — Non-object JSON bodies answered the factory's unfrozen 400

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: api/projects/route.ts, api/tasks/route.ts (`rawBodySchema` on create/update)
- **Detail**: An array or string body threw a `ZodError` in the factory before `mapInput`.
- **Fix**: `z.unknown()` for create/update so `mapInput` produces the frozen 400 (+ test, verified live).
- **Decision**: FIXED

### F5 — Test gaps at the route level

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: api/__tests__/
- **Detail**: Export bypass, rejected selection, non-object body and path-id spoofing were untested. The command-bus mock skips `prepare`/`buildLog` (covered by the command suites) and the query engine is mocked (covered by the live run).
- **Fix**: Added the four tests; the rest is recorded as a limitation and proven live.
- **Decision**: FIXED (partially ACCEPTED: audit/query-engine parts rely on command suites + live evidence)

### F6 — Guard `modifiedPayload` could override path ids

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: routeSupport.ts `executeDeliveryCommand`
- **Fix**: Path ids are merged last (`pathInput`).
- **Decision**: FIXED

### F7 — Feature check resolved the organization a second time

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Fix**: `requireDeliveryFeatures` takes the write scope.
- **Decision**: FIXED

### F8 — Deep relative imports and a redundant re-sort

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Fix**: Nested routes import through `@open-mercato/core/modules/delivery_os/...`; the JS re-sort after `orderBy` is removed.
- **Decision**: FIXED

### F9 — Platform bodies that are not frozen-shaped; no operation header on custom routes

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Detail**: Mutation-guard blocks, the declarative 403, 401, `organization_selection_invalid`, interceptor rejections, 5xx and the list-query 400 keep the platform's bodies. Custom routes return no undo/operation header (these commands have no undo).
- **Fix**: Documented in the spec changelog and the hand-over note; R7 `openCommentIds` and the R5 extras documented as additive.
- **Decision**: ACCEPTED (documented)
