# OSS-02 (L4a): ACL, setup, events and the execution extension point — Implementation Plan

## Overview

Register the `delivery_os` module with the platform: RBAC features (`acl.ts`), default role grants (`setup.ts`),
the four frozen typed events (`events.ts`) and the `delivery_os.project.execution` injection host
(`extension-points.ts`). A contract test pins all of it to the spec so later layers (L4 commands, L5 routes, UI, EXEC)
build on a frozen surface. This is built before the commands because commands emit these events and routes gate on
these feature IDs (recorded planner decision).

## Current State Analysis

- `packages/core/src/modules/delivery_os/` has `index.ts` (metadata only), `data/`, `lib/`, `migrations/`; the module
  is registered in `apps/mercato/src/modules.ts` (T006).
- `lib/contracts.ts:17-18` exports `DELIVERY_EXECUTION_SPOT_ID = 'delivery_os.project.execution'` and
  `DELIVERY_EXECUTION_CONTEXT_CONTRACT` (`'delivery_os.project.execution.v1'`), and `executionWidgetContextV1Schema`
  (`lib/contracts.ts:701`).
- Spec `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Access Control (8 features, role defaults), § Events (4 IDs,
  payloads, broadcast flags), § Extension spot (host declaration).
- Reference module: `customers/{acl,setup,events,extension-points,index}.ts`; small reference `warranty_claims`.

## Desired End State

- `acl.ts` exports `features` (+ default) with exactly the 8 spec IDs; `index.ts` re-exports `features`.
- `setup.ts` exports `setup: ModuleSetupConfig` (+ default) with `defaultRoleFeatures` exactly per spec.
- `events.ts` exports `eventsConfig`, `emitDeliveryOsEvent`, `DeliveryOsEventId`, `DELIVERY_OS_EVENT_IDS` (+ default);
  `clientBroadcast: true` only on `task.updated` and `evidence.recorded`; every event carries a `payloadSchema`.
- `extension-points.ts` exports `extensionPoints` (+ default) with one host `projectExecution`.
- `__tests__/module-registration.test.ts` green; `yarn generate` run once; module-decoupling test and core typecheck
  still pass.

### Key Discoveries:

- SSE audience filtering drops any browser-broadcast event without `tenantId` in the payload
  (`packages/events/AGENTS.md` § Browser Delivery Rules: "Missing `tenantId` in event payload means no delivery";
  `organizationId` must match the selected org). The stream route prefers trusted scope from emit `options`
  (`packages/events/src/modules/events/api/stream/route.ts:52-79`) and falls back to payload fields. The spec payloads
  for `task.updated` / `evidence.recorded` omit them, so the L4 commands MUST pass `{ tenantId, organizationId }` as
  emit options, and the payloads also carry them for subscribers and the fallback path.
- The extension-facts generator (`packages/cli/src/lib/generators/module-extension-facts.ts:233-250`) resolves only
  literals and same-file `const` initializers, not imports. `extension-points.ts` therefore uses string literals; the
  test pins them to the `lib/contracts.ts` constants.
- `injectionExtensionHost` requires `family` + `supported` and exactly one of `spotId`/`pattern`
  (`packages/shared/src/modules/widgets/extension-points.ts:131-143`).
- `createModuleEvents` adds a default CRUD payload schema only when none is declared
  (`packages/shared/src/modules/events/factory.ts:122-127`); we declare explicit schemas for all four.

## What We're NOT Doing

- No commands, routes, DI service (`di.ts`), subscribers, notifications or workers (later L4/L5 tasks).
- No i18n keys, backend pages or components (UI stream); feature/event titles stay English labels like `customers`.
- No change to generated files by hand; no migration; no enterprise wiring.

## Implementation Approach

Mirror `customers`/`warranty_claims` file shapes exactly. Decisions (self-answered planning questions):

| # | Question | Choice (Recommended) | Why |
|---|---|---|---|
| Q1 | Add `tenantId`/`organizationId` to event payloads? | Yes, to all four payload schemas (additive), and update the spec § Events + changelog | Without them `clientBroadcast` delivers nothing; live task status is a demo path (completeness) |
| Q2 | `dependsOn` on features? | Every non-view feature `dependsOn: ['delivery_os.projects.view']` | Every action needs to read the project; mirrors customers; additive metadata |
| Q3 | Event categories | `project.created` → `crud`; the other three → `lifecycle` | They are domain transitions, not generic CRUD; `project.created` keeps an explicit schema so the CRUD default does not apply |
| Q4 | Spot IDs in `extension-points.ts` | String literals + test equality with contracts constants | Generator cannot follow imports |
| Q5 | Host family/capability | `family: 'detail'`, `supported: ['render-widget']`, `source: 'backend/delivery/projects/[id]/page.tsx'` | Spec § Extension spot; matches customers detail hosts |
| Q6 | Boundary test scope | Recursive fs scan of all `.ts/.tsx` in the module (excluding the test itself) for import/require/dynamic import of `@open-mercato/enterprise` or `delivery-cezar` | Cheap, catches any future file, backs Progress 2.3 |
| Q7 | Role defaults test strictness | Exact equality with the spec lists, plus every entry ∈ features ∪ `delivery_os.*` | Keeps approval features (`baselines/deploy/release.approve`, `attempts.*`) off `employee` — the human-decision boundary |
| Q8 | Payload field optionality | `statusReason`, `completionDelivery` optional (nullable); rest required | Without enterprise `completionDelivery` is `null`; `statusReason` is null for most statuses |
| Q8a | (impl addendum) `evidence.recorded.taskId` optional too; `completionDelivery` typed `select` | `delivery_evidence.task_id` is nullable (project-level evidence); `completionDelivery` is the enum `pending`/`delivered` | Recorded after impl review F1/F4 |

## Phase 1: Registration files and contract test

### Changes Required:

#### 1. ACL
**File**: `packages/core/src/modules/delivery_os/acl.ts`
**Intent**: Declare the 8 features from the spec with English titles, `module: 'delivery_os'`.
**Contract**: `export const features` + `export default features`; IDs `delivery_os.{projects.view, projects.manage,
baselines.approve, results.import, attempts.manage, attempts.reconcile, deploy.approve, release.approve}`.

#### 2. Module index
**File**: `packages/core/src/modules/delivery_os/index.ts`
**Intent**: `export { features } from './acl'` like customers.

#### 3. Setup
**File**: `packages/core/src/modules/delivery_os/setup.ts`
**Intent**: `defaultRoleFeatures` only (no seeding — tables start empty).
**Contract**: `export const setup: ModuleSetupConfig`, default export; admin `['delivery_os.*']`; employee
`['delivery_os.projects.view','delivery_os.projects.manage','delivery_os.results.import']`.

#### 4. Events
**File**: `packages/core/src/modules/delivery_os/events.ts`
**Intent**: `createModuleEvents({ moduleId: 'delivery_os', events })` with the 4 frozen IDs and payload schemas.
**Contract**: payload fields — project.created `{projectId, tenantId, organizationId}`; baseline.approved
`{projectId, baselineId, version:number, contentHash, activeBaselineId, tenantId, organizationId}`; task.updated
`{projectId, taskId, status, statusReason?, updatedAt:date, tenantId, organizationId}`; evidence.recorded
`{projectId, taskId, attemptId?, evidenceId, kind, duplicate:boolean, completionDelivery?, tenantId, organizationId}`
(`attemptId` optional because non-manifest evidence may have no attempt). Exports `eventsConfig`,
`emitDeliveryOsEvent`, `DeliveryOsEventId`, `DELIVERY_OS_EVENT_IDS`, default.

#### 5. Extension point
**File**: `packages/core/src/modules/delivery_os/extension-points.ts`
**Intent**: Declare the execution host per spec.
**Contract**: `defineModuleExtensionPoints({ moduleId: 'delivery_os', hosts: { projectExecution:
injectionExtensionHost({ family: 'detail', spotId: 'delivery_os.project.execution', supported: ['render-widget'],
contextContract: 'delivery_os.project.execution.v1', source: 'backend/delivery/projects/[id]/page.tsx' }) } })`.

#### 6. Contract test
**File**: `packages/core/src/modules/delivery_os/__tests__/module-registration.test.ts`
**Intent**: Pin the registration surface: feature IDs = spec list (and unique); `index.ts` re-exports the same
`features`; each role default ∈ features ∪ `delivery_os.*` and equals the spec lists; employee holds no approve /
attempts feature; event IDs = frozen list, match `^delivery_os\.[a-z_]+\.[a-z_]+$`, broadcast flags exact, each has a
payload schema with `tenantId`/`organizationId`; host spotId/contextContract equal the contracts constants and the
host `contextContract` also equals `DELIVERY_SCHEMA_VERSIONS.executionWidgetContext` (the literal pinned by
`executionWidgetContextV1Schema`), `family: 'detail'`, `supported: ['render-widget']`; broadcast flags are also
asserted through `isBroadcastEvent` like `customers/__tests__/events.broadcast.test.ts`; fs scan finds no
enterprise/delivery-cezar import.

#### 7. Spec update
**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md`
**Intent**: § Events payloads gain `tenantId, organizationId` (and optional markers); changelog entry for T009.

### Success Criteria:

#### Automated Verification:
- Module tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- `yarn generate` completes (known OpenAPI noise allowed); tracked generated-file diff reported
- Decoupling test passes: `yarn workspace @open-mercato/core jest src/__tests__/module-decoupling.test.ts --maxWorkers=2`
- Core typecheck passes: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`

#### Manual Verification:
- A human confirms the ACL split (who may approve / publish / accept) matches the team's intent in the roles UI

## Testing Strategy

Unit test only (registration is static data); integration coverage of the gated routes is QA's (TC-DELIVERY).
Optional live smoke: after `yarn generate` the dev server exposes the features in `/api/auth/features` or the role
editor — checked via API if cheap.

## References

- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Access Control, § Events, § Extension spot
- Reference: `packages/core/src/modules/customers/{acl,setup,events,extension-points,index}.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Registration files and contract test

#### Automated

- [x] 1.1 Module tests pass: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2`
- [x] 1.2 `yarn generate` completes (known OpenAPI noise allowed); tracked generated-file diff reported
- [x] 1.3 Decoupling test passes: `yarn workspace @open-mercato/core jest src/__tests__/module-decoupling.test.ts --maxWorkers=2`
- [x] 1.4 Core typecheck passes: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`

#### Manual

- [ ] 1.5 A human confirms the ACL split (who may approve / publish / accept) matches the team's intent in the roles UI
