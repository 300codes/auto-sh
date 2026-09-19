<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delivery OS contracts v1, canonical hash and error catalogue

- **Plan**: context/changes/asd-oss-t004-oss-02-l1a-add-versioned-contracts-v/plan.md
- **Scope**: Phases 1-2 of 2
- **Date**: 2026-09-19
- **Verdict**: NEEDS ATTENTION → APPROVED after fixes
- **Findings**: 0 critical, 5 warnings, 6 observations (independent read-only sub-agent review; catalogue verified 53/53 codes and statuses against the spec)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (two cosmetic drifts recorded below) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after F1, F2, F5 |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (jest 95/95, core typecheck exit 0, eslint clean, greps clean) |

## Findings

### F1 — `__proto__` key made two different documents hash equal
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: lib/hash.ts
- **Detail**: `result[key] = …` on a `{}` literal hit the prototype setter, so the entry was dropped (reproduced with a probe).
- **Fix**: build the result with `Object.create(null)`; test added.
- **Decision**: FIXED

### F2 — Unbounded nesting threw RangeError out of `canonicalize` and `parseVersioned`
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: lib/hash.ts, lib/contracts.ts (`z.json()` tokens)
- **Fix**: `MAX_CANONICAL_DEPTH = 64`; `canonicalize` throws `[internal]`; `parseVersioned` pre-checks depth iteratively and returns `413 payload_too_large`. Tests added (20 000 and 5 000 levels).
- **Decision**: FIXED

### F3 — TaskPackage has `title`, `description?`, `acceptanceCriteria.min(1)` not listed in the spec row
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Plan Adherence
- **Detail**: OSS is the only producer of packages (`buildTaskPackage`), consumers only read; an agent cannot work without a task title. Additive to the "key fields" list.
- **Fix**: keep; record in the OSS spec row and changelog.
- **Decision**: FIXED (spec updated)

### F4 — Catalogue test covered 25 of 53 codes
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Fix**: `toEqual` against the full literal copied from the spec.
- **Decision**: FIXED

### F5 — A check could claim another revision than the result
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Detail**: master plan: tests count only "na odbieranej wersji".
- **Fix**: `superRefine` compares each `check.sourceRevision` with `resultRevision` → `revision_mismatch`; tests added.
- **Decision**: FIXED

### F6 — `outcome` enum values were not in the spec
- **Severity**: ℹ️ OBSERVATION · **Fix**: values listed in the spec (`result_accepted | cancelled | not_started | stopped | null`).
- **Decision**: FIXED

### F7 — Tenant-strip test looked at the top level only
- **Severity**: ℹ️ OBSERVATION · **Fix**: scope keys injected into nested check and usage; whole parsed output searched.
- **Decision**: FIXED

### F8 — Conditional assertion could be skipped
- **Severity**: ℹ️ OBSERVATION · **Fix**: throw when the narrowing condition is false.
- **Decision**: FIXED

### F9 — Missing cases (absent key, snapshot+commitSha through a document, mixed shape+rule code)
- **Severity**: ℹ️ OBSERVATION · **Decision**: FIXED (tests added)

### F10 — Path shape gaps (control characters, empty and `.` segments, whitespace) and dotted single path segment
- **Severity**: ℹ️ OBSERVATION · **Decision**: FIXED

### F11 — Casts
- **Severity**: ℹ️ OBSERVATION
- **Detail**: `readSchemaVersion` cast removed with an `in` guard. `Object.keys(...) as [DeliveryErrorCode, …]` and `as ParseVersionedSuccess<TMap>` are the standard typed-keys / mapped-union idioms; no `any`.
- **Decision**: FIXED (one) / DISMISSED (two, idiomatic and safe)

## Recorded drifts (no action)
- A self-dependency in a plan proposal reports `cycle` (plan text said `foreign_dependency`); `cycle` is the accurate catalogue code.
- The delivery code travels in zod `params.deliveryCode` (plan text said `params.code`); internal detail.
