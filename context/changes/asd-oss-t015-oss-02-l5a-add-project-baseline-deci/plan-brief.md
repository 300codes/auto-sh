# OSS-02 (L5a): project, baseline, decision and task API routes — Plan Brief

> Full plan: `context/changes/asd-oss-t015-oss-02-l5a-add-project-baseline-deci/plan.md`
> Research: `context/changes/asd-oss-t015-oss-02-l5a-add-project-baseline-deci/research.md`

## What & Why

Expose the existing `delivery_os` commands as the frozen HTTP routes R1–R13 so the UI, the enterprise agents and QA
can drive a delivery project for real: create a project, edit the draft, freeze a baseline, record
requirements/design decisions, create and move tasks. The routes are where "the agent proposes, the system decides"
becomes observable: every write goes through one command, one guard and one error catalogue.

## Starting Point

Commands, validators, contracts and pure rules exist and are unit-tested (T004–T014). There is no `api/` folder, so
nothing is reachable over HTTP.

## Desired End State

Eight route files under `packages/core/src/modules/delivery_os/api/` with `metadata`, `openApi`, the frozen
`{ error, code, details[] }` body, the untouched platform 409 body and 404 for foreign scope; jest route tests green;
the flow proven with curl on http://localhost:3100.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Rule placement | Commands only; routes are thin | One validation path | Plan |
| `updatedAt` for R2/R3 | Added to project command results | No second read | Plan |
| `includeArchived` | GET wrapper maps it to the platform `withDeleted` | Spec name frozen, factory untouched | Research |
| List scope | Pinned to the same single org as commands | Listed projects never 404 on open | Plan |
| Proposals before OSS-03 | 403 by feature, then the command's 400 `unsupported_source` | No 422 code in the frozen catalogue; T011/T012 decision | Plan |
| Mutation guard | `runRouteMutationGuards` | Named pair is deprecated and skips registry guards | Research |
| Read DTOs | camelCase; baselines carry `content`, `isActive`, `decisions[]` | No baseline detail route exists | Plan |
| Tests | Real routes + factory + commands over an in-memory store | End-to-end 409/404/422 without a DB | Research |

## Scope

**In scope:** R1–R13, `api/openapi.ts`, DTO schemas, route support, route tests, `yarn generate`, live curl, spec
changelog and hand-over note.

**Out of scope:** R14–R22, proposal imports, UI/i18n, Playwright specs, migrations.

## Architecture / Approach

`makeCrudRoute` + `commandId` actions for projects and tasks (PUT/DELETE); custom handlers for nested routes using
`api/routeSupport.ts` (context → feature → guard → command → response). Reads use scoped finders and pure serializers;
project detail computes status with `lib/projectStatus.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Support + projects | R1–R5, plumbing, test kit | Running the real factory under jest |
| 2. Baselines, decisions, tasks | R6–R13 | Per-source feature checks |
| 3. Generate + live proof | Registered routes, curl evidence, docs | Query-engine list of a new entity on the live DB |

**Prerequisites:** local stack on :3100, migrations applied.
**Estimated effort:** one session.

## Open Risks & Assumptions

- Declarative 401/403 is enforced by the app dispatcher; jest asserts `metadata`, live curl proves the dispatcher.
- UI stream must map the 400 `unsupported_source` until OSS-03 lands proposal import.

## Success Criteria (Summary)

- API jest suite and core typecheck are green.
- Live: 201 create, 200 list with `updatedAt`, 409 stale PUT.
