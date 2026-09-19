<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OSS-02 (L2) five entities, reviewed migration, validators and module registration stub

- **Plan**: context/changes/asd-oss-t006-oss-02-l2-add-five-entities-reviewed/plan.md
- **Mode**: Deep (claims verified inline by the reviewer, no sub-agent, to respect the machine's memory rule)
- **Date**: 2026-09-19
- **Verdict**: SOUND after fixes (was REVISE)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Paths 5/5 ✓ (`apps/mercato/src/modules.ts`, `lib/contracts.ts`, `api_keys/data/entities.ts`, `customers/data/entities.ts`, `scripts/template-sync.ts`);
symbols ✓ (`build:packages` = `turbo run build --filter='./packages/*'`, core `typecheck` = `tsc --noEmit`, `db:generate` = `mercato db generate`);
brief↔plan ✓; Progress↔Phase ✓ (1.1–1.7, 2.1–2.6).
Verified claims: `packages/cli/src/lib/db/commands.ts:127-192` loads `data/entities.ts` from source through tsx with
`emitDecoratorMetadata: false` (so every property needs an explicit `type`), and `:105-107` creates an initial migration when the module has no
snapshot. Modules without `acl.ts` exist (`portal`, `seeds`), so a metadata-only stub is discoverable.

## Findings

### F1 — User-settable `statusReason` lets a client spoof system reasons

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — `taskUpdateSchema`
- **Detail**: The spec's UA-09 body is `{ id, status }`; `status_reason` carries system values such as `reconciliation_required`, which blocks reserve and archive. Accepting it from the body would let a user fake or clear that state.
- **Fix**: Remove `statusReason` from `taskUpdateSchema`; add a test that the key is stripped.
- **Decision**: FIXED

### F2 — Migration is applied before the columns are checked against the spec

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — step 4 / criterion 1.5
- **Detail**: Once applied to the shared local database, a wrong column needs a second migration or manual repair. The plan says "after the SQL review" but does not say what the review checks.
- **Fix**: State that the review is a column-by-column comparison with the spec tables (names, nullability, defaults) and that `db:migrate` runs only after it passes; if a mistake is found later, regenerate the single migration and repair the local DB rather than stacking a second migration.
- **Decision**: FIXED

### F3 — jsonb and integer defaults are not part of the migration check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — criterion 1.2
- **Detail**: The spec requires `draft_spec default '{}'`, several `'[]'` defaults and `attempt_number default 0`. MikroORM's rendering of object defaults is easy to get wrong.
- **Fix**: Add the defaults to the 1.2 review and cover them in the SQL smoke (insert with the columns omitted).
- **Decision**: FIXED

### F4 — Running dev server reloads when `modules.ts` changes

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — step 3
- **Detail**: The shared dev server on :3100 picks up the new module before the tables exist. Nothing queries them yet, so it is harmless; after the phase, check that `/login` still answers 200.
- **Fix**: Add the health check to Phase 1 verification notes.
- **Decision**: FIXED
