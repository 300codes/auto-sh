<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-02 (L1b) target profiles, fixtures and H4 hand-over

- **Plan**: context/changes/asd-oss-t005-oss-02-l1b-add-target-profiles-fixtu/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 0 critical, 7 warnings, 4 observations (two sub-agent reviews: plan drift, and safety/patterns)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (small drifts are documented below) |
| Scope Discipline | PASS (extras are benign: `isEvidenceKindPermitted`, `checkAcyclic`, `reserve.automatic-mode`, `deriveFakeResultRevision`) |
| Safety & Quality | PASS after fixes |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS: jest 168/168, core `tsc` clean, eslint clean |

## Findings

### F1 — The hand-over and spec gave an import path that does not resolve outside jest
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: handover/OSS-02-H4-contracts.md:20; spec, Fixtures paragraph
- **Detail**: `@open-mercato/core/modules/delivery_os/lib/fixtures` maps to `lib/fixtures.ts`, which does not exist. The package export map has no folder-index fallback.
- **Decision**: FIXED. Both documents now give `…/lib/fixtures/index`, plus `…/lib/fixtures/builders` as the JSON-free import.

### F2 — The claim that the JSON import works from `dist` under plain Node ESM was false
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: fixtures/index.ts; hand-over
- **Detail**: The core esbuild target strips `with { type: 'json' }`.
- **Decision**: FIXED via the plan's fallback. The attribute is removed (plain JSON imports, as in existing core tests). The hand-over now states that the loaders run under jest and bundlers, and that `builders.ts` has no JSON and runs in any runtime.

### F3 — The "post `document` and expect the code" wording was wrong for route order
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: hand-over, negative table
- **Detail**: Through R16, `snapshot-for-react` fails correlation first (`base_revision_mismatch`). The task package is also GET-only.
- **Decision**: FIXED. The table now says `expected` is the labelled stage in isolation, and a "Via route" column adds the id-substitution guidance.

### F4 — The builder used only the first test check and invented a `'test'` command profile
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: fixtures/builders.ts
- **Decision**: FIXED. Required tests go to the first test check. Every other profile check, including extra test checks and the test check when there are no required tests, gets its own result. The builder throws `[internal]` when required tests exist but no test check does. Tests were added.

### F5 — Generated check ids could collide or exceed 64 characters
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: fixtures/builders.ts
- **Decision**: FIXED. The prefix is capped at 56 characters and the counter skips taken ids. A test was added.

### F6 — A `baseRevision` override left `baseCommit` stale
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: fixtures/builders.ts
- **Decision**: FIXED. `baseCommit` is now derived from the effective `baseRevision`. A test was added.

### F7 — The recursive DFS overflowed the stack on 10k-node inputs, and duplicate keys could hide a cycle
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: dag.ts
- **Decision**: FIXED. The DFS is iterative, and duplicate keys are unioned. Tests were added (a 10 000-node chain, and the duplicate case).

### F8 — A `null` vs absent `baseCommit` gave a false `base_revision_mismatch`
- **Severity**: 💬 OBSERVATION · **Dimension**: Safety & Quality
- **Location**: resultAcceptance.ts
- **Decision**: FIXED. Values are compared nullish-normalised, and the input types accept `null` (as on the attempt row). A test was added.

### F9 — Plan drift: `testFilePatterns` was dropped and `react-vite@1` has no separate typecheck check
- **Severity**: 💬 OBSERVATION · **Dimension**: Plan Adherence
- **Decision**: ACCEPTED. `testFilePatterns` had no consumer; declared tests are checked against the roots and catalogue later in `lib/allowedPaths.ts`. The demo `build` runs `tsc -b && vite build`, and the spec cell now says so.

### F10 — Path strings allow DEL, U+2028 and bidi-override characters
- **Severity**: 💬 OBSERVATION · **Dimension**: Safety & Quality
- **Location**: contracts.ts `repoRelativePathSchema` (T004)
- **Decision**: SKIPPED. Tightening a frozen v1 validator right after H4 is a contract change. Recorded for the OSS-06 hardening pass. React escapes the characters on display, so this is cosmetic spoofing, not an escape.

### F11 — Idempotency and profile stage harnesses live in the test file
- **Severity**: 💬 OBSERVATION · **Dimension**: Success Criteria
- **Decision**: ACCEPTED. There is no production idempotency code yet (that is `lib/attempts.ts`, L2). The negative fixture validates the fixture itself, and the hand-over says the domain is not implemented.
