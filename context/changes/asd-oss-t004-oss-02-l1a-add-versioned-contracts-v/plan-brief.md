# Delivery OS contracts v1, canonical hash and error catalogue — Plan Brief

> Full plan: `context/changes/asd-oss-t004-oss-02-l1a-add-versioned-contracts-v/plan.md`
> Research: `context/changes/asd-oss-t004-oss-02-l1a-add-versioned-contracts-v/research.md`

## What & Why

Make the frozen v1 contract executable: zod schemas, inferred types, an error-code catalogue, a versioned parser
and a canonical hash. Every later OSS command, the EXEC bridge and the UI depend on these; they are the first
line of "the agent proposes, the system decides".

## Starting Point

The spec froze names and codes (T003). The `delivery_os` module folder does not exist yet.

## Desired End State

Other streams import schemas and types from `@open-mercato/core/modules/delivery_os/lib/contracts`. Unknown
versions, invented commits, `skipped` checks and fake zero costs are rejected with deterministic codes.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| `schemaVersion` type | typed string per document | frozen in the spec; blocks posting another document type | Research |
| Version rejection code | `unsupported_schema_version` (not the task text's `unknown_schema_version`) | spec catalogue is authoritative and already handed to UI/QA | Research |
| Catalogue content | exactly the spec's codes, as a code → HTTP status map | one source for routes and UI i18n keys; no unused aliases | Plan |
| Unknown keys | stripped; only `SourceRevision` is strict | QA asserts "tenant in manifest ignored"; v1 may grow additively | Plan |
| `parseVersioned` result | result object `{ok,…}` with a ready error body and status, no throw | routes and workers map it without try/catch | Plan |
| Rule violations | `superRefine` issues carrying a delivery code in `params.code` | deterministic `details[].code` for UI and QA | Plan |
| Usage | `'unknown'` or an object with ≥1 number; `{}` rejected | unknown cost must never read as 0 | Plan |
| Path check | shape only (relative, no `..`) | containment belongs to `lib/allowedPaths.ts` | Plan |

## Scope

**In scope:** `lib/hash.ts`, `lib/contracts.ts`, their two test files.

**Out of scope:** fixtures, target profiles, report schema, entities, commands, routes, module registration.

## Architecture / Approach

Pure functions and zod schemas with `zod` and `node:crypto` as the only imports, composed from shared primitives.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Canonical hash | `canonicalize`, `sha256Hex`, `hashCanonical` + tests | edge values (undefined, NaN, Date) |
| 2. Contracts | all v1 schemas, catalogue, `parseVersioned` + tests | typing `parseVersioned` without `any`; zod 4 API differences |

**Prerequisites:** none. **Estimated effort:** one session.

## Open Risks & Assumptions

- UI-03/EXEC-04 have not confirmed the proposal/manifest shapes; OSS owns the contract and v1 stays additive.
- Task text code names differ from the spec; mapping is recorded in research and decisions.

## Success Criteria (Summary)

- Scoped jest and core typecheck green; greps clean.
- Every rule from master plan § Kontrakty has a passing positive and negative test.
