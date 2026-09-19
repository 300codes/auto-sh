# FLOW-F1 L14a — intake, proposal, flow status and flow pin routes

## Overview

Add four route files for the frozen F0 operations F1/F2 (intake GET/PUT), F3 (scoping proposal import), F4 (flow pin)
and F6 (FlowStatus v1), plus the DI read service `deliveryOsFlowQueries.flowStatus(projectId, scope)` that F6 and the
enterprise/workflow steps share. Commands and pure rules already exist (T044/T045/T046); this is the HTTP layer.

## Current State Analysis

- Commands: `commands/intake.ts` (update, import_proposal), `commands/flow.ts` (pin, link_instance). Private helpers
  `toIntakeDocument` / `toIntakeResponse` live in `commands/intake.ts`; `lib/intakeRules.ts#defaultIntake` builds the empty draft.
- Read model: `lib/flowStatus.ts#buildFlowStatus` (pure) + `countBlockingThreadsByStage`; loaders in `commands/flowGate.ts`
  (`loadStageArtifactRows`, `loadStageDecisionRows`, record mappers); thread seam `commands/stages.ts#loadStageCommentThreads` (returns [] until L17).
- Route pattern: `api/projects/[id]/deploy-decisions/route.ts` + `api/routeSupport.ts` (`executeDeliveryCommand` runs mutation guards,
  `deliveryErrorResponse`, `readCappedRouteBody`, `requireProjectIncludingArchived`). Reads resolve a DI query service (`report/route.ts`).
- Test kit `api/__tests__/routeTestKit.ts` knows only v1 entities and has no flow template provider / flow queries in its container.

## Desired End State

`GET/PUT /projects/:id/intake`, `POST /projects/:id/intake/proposals`, `GET /projects/:id/flow`, `POST /projects/:id/flow/pin`
answer exactly as the F0 table says, documented in OpenAPI with the F0 schemas; route suites cover 403/404/428/409/replay; live curl smoke passes.

## Decisions (autonomous; answered from spec/code)

| # | Question | Choice |
|---|---|---|
| D1 | Where the F6 assembly lives | `commands/flowQueries.ts#createDeliveryOsFlowQueries(em)` registered as `deliveryOsFlowQueries` in `di.ts`; the route only resolves it (same code for route and workflow steps) |
| D2 | Pinned project whose snapshot no longer parses | F6 fails closed: template ref kept, both gates `ok:false` with one `artifact_missing` blocker per approval stage, `nextAction none`, logger warning (mirrors the v1 gate) |
| D3 | Archived projects | GET intake / GET flow stay readable (like R22); writes go through commands, which already refuse archived projects |
| D4 | F3 version check | Route parses with `parseFlowVersioned` → `422 unsupported_schema_version` (not the 400 zod literal); body capped at 1 MB with `readCappedRouteBody` |
| D5 | F4 response | `201` new / `200` replay, body = `FlowPinResponse` (the internal `duplicate` flag is stripped) |
| D6 | F2 body shape | Body is the whole draft; the route wraps it as `{ intake }`, so a `proposals` key (or `projectId`/`trustedExecution`) cannot reach the command's top level; the zod object strips `proposals` |
| D7 | Unreadable attempt registers in F6 | Ignored in F6 (v1 reserve already refuses on them); readable active/unknown attempts produce `attempt_active` |
| D8 | Serializers | `api/serializers.ts#serializeIntakeResponse(project, row|null)` reusing exported `toIntakeDocument`/`toIntakeResponse`; flow status carries no PII by construction (ids, hashes, stage state) |

## Testing Strategy

- Intake: 403 view/manage, 404 second tenant and second org (GET and PUT), GET default (`step: brief`, `updatedAt` = project `createdAt`), PUT 428 without header, first write with the F1 `updatedAt`, `proposals` in the body ignored, 409 stale intake header while a project PUT with the project header still succeeds (and a fresh intake header still works after it), `target_profile_frozen` 422.
- Proposals: 403 without results.import, 422 `unsupported_schema_version`, 422 `foreign_reference` (projectId ≠ path), 201 then 200 duplicate replay (same body, no lock needed), 428 on a new manifest without header.
- Flow status: legacy project (`template: null`, gates open, `template_not_pinned` blocker), pinned project (four stages missing, gates closed), no EM write calls, 404 foreign scope, 403 without view, archived project readable, unreadable snapshot fails closed; DI service equals route output.
- Pin: 403 without flow.manage, 428, 409 stale project header, 201 then 200 same body, 409 `flow_already_pinned` for another template, 422 `unknown_flow_template`, 404 foreign scope.

## What We're NOT Doing

- F7–F15 routes (L14b+), comment threads (L17), UI, i18n keys, integration spec `TC-DELIVERY-FLOW-01` (L15).

## Phase 1: Flow queries + routes + route tests

### Changes Required

1. **`commands/flowQueries.ts`** (new) — `DeliveryOsFlowQueries = { flowStatus(projectId, scope): Promise<FlowStatusV1> }`;
   loads project incl. archived (404 `not_found` otherwise), intake step, artifact/decision rows, threads via the seam, task attempt registers; builds via `buildFlowStatus`; D2 fail-closed branch.
2. **`di.ts`** — register `deliveryOsFlowQueries`.
3. **`commands/intake.ts`** — export `toIntakeDocument`, `toIntakeResponse` (no behaviour change).
4. **`api/serializers.ts`** — `serializeIntakeResponse`.
5. **Routes** — `api/projects/[id]/intake/route.ts` (GET projects.view, PUT projects.manage), `.../intake/proposals/route.ts`
   (POST results.import), `.../flow/route.ts` (GET projects.view), `.../flow/pin/route.ts` (POST flow.manage). All: `requireAuth`,
   feature metadata, `openApi` with F0 schemas and error table, `executeDeliveryCommand` (mutation guards), `deliveryErrorResponse`.
6. **Test kit** — store gains `intakes`, `stageArtifacts`, `stageDecisions`; container resolves `deliveryFlowTemplateProvider` (built-in) and `deliveryOsFlowQueries`.
7. **Tests** — `api/__tests__/{intake,flowStatus,flowPin}.route.test.ts`.

### Success Criteria

#### Automated Verification:
- New route suites green: `yarn workspace @open-mercato/core jest src/modules/delivery_os/api/__tests__/{intake,flowStatus,flowPin}.route.test.ts --maxWorkers=2`
- Whole module suite green: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- Core typecheck: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`
- `yarn generate` runs clean (route registry picks up the four files)
- Curl smoke on :3100: GET intake 200 default, PUT intake without lock 428, GET flow on a legacy project → `template: null`, gates open

#### Manual Verification:
- UI stream confirms the intake/flow payloads fit the wizard and project detail (human acceptance)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Flow queries + routes + route tests

#### Automated

- [x] 1.1 New route suites green
- [x] 1.2 Whole module suite green
- [x] 1.3 Core typecheck
- [x] 1.4 yarn generate runs clean
- [x] 1.5 Curl smoke on :3100

#### Manual

- [ ] 1.6 UI stream confirms the intake/flow payloads
