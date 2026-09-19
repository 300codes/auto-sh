# FLOW-F2 L18b — integration specs, FLOW-08 rerun, F2 hand-over — Implementation Plan

## Overview

Close stage F2 of the OSS flow package: prove on the real database and the real staff Kanban that a Figma comment
batch becomes exactly one staff card per thread and one card comment per reply (FLOW-03), and that the Kanban never
approves a stage (FLOW-04). Then rerun FLOW-08 regression evidence and publish `handover/FLOW-F2.md`.

## Current State Analysis

- Routes: `PUT|GET /api/delivery_os/projects/:id/staff-link` (F10), `POST .../comment-imports` (F11, `Idempotency-Key`,
  201/200 replayed), `GET .../comment-threads` (F12), `POST .../comment-threads/:threadId/triage` (F13, thread lock).
- Default adapter `commands/staffKanbanAdapter.ts` runs the staff public commands inside the thread transaction.
  Live probe (this task, before planning): admin → staff project → link → import of `comment-import.v1.json` with
  `artifactId: null` answered 201, one staff task (description starts `Source: <sourceUrl>`), one staff comment.
- Staff `time-projects` POST seeds the default board (Backlog default + a done column) in the same transaction; it only
  needs `name`, `code` (`[A-Za-z0-9-]`), `customerId` (any uuid; snapshot degrades to null).
- `blockingThreadsFor` (`lib/stageDecisions.ts:101`): open, not resolved, bound to the artifact OR unbound
  (`artifactId null`), not deferred for exactly this artifact id+hash. A thread bound to v1 does NOT block v2 approval;
  only an unbound (unconfirmed) thread does — so FLOW-04 imports with `artifactId: null`.
- `bindThreadVersion`: `figmaVersion null` → `versionConfirmed false`; a figmaVersion not carried by any artifact
  `figmaRefs` → also unconfirmed.
- `flowSpecKit.ts` cleanup/counts do not know `delivery_staff_links`, `delivery_comment_threads|replies` or staff rows.

## Desired End State

- `TC-DELIVERY-FLOW-03-comment-import.spec.ts` and `TC-DELIVERY-FLOW-04-kanban-approval.spec.ts` pass against :3100.
- Before/after counts of delivery_* and staff_time_* tables are identical (`/tmp/t057-before.txt`).
- FLOW-08 evidence: jest delivery_os suite, TC-DELIVERY-OSS-001, OSS-only boot check, scoped typecheck.
- `context/changes/delivery-os-oss-domain/handover/FLOW-F2.md` + changelog line in `.ai/specs/2026-09-18-delivery-os-hackathon.md`.

### Key Discoveries

- Staff comment/task visibility for the fixture user: `staff.*` grants `projects.manage` → `canManageAll`.
- Replay (same key + same hash) is answered before the cursor check, from fresh plans → outcomes `unchanged`, zero counts.
- Concurrent next-page imports with different keys: the loser either sees the advanced cursor (409
  `sync_cursor_conflict`) or waits on the project/link row lock; either way one card per thread.

## What We're NOT Doing

- No change to routes/commands unless a spec exposes a real defect (then fix in delivery_os only).
- No file under `packages/core/src/modules/staff/**`; no live Figma; no master-plan Progress ticks.
- No OM → Figma write-back.

## Implementation Approach

Decisions (autonomous answers to the planning questions):
1. Actor: fixture user in the admin's organisation with `['delivery_os.*', 'staff.*']` (createOwnerOrgUser) — the task
   asks for a fixture user; fallback to admin only if staff refuses a user without a staff member.
2. Staff fixtures via the public staff API (project create → seeded statuses read via `GET /task-statuses`); teardown
   by SQL (API delete of a project with tasks is refused / soft-deletes) incl. `entity_indexes`, `search_tokens`,
   `action_logs` of every created id.
3. Parallel import assertion: statuses ⊆ {201, 409}, ≥ one 201, any 409 is `sync_cursor_conflict`, and exactly one
   staff task per thread key in the DB.
4. Foreign-org probes: sibling-org user (`createSiblingOrgUser`) gets 404 on staff-link GET/PUT, import, thread list, triage.
5. Foreign staff project: a staff project created in org B by an org-B user with `staff.*`, plus a random uuid → 404.
6. FLOW-04 "delivery task not verified": seed the v1 baseline + a draft delivery task, pin in flight, triage the thread
   `triaged` with `linkedDeliveryTaskId`, move the card to done → task still `draft`, thread still `triaged`, flow unchanged.
7. Specs are written by two parallel subagents; I own `flowSpecKit.ts` (shared) and all runs.

## Phase 1: Kit extension and specs

### Changes Required

#### 1. Spec kit
**File**: `packages/core/src/modules/delivery_os/__integration__/flowSpecKit.ts`
**Intent**: registry gains `staffProjectIds`; counts + `deleteProjectsInDb` cover staff links, comment threads/replies;
new `deleteStaffProjectsInDb` removes staff comments/tasks/statuses/members/projects and their index/action-log rows;
helpers `createStaffProject`, `listStaffStatuses`, `linkStaff`, `importBatch`, `commentBatch`, `listThreads`, `triage`.
**Contract**: `cleanupRegistry` stays idempotent and also clears staff rows; `expectNothingLeft` counts them.

#### 2. TC-DELIVERY-FLOW-03 / -04
**Files**: `__integration__/TC-DELIVERY-FLOW-03-comment-import.spec.ts`, `__integration__/TC-DELIVERY-FLOW-04-kanban-approval.spec.ts`
**Intent**: scenarios listed in the task; self-contained fixtures; `afterAll` → `expectNothingLeft`. Every import of one project runs as the same fixture user (staff lets only the comment author or `manage_all` edit a card comment).

### Success Criteria
#### Automated Verification
- Both specs pass against :3100: `BASE_URL=http://localhost:3100 npx playwright test --config .ai/qa/tests/playwright.config.ts <spec> --retries=0`
- Before/after table counts identical

## Phase 2: FLOW-08 regression
### Success Criteria
#### Automated Verification
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- TC-DELIVERY-OSS-001 passes against :3100
- OSS-only boot check (generated registries contain no enterprise delivery dependency) and scoped typecheck green

## Phase 3: Hand-over
### Success Criteria
#### Automated Verification
- `handover/FLOW-F2.md` written; spec changelog entry added
#### Manual Verification
- Adam confirms the `delivery.comment-import/v1` outcome semantics against his provider

## Testing Strategy
Integration only (the unit/route layers already cover the rules over fakes). Negative paths: 404 foreign org / foreign
staff project, 409 cursor conflict, 409 stale triage lock, 422 blocking comments.

## References
- `api/__tests__/commentRouteKit.ts`, `__integration__/TC-DELIVERY-FLOW-02-stage-approvals.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Kit extension and specs

#### Automated

- [x] 1.1 Both specs pass against :3100 (`yarn test:integration` runner, single worker)
- [x] 1.2 Before/after table counts identical

### Phase 2: FLOW-08 regression

#### Automated

- [x] 2.1 jest delivery_os suite green
- [x] 2.2 TC-DELIVERY-OSS-001 passes against :3100
- [x] 2.3 OSS-only boot check and scoped typecheck green

### Phase 3: Hand-over

#### Automated

- [x] 3.1 `handover/FLOW-F2.md` written; spec changelog entry added

#### Manual

- [ ] 3.2 Adam confirms the `delivery.comment-import/v1` outcome semantics against his provider
