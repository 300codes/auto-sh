# OSS-02 (L2): entities, migration, validators, registration — Plan Brief

> Full plan: `context/changes/asd-oss-t006-oss-02-l2-add-five-entities-reviewed/plan.md`
> Research: `context/changes/asd-oss-t006-oss-02-l2-add-five-entities-reviewed/research.md`

## What & Why

`delivery_os` has contracts but no storage and no input validation. This task adds the five tables, the reviewed migration and the zod
request-body schemas, so that the next layers (lifecycle, commands, routes) have something real to write to and one place that rejects bad input.

## Starting Point

Only `delivery_os/lib/` exists. The module has no `index.ts`, so the platform does not know it.

## Desired End State

The module is registered and discovered, five `delivery_*` tables exist through one reviewed migration (applied on the local database),
and every write route has a tested input schema that never accepts tenant or organization ids.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Column names where task text and spec differ | The frozen spec | It is the v1 contract already handed to the other streams | Research |
| Unknown body keys | Stripped, not rejected | Scope comes from the session; strict mode would break forms | Plan |
| Manifests inside bodies | Plain object; versioned parse happens in the command | Keeps `422 unsupported_schema_version` and `413` reachable | Plan |
| Task update `status` | Any status accepted; lifecycle answers `409 invalid_transition` | Spec requires 409, not 400 | Research |
| Evidence kinds on R19 | test, review, screenshot, deployment, scan, reference_material | The React profile needs scan evidence | Plan |
| `DraftSpec v1` | Lenient schema in `data/validators.ts` | A draft must be saveable while incomplete | Plan |
| Private primitives | Exported additively from `lib/contracts.ts` | No duplication | Plan |
| Template sync drift | Reported, not fixed | Master plan: do not activate in the template | Research |
| Local migrate | Applied once on `omhack` (consent given) | Proves the DDL | Plan |

## Scope

**In scope:** `index.ts`, `data/entities.ts`, migration + snapshot, `data/validators.ts` + tests, additive exports in `lib/contracts.ts`,
one line in `apps/mercato/src/modules.ts`, `yarn generate`.

**Out of scope:** ACL, setup, events, DI, extension point, commands, routes, template changes, report schemas.

## Architecture / Approach

Entities are flat tables with uuid FK columns and scope-leading indexes; two expression indexes give idempotency at the database level
(plan re-import and double result import). Validators reuse the contract primitives and tag rule violations with catalogue codes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Stub, entities, registration, migration | Discovered module and reviewed DDL | Generator noise from other modules |
| 2. Validators, tests, package gate | Tested input schemas; build and typecheck green | zod 4 refinement ordering |

**Prerequisites:** local `omhack` stack running. **Estimated effort:** one session.

## Open Risks & Assumptions

- `yarn template:sync` will report `modules.ts` drift; the owner of the script decides how to exclude the module.
- Evidence payload shapes are OSS's reading of UA-13; additive changes remain possible.

## Success Criteria (Summary)

- One migration, only `delivery_*` DDL, both partial uniques and both baseline uniques.
- Validator tests pass with paired cases.
- Packages build and core typecheck pass; `modules.ts` diff is one line.
