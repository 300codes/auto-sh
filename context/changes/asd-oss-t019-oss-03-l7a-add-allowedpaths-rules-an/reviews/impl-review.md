<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-03 (L7a) allowedPaths Rules and Pure Proposal Import Validation

- **Plan**: context/changes/asd-oss-t019-oss-03-l7a-add-allowedpaths-rules-an/plan.md
- **Scope**: all phases (2 of 2)
- **Date**: 2026-09-19
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes
- **Findings**: 0 critical, 6 warnings, 4 observations

Two independent sub-agent passes (plan drift; safety/quality/patterns) plus automated criteria re-run.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (all 9 decisions MATCH; glob-character set adaptation recorded in plan) |
| Scope Discipline | PASS (extra: fixtures.test `runProfileStage` per task — required by the new duplicate rule) |
| Safety & Quality | WARNING → PASS after F1, F4, F5 |
| Architecture | PASS (no runtime import cycle; lib has no ORM/data import) |
| Pattern Consistency | WARNING → PASS after F4 |
| Success Criteria | PASS |

## Automated evidence (after fixes)

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` → 14 suites, 445 tests passed
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 32 suites, 781 tests passed
- `yarn turbo run typecheck --concurrency=2 --filter=@open-mercato/core` → 1 successful; lib incl. `__tests__` via a temporary tsconfig → exit 0
- `yarn eslint packages/core/src/modules/delivery_os/lib` → no findings
- ORM grep on lib runtime code → none
- Mutation spot-check: removing the unmapped-AC coverage rule and the priority list each fails `proposals.test.ts` (2 failures), restored afterwards.

## Findings

### F1 — Brace, negation, pathspec and invisible characters accepted in allowedPaths
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality · **Location**: lib/allowedPaths.ts:44-62
- **Detail**: `{a,..}`, leading `!`, leading `:` and bidi/zero-width characters passed. Exact matching is safe, but an executor handing the list to minimatch or git pathspec could widen scope; bidi characters can spoof the reviewed path.
- **Fix**: reject `{`/`}`/leading `!` as `unsupported_glob`, `\p{Cf}` and leading `:` as `unsupported_character`; keep `[`/`]` literal for `[id]` route files. Paired tests added.
- **Decision**: FIXED

### F2 — Proposal AC→test map replaces the parent mapping
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality · **Location**: lib/proposals.ts (merged map)
- **Detail**: a plan can swap a parent AC's tests.
- **Decision**: DISMISSED — the merged baseline is a new version that needs both human decisions again (plan decision binding, BREAKDOWN §4); a re-plan must be able to rename tests; an empty list without a manual check is rejected.

### F3 — 51st import surfaces as generic validation_failed
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Location**: lib/proposals.ts (baselineContentV1Schema re-parse)
- **Decision**: ACCEPTED — frozen contract `max(50)`; the detail path names `importedManifestHashes`; documented in the spec. Not reachable in the demo (one import per baseline version).

### F4 — Unguarded structuredClone / hashing
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Pattern Consistency · **Location**: lib/proposals.ts
- **Fix**: `tryClone`/`tryHash` → `400 validation_failed`/`not_canonical_json`, like `baseline.ts`. Test added.
- **Decision**: FIXED

### F5 — Declared test file may be a directory glob
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Location**: lib/proposals.ts buildTestCatalogue
- **Fix**: `declared_test_not_a_file` under `path_not_allowed`. Test added.
- **Decision**: FIXED

### F6 — Weak or unpaired tests
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria · **Location**: lib/__tests__/proposals.test.ts
- **Detail**: priority test passed without the priority list; unmapped-AC empty list untested; "never duplicates a manifest hash" tested an unreachable branch; missing twins (acTestMap unknown key, schema paths, dependsOn); duplicate question/risk ids untested.
- **Fix**: added the catalogue-before-mapping priority case, unmapped-AC case + manual-check twin, twins, question/risk duplicates; replaced the unreachable `includes` branch with `unique([...])` and asserted the appended list. Mutation check confirms.
- **Decision**: FIXED

### F7 — Spec understated the manual-task behaviour change
- **Severity**: 💡 OBSERVATION · **Location**: .ai/specs/2026-09-18-delivery-os-hackathon.md
- **Fix**: changelog now lists the bare-directory rejection and specific detail codes; the Helpers paragraph points at the delegation.
- **Decision**: FIXED

### F8 — summarizePlan could split a surrogate pair
- **Severity**: 💡 OBSERVATION · **Fix**: drop a trailing high surrogate before the ellipsis; test added. · **Decision**: FIXED

### F9 — producedBy is part of manifestHash
- **Severity**: 💡 OBSERVATION · **Decision**: ACCEPTED — same `manifestId` with a different body is a different document (409 in L7b); documented in the spec.

### F10 — Requirements result shares arrays with `manifest`
- **Severity**: 💡 OBSERVATION · **Decision**: ACCEPTED — both are fresh zod output and never alias the caller's input.
