# FLOW-F1 L14b — stage artifact / stage decision routes with history

## Overview

Two route files under `api/projects/[id]/stages/[stageId]/` expose F7/F8/F9 exactly as the F0 table of
`.ai/specs/2026-09-18-delivery-os-hackathon.md` says. Commands `delivery_os.stages.create_artifact` / `.decide` exist.

## Current State Analysis

- Commands: `commands/stages.ts` (private `readPinnedSnapshot` / `requireTemplateStage`), loaders in `commands/flowGate.ts`.
- `stageHistoryListQuerySchema` exists in `data/validators.ts`; the F9 list schemas named in the spec
  (`stageArtifactListResponseSchema`, `stageDecisionListResponseSchema`) do not exist yet.
- Idempotency-Key header parsing is private to `api/tasks/[id]/attempts/route.ts`.
- Route test kit ignores `orderBy` and has no `em.count`.

## Decisions (autonomous)

| # | Question | Choice |
|---|---|---|
| D1 | Where the path stage check lives | `stages.ts` exports `requirePinnedTemplateStage(project, rawStageId)` reusing the command's own errors; routes call it on the scoped project (incl. archived) before reading the body |
| D2 | GET on an unpinned project | Same check → `422 flow_not_pinned` (one predictable rule for all three verbs) |
| D3 | F7 feature | metadata `projects.view`; after parsing, `requireDeliveryFeatures` with `manual|intake → projects.manage`, `agent|figma → results.import` (tasks-route pattern) |
| D4 | F7 body | `parseFlowVersioned` (422 `unsupported_schema_version`, 400 `validation_failed` incl. unknown body stageId), 1 MB cap, wrapped as `{ artifact }` |
| D5 | F8 order | metadata `stages.approve` → path stage → `Idempotency-Key` (400) → body parsed with the flow zod mapper, wrapped as `{ decision }` |
| D6 | Idempotency header helper | moved to `routeSupport.readIdempotencyKeyHeader`; R14 uses it (identical behaviour) |
| D7 | List shape | items carry the stored artifact (content, dependsOn, attachmentIds, source, createdBy) / decision (reason, actor, clientApproval decrypted via `findWithDecryption` with the session scope, never idempotencyKey/requestHash); DB `orderBy` + `limit/offset` + `em.count` |
| D8 | Test kit ordering | kit honours `orderBy` only for the two stage entities (avoids reordering existing v1 suites) and gains `count` |

## What We're NOT Doing

Integration specs `TC-DELIVERY-FLOW-02/09` (L15), comment threads (L17), UI/i18n.

## Phase 1: Contracts, routes and route tests

1. `lib/contracts.ts` — list item/response schemas.
2. `commands/stages.ts` — export `requirePinnedTemplateStage`.
3. `api/routeSupport.ts` — `readRouteText`, `readIdempotencyKeyHeader`, `requirePinnedStageForRoute`; attempts route uses the header helper.
4. `api/serializers.ts` — `serializeStageArtifact`, `serializeStageDecision`.
5. Routes `artifacts/route.ts`, `decisions/route.ts` with openApi.
6. Tests `api/__tests__/{stageArtifacts,stageDecisions}.route.test.ts`; kit ordering/count.

## Phase 2: Verification and docs

`yarn generate`, delivery_os jest (maxWorkers=2), core typecheck, curl smoke on :3100, spec status/changelog, hand-over.

## References

- `.ai/specs/2026-09-18-delivery-os-hackathon.md` F7–F9 rows
- `context/changes/delivery-os-oss-domain/handover/FLOW-progress.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Contracts, routes and route tests

#### Automated

- [x] 1.1 Add F9 list schemas to contracts
- [x] 1.2 Export the path stage check and route helpers
- [x] 1.3 Add artifacts and decisions routes with openApi
- [x] 1.4 Route suites stageArtifacts and stageDecisions green

### Phase 2: Verification and docs

#### Automated

- [x] 2.1 yarn generate and whole delivery_os jest run green
- [x] 2.2 Core typecheck green
- [x] 2.3 Curl smoke on :3100 (201 then 200 duplicate, 400 without Idempotency-Key)
- [x] 2.4 Spec status lines, changelog and FLOW-F1 hand-over

#### Manual

- [ ] 2.5 Human review of the stage history in the UI once UI binds F9
