# OSS-02 (L1b): target profiles, fixtures and H4 hand-over — Plan Brief

> Full plan: `context/changes/asd-oss-t005-oss-02-l1b-add-target-profiles-fixtu/plan.md`

## What & Why

UI, EXEC and QA must build on the frozen v1 contracts before the domain exists. They need the target profiles
(React, OM and WP as data), realistic fixtures that parse with the published schemas, labelled negative
fixtures with deterministic error codes, and a fake-executor manifest builder.

## Starting Point

T004 shipped `lib/contracts.ts` (the v1 schemas, `parseVersioned` and the error catalogue) and `lib/hash.ts`.
Profiles, fixtures, the reserve schemas, correlation and the DAG cycle check do not exist yet.

## Desired End State

Anyone can import `@open-mercato/core/modules/delivery_os/lib/{contracts,targetProfiles,fixtures}`, load a
fixture typed by its schema, build a correlated result manifest for any task package, and see every negative
fixture fail with its labelled code in the jest matrix.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Fixture format | JSON files, imported with `with { type: 'json' }` if the toolchain accepts it | The task asks for `.v1.json`, and JSON is reusable by QA/EXEC outside TS |
| Negative labels | Wrapper `{ description, expected: { stage, code }, against?, document }` | Self-describing for QA; the matrix test dispatches on the stage |
| Helper result shape | `{ ok: true } \| { ok: false, status, body }` | Consistent with `parseVersioned`; no try/catch |
| Correlation / cycle | First pure helpers in `lib/resultAcceptance.ts` and `lib/dag.ts` | The negatives must be verifiable; the files are already named in the spec |
| Reserve DTOs | `reserveAttemptRequestSchema` / `reserveAttemptResponseSchema` added to contracts | The reserve-response fixture needs a published schema |
| Widget context fixture | Data only; the loader adds no-op callbacks | JSON cannot hold functions |
| Profile roots | Prefix globs (`src/**`, file roots like `index.html`) | Simple containment; full glob matching is `lib/allowedPaths.ts` later |

## Scope

**In scope:** profiles, contract additions, correlation and cycle helpers, 11 positive and 12 negative fixtures,
loaders and builder, jest tests, a spec changelog entry and the hand-over note.

**Out of scope:** entities, routes, commands, DI, module registration, report schema, `changedPaths` glob matching.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Profiles + helpers | `targetProfiles.ts`, contract additions, `resultAcceptance.ts`, `dag.ts` + tests | Over-designing profile data |
| 2. Fixtures + matrix | JSON fixtures, `fixtures/index.ts`, builder, matrix test | JSON import attribute support in ts-jest |
| 3. Spec + hand-over | Spec changelog, `OSS-02-H4-contracts.md` | none |

**Estimated effort:** one session.

## Open Risks & Assumptions

- A5: OSS froze the proposal contracts; UI-03 must confirm them.
- R3: v1 is additive-only from this commit.
- Profile command strings (for example `npm audit`) are the EXEC stream's to confirm; changing one means a new profile version.
