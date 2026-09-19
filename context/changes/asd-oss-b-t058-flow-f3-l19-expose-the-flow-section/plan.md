# FLOW-F3 L19 — report flow section and workflow seams

## Overview
Additive F15 from the FLOW-F0 delta: R22 `GET /projects/:id/report` gains an optional `flow`
(`deliveryReportFlowSectionSchema`) for pinned projects; legacy projects keep the byte-identical v1 body. Plus the
hand-over for the workflow owner (Marcin) and a fake v1/v2 template provider that proves per-project pinning.

## Current State Analysis
- `lib/flowStatus.ts#buildDeliveryReportFlowSection` already builds the section (pure, returns `null` for legacy) but
  nothing calls it.
- `commands/reportQueries.ts#createDeliveryOsReportQueries().buildReport` returns `DeliveryReportV1`; the route returns
  it verbatim; openApi uses `deliveryReportV1Schema`.
- `commands/flowGate.ts` exports the stage-row loaders/mappers; `flowQueries.ts` already fails closed for an
  unreadable snapshot.
- Events `delivery_os.stage.artifact_created` / `.stage.decided` already carry `clientBroadcast: true` (events.ts:134-145).
- DI registration test (`commands/__tests__/attemptQueries.test.ts:77`) already lists `deliveryOsFlowQueries` and
  `deliveryFlowTemplateProvider`. `deliveryStaffKanbanAdapter` is F2 (lane A) and does not exist on this branch.

## Desired End State
Pinned project → R22 answer contains `flow { template, stages[4], gate }` parsing with
`deliveryReportV1Schema.extend({ flow: optional })`; stage blockers live only in `flow.gate`; v1 `gates` and
`reportGateBlockerSchema` untouched. Legacy project → identical body (no `flow` key). `FLOW-F3.md` explains the seams.

## Decisions (autonomous answers to the planning questions)
1. **Where to compute:** `buildReport(scope, projectId, { includeFlow: true })` option in `reportQueries.ts`
   (one project read, default off so in-process callers of `deliveryOsReportQueries` keep the exact v1 object and the
   DI key set stays `['buildReport']`). Route passes `includeFlow: true`.
2. **Unreadable pinned snapshot:** fail closed like F6 — section with the stored template ref (null if incomplete),
   every approval stage `missing`, gate `{ ok:false, blocking: artifact_missing × 4 }`. Never omit the section (that
   would look legacy).
3. **Comment threads in the gate:** not included (F2 seam absent on lane B; lane A adds `open_comments`).
4. **Report 404 for pinned project with no active baseline:** unchanged v1 behaviour; flow status stays on F6.
5. **Fake provider:** `lib/fixtures/flow/fakes.ts` exports `fakeTemplateProvider` (v1 = default template, v2 = the
   same with an extra review stage and a changed condition) returning `{ template, hash }`; the route test kit gains a
   provider override on `routeState`.
6. **DI test:** the existing registration test already lists `deliveryOsFlowQueries` and `deliveryFlowTemplateProvider`;
   extend it to assert `flowStatus` is the in-process method and the report service keys stay `['buildReport']`.
   `deliveryStaffKanbanAdapter` belongs to lane A (F2) and is added to that list by the human at merge (hand-over note).

## What We're NOT Doing
No change to `deliveryReportV1Schema`, `reportGateBlockerSchema`, frozen enums, v1 gates, migrations, events, ACL.

## Phase 1: Report flow section

### Changes Required
- `commands/reportQueries.ts`: `ReportOptions.includeFlow?: boolean`; return type `DeliveryReportWithFlow`
  (`DeliveryReportV1 & { flow?: DeliveryReportFlowSection }`); load stage rows via `flowGate.ts` loaders only when
  pinned and `includeFlow`; attach `flow` only when a section exists; unreadable snapshot → fail-closed section.
- `lib/contracts.ts`: export `deliveryReportWithFlowSchema = deliveryReportV1Schema.extend({ flow: section.optional() })` (additive).
- `api/projects/[id]/report/route.ts`: pass `includeFlow: true`; openApi 200 schema → `deliveryReportWithFlowSchema`; description mentions `flow`.
- `api/__tests__/reportFlow.route.test.ts`: legacy body deep-equals `buildReport` without flow (and no `flow` key,
  serialized JSON identical); pinned parses with extended schema, 4 stages, gate lists stage blockers, v1 `gates`
  blockers kinds ⊂ frozen enum; after approving all four stages gate ok; unreadable snapshot fail-closed; foreign org 404.

### Success Criteria
#### Automated Verification
- reportFlow + report route tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os/api/__tests__/report --maxWorkers=2`
#### Manual Verification
- Live GET /report on a legacy and a pinned project (after merge, lane-A server) shows the difference.

## Phase 2: Fake provider, pinning proof, hand-over

### Changes Required
- `lib/fixtures/flow/fakes.ts`: `FAKE_TEMPLATE_V2`, `createFakeTemplateProvider()`.
- `api/__tests__/routeTestKit.ts`: `routeState.flowTemplateProvider` override (reset in `resetRouteState`).
- `api/__tests__/flowPin.route.test.ts`: v1-pinned project keeps its snapshot/hash after v2 is published; a new
  project pins v2; F6 of the old project still reports v1.
- `context/changes/delivery-os-oss-domain/handover/FLOW-F3.md`, spec changelog line, FLOW-progress append.

### Success Criteria
#### Automated Verification
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green
#### Manual Verification
- Marcin confirms the FLOW-F3.md seam description is sufficient.

## Progress

### Phase 1: Report flow section

#### Automated

- [x] 1.1 reportFlow + report route tests pass

#### Manual

- [ ] 1.2 Live GET /report on a legacy and a pinned project shows the difference

### Phase 2: Fake provider, pinning proof, hand-over

#### Automated

- [x] 2.1 delivery_os jest suite green
- [x] 2.2 core typecheck green

#### Manual

- [ ] 2.3 Marcin confirms the FLOW-F3.md seam description is sufficient
